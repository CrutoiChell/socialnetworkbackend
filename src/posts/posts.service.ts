import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma, PostMediaType, UserRole } from '@prisma/client';
import { mapPublicUser, toAbsoluteMediaUrl } from '../common/public-url';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MentionsService } from '../notifications/mentions.service';
import { XpService } from '../xp/xp.service';
import { CreatePostDto } from './dto/create-post.dto';
import { CreateCommentDto } from './dto/create-comment.dto';

/** Первая страница ленты: 3 поста под сетку (1 крупный + 2 компактных). */
const FEED_FIRST_PAGE_LAYOUT_SIZE = 3;
const FEED_PINNED_MEDIA_COUNT = 5;
/** Срок действия буста — спустя это время он снимается автоматически. */
const BOOST_DURATION_MS = 3 * 24 * 60 * 60 * 1000;
const PREMIUM_MAX_FILE_SIZE = 30 * 1024 * 1024;
const DEFAULT_MAX_FILE_SIZE = 8 * 1024 * 1024;
const PREMIUM_MAX_FILES = 10;
const DEFAULT_MAX_FILES = 3;

const feedOrderByRecent: Prisma.PostOrderByWithRelationInput[] = [
  { isBoosted: 'desc' },
  { createdAt: 'desc' },
  { id: 'desc' },
];

const feedOrderByLikes: Prisma.PostOrderByWithRelationInput[] = [
  { isBoosted: 'desc' },
  { likes: { _count: 'desc' } },
  { id: 'desc' },
];

const feedPostInclude = (userId: number) =>
  ({
    user: { select: { id: true, username: true, avatar: true, level: true, isPremium: true, selectedColorStyle: true } },
    _count: { select: { likes: true, comments: true } },
    likes: { where: { userId }, select: { id: true } },
    bookmarks: { where: { userId }, select: { id: true } },
    medias: { orderBy: { id: 'asc' } },
    poll: {
      include: {
        votes: { select: { optionIndex: true, userId: true } },
      },
    },
    parentPost: {
      include: {
        user: { select: { id: true, username: true, avatar: true, level: true, isPremium: true, selectedColorStyle: true } },
        medias: { orderBy: { id: 'asc' } },
      },
    },
  }) satisfies Prisma.PostInclude;

type PostWithFeed = Prisma.PostGetPayload<{
  include: ReturnType<typeof feedPostInclude>;
}>;

@Injectable()
export class PostsService {
  private readonly logger = new Logger(PostsService.name);

  constructor(
    private prisma: PrismaService,
    private users: UsersService,
    private notifications: NotificationsService,
    private mentions: MentionsService,
    private xp: XpService,
  ) {}

  private mapPostMedias(
    medias:
      | { id: number; url: string; type: PostMediaType; isSpoiler: boolean }[]
      | undefined,
  ) {
    const normalized = (medias ?? []).map((m) => ({
      id: m.id,
      url: toAbsoluteMediaUrl(m.url),
      type: m.type,
      isSpoiler: m.isSpoiler,
    }));
    return {
      medias: normalized,
      image: normalized[0]?.url ?? null,
    };
  }

  private parsePoll(raw: string | undefined) {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as {
        question?: unknown;
        options?: unknown;
        allowChangeVote?: unknown;
      };
      if (
        typeof parsed.question !== 'string' ||
        !Array.isArray(parsed.options)
      ) {
        throw new Error('Invalid poll shape');
      }
      const question = parsed.question.trim();
      const options = parsed.options
        .filter((v): v is string => typeof v === 'string')
        .map((v) => v.trim())
        .filter(Boolean);
      if (!question || options.length < 2) {
        throw new Error('Invalid poll content');
      }
      return {
        question,
        options,
        allowChangeVote: parsed.allowChangeVote === true,
      };
    } catch {
      throw new BadRequestException('Invalid poll payload');
    }
  }

  private mapPoll(
    poll:
      | {
          id: number;
          question: string;
          options: Prisma.JsonValue;
          allowChangeVote: boolean;
          votes: { optionIndex: number; userId: number }[];
        }
      | null
      | undefined,
    userId: number,
  ) {
    if (!poll) return null;

    const options =
      Array.isArray(poll.options) && poll.options.every((v) => typeof v === 'string')
        ? (poll.options as string[])
        : [];
    const votes = new Array(options.length).fill(0);
    for (const v of poll.votes) {
      if (v.optionIndex >= 0 && v.optionIndex < votes.length) {
        votes[v.optionIndex] += 1;
      }
    }
    const totalVotes = poll.votes.length;
    const meVote = poll.votes.find((v) => v.userId === userId)?.optionIndex ?? null;

    return {
      id: poll.id,
      question: poll.question,
      options,
      allowChangeVote: poll.allowChangeVote,
      votes,
      totalVotes,
      myVote: meVote,
    };
  }

  private mapParentPost(
    parentPost:
      | {
          id: number;
          content: string;
          embedUrl: string | null;
          createdAt: Date;
          user: { id: number; username: string; avatar: string | null };
          medias: {
            id: number;
            url: string;
            type: PostMediaType;
            isSpoiler: boolean;
          }[];
        }
      | null
      | undefined,
  ) {
    if (!parentPost) return null;
    const mediaMapped = this.mapPostMedias(parentPost.medias);
    return {
      id: parentPost.id,
      content: parentPost.content,
      embedUrl: parentPost.embedUrl,
      createdAt: parentPost.createdAt,
      author: mapPublicUser(parentPost.user),
      ...mediaMapped,
    };
  }

  private normalizeYoutubeEmbed(url: URL): string | null {
    const host = url.hostname.toLowerCase();
    let videoId = '';
    if (host.includes('youtu.be')) {
      videoId = url.pathname.split('/').filter(Boolean)[0] ?? '';
    } else if (host.includes('youtube.com')) {
      if (url.pathname.startsWith('/watch')) {
        videoId = url.searchParams.get('v') ?? '';
      } else if (url.pathname.startsWith('/shorts/')) {
        videoId = url.pathname.split('/')[2] ?? '';
      } else if (url.pathname.startsWith('/embed/')) {
        videoId = url.pathname.split('/')[2] ?? '';
      }
    }
    if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return null;
    return `https://www.youtube.com/embed/${videoId}`;
  }

  private normalizeVkEmbed(url: URL): string | null {
    const host = url.hostname.toLowerCase();
    if (!host.includes('vk.com')) return null;

    const oid = url.searchParams.get('oid');
    const id = url.searchParams.get('id');
    if (url.pathname.includes('/video_ext.php') && oid && id) {
      return `https://vk.com/video_ext.php?oid=${encodeURIComponent(oid)}&id=${encodeURIComponent(id)}&hd=2&autoplay=0`;
    }

    const match = url.pathname.match(/\/video(-?\d+)_(\d+)/);
    if (!match) return null;
    const matchedOid = match[1];
    const matchedId = match[2];
    return `https://vk.com/video_ext.php?oid=${encodeURIComponent(matchedOid)}&id=${encodeURIComponent(matchedId)}&hd=2&autoplay=0`;
  }

  private normalizeRutubeEmbed(url: URL): string | null {
    const host = url.hostname.toLowerCase();
    if (!host.includes('rutube.ru')) return null;

    const videoMatch = url.pathname.match(/\/video\/([a-zA-Z0-9]+)/);
    if (videoMatch) {
      return `https://rutube.ru/play/embed/${videoMatch[1]}`;
    }
    const embedMatch = url.pathname.match(/\/play\/embed\/([a-zA-Z0-9]+)/);
    if (embedMatch) {
      return `https://rutube.ru/play/embed/${embedMatch[1]}`;
    }
    return null;
  }

  private parseEmbedUrl(rawEmbedUrl: string | undefined): string | null {
    const value = rawEmbedUrl?.trim();
    if (!value) return null;

    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new BadRequestException('Invalid embed URL');
    }

    const normalized =
      this.normalizeYoutubeEmbed(parsed) ??
      this.normalizeVkEmbed(parsed) ??
      this.normalizeRutubeEmbed(parsed);

    if (!normalized) {
      throw new BadRequestException(
        'Only YouTube, VK and RuTube links are supported',
      );
    }
    return normalized;
  }

  private parseSpoilerFlags(
    rawSpoilerFlags: string | undefined,
    mediaCount: number,
  ): boolean[] {
    if (!rawSpoilerFlags) {
      return Array.from({ length: mediaCount }, () => false);
    }
    if (mediaCount === 0) {
      throw new BadRequestException('Spoiler flags require attached media');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawSpoilerFlags);
    } catch {
      throw new BadRequestException('Invalid spoiler flags payload');
    }
    if (!Array.isArray(parsed)) {
      throw new BadRequestException('Invalid spoiler flags payload');
    }
    if (parsed.length > mediaCount) {
      throw new BadRequestException('Too many spoiler flags');
    }

    return Array.from({ length: mediaCount }, (_, index) => parsed[index] === true);
  }

  private parseLocation(dto: CreatePostDto) {
    const locationName = dto.locationName?.trim() || null;
    const rawLat = dto.locationLat?.trim();
    const rawLng = dto.locationLng?.trim();
    const hasCoords = Boolean(rawLat) || Boolean(rawLng);

    if (!hasCoords) {
      return {
        locationName,
        locationLat: null as number | null,
        locationLng: null as number | null,
      };
    }
    if (!rawLat || !rawLng) {
      throw new BadRequestException('Location coordinates are incomplete');
    }

    const locationLat = Number(rawLat);
    const locationLng = Number(rawLng);
    if (!Number.isFinite(locationLat) || !Number.isFinite(locationLng)) {
      throw new BadRequestException('Invalid location coordinates');
    }
    if (locationLat < -90 || locationLat > 90 || locationLng < -180 || locationLng > 180) {
      throw new BadRequestException('Location coordinates are out of range');
    }

    return { locationName, locationLat, locationLng };
  }

  private parseAdSettings(dto: CreatePostDto, role: UserRole) {
    const isAdmin = role === 'ADMIN';
    const rawIsAd = dto.isAd?.trim().toLowerCase();
    const adTargetRaw = dto.adTargetUrl?.trim() ?? '';
    const isAd = rawIsAd === 'true' || rawIsAd === '1';
    const attemptedAdPayload = isAd || Boolean(adTargetRaw);

    if (!isAdmin && attemptedAdPayload) {
      throw new ForbiddenException('Only ADMIN can create ad posts');
    }
    if (!isAd) {
      return { isAd: false, adTargetUrl: null as string | null };
    }
    if (!adTargetRaw) {
      throw new BadRequestException('Ad target URL is required for ad posts');
    }

    let parsed: URL;
    try {
      parsed = new URL(adTargetRaw);
    } catch {
      throw new BadRequestException('Invalid ad target URL');
    }
    if (!/^https?:$/i.test(parsed.protocol)) {
      throw new BadRequestException('Ad target URL must be http/https');
    }
    return { isAd: true, adTargetUrl: parsed.toString() };
  }

  private isPremiumActive(user: { isPremium: boolean; premiumUntil: Date | null }) {
    if (!user.isPremium) return false;
    if (!user.premiumUntil) return true;
    return user.premiumUntil.getTime() > Date.now();
  }

  private async assertUploadLimits(userId: number, files: Express.Multer.File[]) {
    if (files.length === 0) return;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isPremium: true, premiumUntil: true },
    });
    if (!user) throw new NotFoundException('User not found');
    const premium = this.isPremiumActive(user);

    const maxFiles = premium ? PREMIUM_MAX_FILES : DEFAULT_MAX_FILES;
    if (files.length > maxFiles) {
      throw new BadRequestException(
        premium
          ? `К посту можно прикрепить не более ${maxFiles} файлов`
          : `Без Премиума к посту можно прикрепить не более ${maxFiles} файлов. С Премиумом — до ${PREMIUM_MAX_FILES}`,
      );
    }

    const maxSize = premium ? PREMIUM_MAX_FILE_SIZE : DEFAULT_MAX_FILE_SIZE;
    const oversized = files.find((file) => file.size > maxSize);
    if (oversized) {
      const maxMb = Math.floor(maxSize / (1024 * 1024));
      throw new BadRequestException(
        premium
          ? `Файл слишком большой. Максимальный размер: ${maxMb}МБ`
          : `Файл слишком большой. Без Премиума максимальный размер: ${maxMb}МБ (с Премиумом — до ${Math.floor(PREMIUM_MAX_FILE_SIZE / (1024 * 1024))}МБ)`,
      );
    }

    if (!premium) {
      const hasVideo = files.some((file) => file.mimetype.startsWith('video/'));
      if (hasVideo) {
        throw new BadRequestException('Загрузка видео в посты доступна только с Премиумом');
      }
    }
  }

  async createPost(userId: number, dto: CreatePostDto, files: Express.Multer.File[]) {
    await this.assertUploadLimits(userId, files);
    const authorMeta = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (!authorMeta) throw new NotFoundException('User not found');
    const pollData = this.parsePoll(dto.poll);
    const embedUrl = this.parseEmbedUrl(dto.embedUrl);
    const adSettings = this.parseAdSettings(dto, authorMeta.role);
    const spoilerFlags = this.parseSpoilerFlags(dto.spoilerFlags, files.length);
    const location = this.parseLocation(dto);
    const content = dto.content?.trim() ?? '';
    if (
      !content &&
      !pollData &&
      files.length === 0 &&
      !embedUrl &&
      !location.locationName &&
      location.locationLat == null &&
      location.locationLng == null
    ) {
      throw new BadRequestException('Post must contain text, media, poll, or embed link');
    }
    const mediaPayload = files.map((file, index) => ({
      url: `/uploads/${file.filename}`,
      type: file.mimetype.startsWith('video/')
        ? PostMediaType.VIDEO
        : PostMediaType.IMAGE,
      isSpoiler: spoilerFlags[index] ?? false,
    }));

    const created = await this.prisma.$transaction(async (tx) => {
      const poll =
        pollData && pollData.options.length >= 2
          ? await tx.poll.create({
              data: {
                question: pollData.question,
                options: pollData.options,
                allowChangeVote: pollData.allowChangeVote,
              },
            })
          : null;

      return tx.post.create({
        data: {
          userId,
          content,
          embedUrl,
          isAd: adSettings.isAd,
          adTargetUrl: adSettings.adTargetUrl,
          locationName: location.locationName,
          locationLat: location.locationLat,
          locationLng: location.locationLng,
          isPoll: !!poll,
          pollId: poll?.id ?? null,
          medias: mediaPayload.length
            ? {
                createMany: {
                  data: mediaPayload,
                },
              }
            : undefined,
        },
        include: {
          user: { select: { id: true, username: true, avatar: true, level: true, isPremium: true, selectedColorStyle: true } },
          _count: { select: { likes: true, comments: true } },
          bookmarks: { where: { userId }, select: { id: true } },
          medias: { orderBy: { id: 'asc' } },
          poll: { include: { votes: { select: { optionIndex: true, userId: true } } } },
          parentPost: {
            include: {
              user: { select: { id: true, username: true, avatar: true, level: true, isPremium: true, selectedColorStyle: true } },
              medias: { orderBy: { id: 'asc' } },
            },
          },
        },
      });
    });

    const { user, _count, poll, medias, bookmarks, parentPost, ...post } = created;
    const mediaMapped = this.mapPostMedias(medias);
    if (content) {
      await this.mentions.notifyMentions(content, userId, created.id);
    }
    return {
      ...post,
      ...mediaMapped,
      author: mapPublicUser(user),
      likesCount: _count.likes,
      commentsCount: _count.comments,
      bookmarkedByMe: (bookmarks?.length ?? 0) > 0,
      poll: this.mapPoll(poll, userId),
      parentPost: this.mapParentPost(parentPost),
    };
  }

  /** Видимость постов в ленте по postsPrivacy автора. */
  private buildFeedVisibilityWhere(
    viewerId: number,
    friendIds: number[],
  ): Prisma.PostWhereInput {
    return {
      parentPostId: null,
      OR: [
        { userId: viewerId },
        { user: { postsPrivacy: 'ALL' } },
        {
          AND: [
            { user: { postsPrivacy: 'FRIENDS' } },
            { userId: { in: friendIds } },
          ],
        },
      ],
    };
  }

  private async assertViewerCanAccessPost(viewerId: number, postId: number) {
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      select: {
        userId: true,
        user: { select: { postsPrivacy: true } },
      },
    });
    if (!post) throw new NotFoundException('Post not found');
    if (post.userId === viewerId) return;
    const privacy = post.user.postsPrivacy;
    if (privacy === 'ONLY_ME') {
      throw new ForbiddenException('No access to this post');
    }
    if (privacy === 'FRIENDS') {
      const ok = await this.users.areFriends(viewerId, post.userId);
      if (!ok) throw new ForbiddenException('No access to this post');
    }
  }

  /**
   * Пейджинг + приватность + sortBy=likes.
   */
  async getPosts(
    userId: number,
    page = 1,
    legacyLimit = 20,
    sortByRaw?: string,
  ) {
    const timing =
      process.env.NODE_ENV === 'development' &&
      process.env.POSTS_TIMING !== '0';
    const include = feedPostInclude(userId);
    const sortByLikes = sortByRaw === 'likes';

    const friends = await this.users.getFriends(userId);
    const friendIds = friends.map((f) => f.id);
    const where = this.buildFeedVisibilityWhere(userId, friendIds);
    const orderBy = sortByLikes ? feedOrderByLikes : feedOrderByRecent;

    const take = Math.min(Math.max(legacyLimit || 20, 1), 50);
    const safePage = Math.max(page, 1);
    const skip = (safePage - 1) * take;
    const totalCount = await this.prisma.post.count({ where });

    // Забустенные посты всегда идут первыми в ленте — это отдельный блок,
    // независимый от подборки медиа (буст доступен и для опросов, которые
    // в подборку медиа не попадают из-за isPoll: false).
    const boosted = await this.prisma.post.findMany({
      where: { ...where, isBoosted: true },
      orderBy,
      select: { id: true },
    });
    const boostedIds = boosted.map((p) => p.id);
    const boostedCount = boostedIds.length;
    const boostedStart = Math.min(skip, boostedCount);
    const boostedEnd = Math.min(skip + take, boostedCount);
    const boostedSliceIds = boostedIds.slice(boostedStart, boostedEnd);
    const afterBoostSkip = Math.max(skip - boostedCount, 0);
    const afterBoostTake = Math.max(take - boostedSliceIds.length, 0);

    const pinnedWhere: Prisma.PostWhereInput = {
      ...where,
      isPoll: false,
      pollId: null,
      medias: { some: {} },
      id: boostedIds.length ? { notIn: boostedIds } : undefined,
    };
    const pinned = await this.prisma.post.findMany({
      where: pinnedWhere,
      take: FEED_PINNED_MEDIA_COUNT,
      orderBy,
      select: { id: true },
    });
    const pinnedIds = pinned.map((p) => p.id);
    const pinnedCount = pinnedIds.length;
    const pinnedStart = Math.min(afterBoostSkip, pinnedCount);
    const pinnedEnd = Math.min(afterBoostSkip + afterBoostTake, pinnedCount);
    const pinnedSliceIds = pinnedIds.slice(pinnedStart, pinnedEnd);
    const restSkip = Math.max(afterBoostSkip - pinnedCount, 0);
    const restTake = Math.max(afterBoostTake - pinnedSliceIds.length, 0);
    const excludedIds = [...boostedIds, ...pinnedIds];

    if (timing) console.time('getPosts: prisma.findMany');
    const [boostedRowsRaw, pinnedRowsRaw, restRows] = await Promise.all([
      boostedSliceIds.length
        ? this.prisma.post.findMany({
            where: { ...where, id: { in: boostedSliceIds } },
            include,
          })
        : ([] as PostWithFeed[]),
      pinnedSliceIds.length
        ? this.prisma.post.findMany({
            where: { ...where, id: { in: pinnedSliceIds } },
            include,
          })
        : ([] as PostWithFeed[]),
      restTake > 0
        ? this.prisma.post.findMany({
            where: {
              ...where,
              id: excludedIds.length ? { notIn: excludedIds } : undefined,
            },
            skip: restSkip,
            take: restTake,
            orderBy,
            include,
          })
        : ([] as PostWithFeed[]),
    ]);
    if (timing) console.timeEnd('getPosts: prisma.findMany');

    const boostedMap = new Map(boostedRowsRaw.map((row) => [row.id, row]));
    const boostedRows = boostedSliceIds
      .map((id) => boostedMap.get(id))
      .filter((row): row is PostWithFeed => !!row);

    const pinnedMap = new Map(pinnedRowsRaw.map((row) => [row.id, row]));
    const pinnedRows = pinnedSliceIds
      .map((id) => pinnedMap.get(id))
      .filter((row): row is PostWithFeed => !!row);
    const rows = [...boostedRows, ...pinnedRows, ...restRows];

    if (timing) console.time('getPosts: map');
    const firstPageLayout: Array<{
      feedSlot: 0 | 1 | 2;
      feedVariant: 'hero' | 'tile';
    }> = [
      { feedSlot: 0, feedVariant: 'hero' },
      { feedSlot: 1, feedVariant: 'tile' },
      { feedSlot: 2, feedVariant: 'tile' },
    ];
    const mapped = rows.map((row, i) =>
      this.mapFeedPost(
        row,
        safePage === 1 && i < FEED_FIRST_PAGE_LAYOUT_SIZE
          ? firstPageLayout[i]
          : { feedVariant: 'tile' },
        userId,
      ),
    );
    if (timing) console.timeEnd('getPosts: map');

    const hasMore = skip + mapped.length < totalCount;
    return {
      posts: mapped,
      totalCount,
      hasMore,
      page: safePage,
      sortBy: sortByLikes ? 'likes' : 'recent',
    };
  }

  private mapFeedPost(
    row: PostWithFeed,
    extras?: { feedSlot?: 0 | 1 | 2; feedVariant: 'hero' | 'tile' },
    viewerUserId = 0,
  ) {
    const { user, likes, _count, poll, medias, bookmarks, parentPost, ...post } = row;
    const mediaMapped = this.mapPostMedias(medias);
    return {
      ...post,
      ...mediaMapped,
      author: mapPublicUser(user),
      isLiked: likes.length > 0,
      bookmarkedByMe: bookmarks.length > 0,
      likesCount: _count.likes,
      commentsCount: _count.comments,
      poll: this.mapPoll(poll, viewerUserId),
      parentPost: this.mapParentPost(parentPost),
      ...(extras ?? {}),
    };
  }

  async getPost(
    postId: number,
    userId: number,
    opts?: { commentsTake?: number; commentsSkip?: number },
  ) {
    await this.assertViewerCanAccessPost(userId, postId);

    const commentsTake = opts?.commentsTake ?? 20;
    const commentsSkip = opts?.commentsSkip ?? 0;

    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      include: {
        user: { select: { id: true, username: true, avatar: true, level: true, isPremium: true, selectedColorStyle: true } },
        comments: {
          take: commentsTake,
          skip: commentsSkip,
          include: {
            user: { select: { id: true, username: true, avatar: true, level: true, isPremium: true, selectedColorStyle: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
        _count: { select: { likes: true, comments: true } },
        likes: { where: { userId }, select: { id: true } },
        bookmarks: { where: { userId }, select: { id: true } },
        medias: { orderBy: { id: 'asc' } },
        poll: { include: { votes: { select: { optionIndex: true, userId: true } } } },
        parentPost: {
          include: {
            user: { select: { id: true, username: true, avatar: true, level: true, isPremium: true, selectedColorStyle: true } },
            medias: { orderBy: { id: 'asc' } },
          },
        },
      },
    });

    if (!post) throw new NotFoundException('Post not found');

    const { user, likes, _count, comments, poll, medias, bookmarks, parentPost, ...rest } = post;
    const mediaMapped = this.mapPostMedias(medias);

    return {
      ...rest,
      ...mediaMapped,
      author: mapPublicUser(user),
      comments: comments.map((c) => ({
        ...c,
        user: mapPublicUser(c.user),
      })),
      isLiked: likes.length > 0,
      bookmarkedByMe: bookmarks.length > 0,
      likesCount: _count.likes,
      commentsCount: _count.comments,
      poll: this.mapPoll(poll, userId),
      parentPost: this.mapParentPost(parentPost),
    };
  }

  async createRepost(userId: number, originalPostId: number, rawComment: string) {
    await this.assertViewerCanAccessPost(userId, originalPostId);
    const content = rawComment.trim();
    const created = await this.prisma.post.create({
      data: {
        userId,
        content,
        parentPostId: originalPostId,
      },
      include: feedPostInclude(userId),
    });
    await this.xp.awardRepostXp(userId, originalPostId);
    if (content) {
      await this.mentions.notifyMentions(content, userId, created.id);
    }
    return this.mapFeedPost(created, { feedVariant: 'tile' }, userId);
  }

  async boostPost(postId: number, userId: number) {
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const post = await tx.post.findUnique({
        where: { id: postId },
        include: { medias: { select: { id: true } } },
      });
      if (!post) throw new NotFoundException('Post not found');
      if (post.userId !== userId) {
        throw new ForbiddenException('You can boost only your own post');
      }
      if (post.isBoosted) {
        throw new BadRequestException('Post is already boosted');
      }
      if (post.medias.length === 0 && !post.embedUrl) {
        throw new BadRequestException('Only posts with media can be boosted');
      }

      const user = await tx.user.findUnique({
        where: { id: userId },
        select: {
          isPremium: true,
          premiumUntil: true,
          boostTokens: true,
          boostTokensRefreshedAt: true,
        },
      });
      if (!user) throw new NotFoundException('User not found');
      if (!this.isPremiumActive(user)) {
        throw new ForbiddenException('Premium is required to boost posts');
      }

      let tokens = user.boostTokens;
      const refreshedAt = user.boostTokensRefreshedAt ?? now;
      if (now.getTime() - refreshedAt.getTime() >= 7 * 24 * 60 * 60 * 1000) {
        tokens = 3;
        await tx.user.update({
          where: { id: userId },
          data: { boostTokens: tokens, boostTokensRefreshedAt: now },
        });
      }
      if (tokens <= 0) {
        throw new BadRequestException('No boost tokens left');
      }

      await tx.user.update({
        where: { id: userId },
        data: { boostTokens: { decrement: 1 } },
      });
      const boostedUntil = new Date(now.getTime() + BOOST_DURATION_MS);
      await tx.post.update({
        where: { id: postId },
        data: { isBoosted: true, boostedUntil },
      });
      return { boosted: true, postId, boostTokensLeft: tokens - 1, boostedUntil };
    });
  }

  /** Снимает истёкшие бусты и уведомляет авторов о завершении продвижения. */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async expireBoosts() {
    const now = new Date();
    const expired = await this.prisma.post.findMany({
      where: { isBoosted: true, boostedUntil: { lte: now } },
      select: { id: true, userId: true },
    });
    if (expired.length === 0) return;

    await this.prisma.post.updateMany({
      where: { id: { in: expired.map((p) => p.id) } },
      data: { isBoosted: false, boostedUntil: null },
    });

    for (const post of expired) {
      await this.notifications.createNotification({
        userId: post.userId,
        senderId: post.userId,
        type: 'BOOST_ENDED',
        entityId: post.id,
        message: 'Буст вашего поста закончился — он больше не закреплён в топе ленты',
      });
    }
    this.logger.log(`Expired ${expired.length} boost(s)`);
  }

  async getPostComments(
    postId: number,
    viewerId: number,
    page = 1,
    limit = 20,
  ) {
    await this.assertViewerCanAccessPost(viewerId, postId);

    const skip = (page - 1) * limit;

    const [comments, total] = await this.prisma.$transaction([
      this.prisma.comment.findMany({
        where: { postId },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { id: true, username: true, avatar: true, level: true, isPremium: true, selectedColorStyle: true } },
        },
      }),
      this.prisma.comment.count({ where: { postId } }),
    ]);

    return {
      comments: comments.map((c) => ({ ...c, user: mapPublicUser(c.user) })),
      commentsCount: total,
      page,
      limit,
    };
  }

  async getSubscriptionsFeed(userId: number, page = 1, limit = 20) {
    const following = await this.users.getFollowing(userId);
    const followingIds = following.map((u) => u.id);
    if (followingIds.length === 0) {
      return {
        posts: [],
        totalCount: 0,
        hasMore: false,
        page,
      };
    }

    const take = Math.min(Math.max(limit, 1), 50);
    const skip = (Math.max(page, 1) - 1) * take;
    const where: Prisma.PostWhereInput = {
      userId: { in: followingIds },
    };

    const [rows, totalCount] = await this.prisma.$transaction([
      this.prisma.post.findMany({
        where,
        skip,
        take,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: feedPostInclude(userId),
      }),
      this.prisma.post.count({ where }),
    ]);

    const posts = rows.map((row) =>
      this.mapFeedPost(row, { feedVariant: 'tile' }, userId),
    );
    return {
      posts,
      totalCount,
      hasMore: skip + posts.length < totalCount,
      page: Math.max(page, 1),
    };
  }

  async deletePost(postId: number, userId: number) {
    const post = await this.prisma.post.findUnique({ where: { id: postId } });
    if (!post) throw new NotFoundException('Post not found');
    if (post.userId !== userId) throw new ForbiddenException('Not your post');

    await this.prisma.post.delete({ where: { id: postId } });
    return { message: 'Post deleted' };
  }

  async deletePostModerated(postId: number) {
    const post = await this.prisma.post.findUnique({ where: { id: postId } });
    if (!post) throw new NotFoundException('Post not found');

    await this.prisma.post.delete({ where: { id: postId } });
    return { message: 'Post deleted by moderation' };
  }

  async likePost(postId: number, userId: number) {
    await this.assertViewerCanAccessPost(userId, postId);

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.like.findUnique({
        where: { userId_postId: { userId, postId } },
      });

      if (existing) {
        await tx.like.delete({ where: { id: existing.id } });
        return { liked: false };
      }

      await tx.like.create({ data: { userId, postId } });
      
      // XP начисляется внутри своей транзакции, но мы вызываем её после создания лайка
      // чтобы гарантировать что лайк уже существует
      await this.xp.awardLikeXp(userId, postId);
      
      const post = await tx.post.findUnique({
        where: { id: postId },
        select: { userId: true },
      });
      if (post && post.userId !== userId) {
        await this.notifications.createNotification({
          userId: post.userId,
          senderId: userId,
          type: 'LIKE',
          entityId: postId,
        });
      }
      return { liked: true };
    });
  }

  async addComment(postId: number, userId: number, dto: CreateCommentDto) {
    await this.assertViewerCanAccessPost(userId, postId);

    const created = await this.prisma.comment.create({
      data: { postId, userId, text: dto.text },
      include: {
        user: { select: { id: true, username: true, avatar: true, level: true, isPremium: true, selectedColorStyle: true } },
        post: { select: { userId: true } },
      },
    });
    if (created.post.userId !== userId) {
      await this.notifications.createNotification({
        userId: created.post.userId,
        senderId: userId,
        type: 'COMMENT',
        entityId: postId,
      });
    }
    if (dto.text) {
      // Уведомление о меншене ведёт на пост, а не на коммент: фронт всё равно открывает /posts/:id.
      await this.mentions.notifyMentions(dto.text, userId, postId);
    }
    const { post: _post, ...comment } = created;
    return { ...comment, user: mapPublicUser(created.user) };
  }

  async deleteComment(commentId: number, userId: number) {
    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId },
    });
    if (!comment) throw new NotFoundException('Comment not found');
    if (comment.userId !== userId)
      throw new ForbiddenException('Not your comment');

    await this.prisma.comment.delete({ where: { id: commentId } });
    return { message: 'Comment deleted' };
  }

  async votePoll(postId: number, userId: number, optionIndex: number) {
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      include: {
        poll: {
          include: {
            votes: true,
          },
        },
      },
    });
    if (!post) throw new NotFoundException('Post not found');
    if (!post.poll) throw new BadRequestException('Post has no poll');

    const options = Array.isArray(post.poll.options) ? post.poll.options : [];
    if (optionIndex < 0 || optionIndex >= options.length) {
      throw new BadRequestException('Invalid poll option');
    }

    const existingVote = await this.prisma.pollVote.findUnique({
      where: { pollId_userId: { pollId: post.poll.id, userId } },
    });
    if (existingVote && !post.poll.allowChangeVote) {
      throw new BadRequestException('Vote change is not allowed for this poll');
    }
    if (existingVote) {
      await this.prisma.pollVote.update({
        where: { id: existingVote.id },
        data: { optionIndex },
      });
    } else {
      await this.prisma.pollVote.create({
        data: { pollId: post.poll.id, userId, optionIndex },
      });
    }
    if (post.userId !== userId) {
      await this.notifications.createNotification({
        userId: post.userId,
        senderId: userId,
        type: 'VOTE',
        entityId: postId,
      });
    }

    const refreshed = await this.prisma.poll.findUnique({
      where: { id: post.poll.id },
      include: { votes: { select: { optionIndex: true, userId: true } } },
    });
    if (!refreshed) throw new NotFoundException('Poll not found');

    return this.mapPoll(
      {
        id: refreshed.id,
        question: refreshed.question,
        options: refreshed.options,
        allowChangeVote: refreshed.allowChangeVote,
        votes: refreshed.votes,
      },
      userId,
    );
  }
}
