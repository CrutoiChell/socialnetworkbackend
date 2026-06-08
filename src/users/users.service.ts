import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { UserTheme } from '@prisma/client';
import { mapPublicUser, toAbsoluteMediaUrl } from '../common/public-url';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { XpService } from '../xp/xp.service';

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private xp: XpService,
  ) {}

  async getUser(userId: number) {
    if (
      userId === undefined ||
      userId === null ||
      typeof userId !== 'number' ||
      !Number.isFinite(userId) ||
      !Number.isInteger(userId) ||
      userId < 1
    ) {
      throw new BadRequestException('Invalid user id');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        email: true,
        avatar: true,
        banner: true,
        role: true,
        isBlocked: true,
        isPremium: true,
        premiumUntil: true,
        boostTokens: true,
        xp: true,
        level: true,
        createdAt: true,
        selectedColorStyle: true,
        lastUsernameChange: true,
        selectedTheme: true,
        _count: {
          select: {
            posts: true,
            followers: true,
            following: true,
          },
        },
      },
    });

    if (!user) throw new NotFoundException('User not found');
    return mapPublicUser(user);
  }

  async searchUsers(query: string) {
    if (!query || query.length < 2) return [];

    return this.prisma.user
      .findMany({
        where: {
          username: { contains: query, mode: 'insensitive' },
        },
        select: {
          id: true,
          username: true,
          avatar: true,
          isPremium: true,
          level: true,
          selectedColorStyle: true,
          role: true,
          isBlocked: true,
          blockedUntil: true,
        },
        take: 20,
      })
      .then((rows) => rows.map((u) => mapPublicUser(u)));
  }

  /** Поиск пользователя по @username (регистронезависимо) — для меншенов и переходов на профиль. */
  async getByUsername(rawName: string) {
    const name = (rawName ?? '').trim();
    if (!name || !/^[a-zA-Z0-9_]{1,30}$/.test(name)) {
      throw new BadRequestException('Invalid username');
    }
    const user = await this.prisma.user.findFirst({
      where: { username: { equals: name, mode: 'insensitive' } },
      select: {
        id: true,
        username: true,
        avatar: true,
        level: true,
        isPremium: true,
        selectedColorStyle: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return mapPublicUser(user);
  }

  /**
   * Случайная выборка для «Рекомендуемые» (без сырого SQL — надёжнее в разных окружениях).
   */
  async getRandomUserSample(excludeUserId: number, take = 4) {
    const where =
      excludeUserId > 0 ? { id: { not: excludeUserId } } : undefined;
    const rows = await this.prisma.user.findMany({
      where,
      select: { id: true, username: true, avatar: true, level: true, isPremium: true, selectedColorStyle: true },
    });
    if (rows.length === 0) return [];
    const shuffled = [...rows];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled.slice(0, take).map((u) => mapPublicUser(u));
  }

  /** Новые регистрации для блока «Недавние». */
  async getRecentUserSample(excludeUserId: number, take = 4) {
    const rows = await this.prisma.user.findMany({
      where: excludeUserId > 0 ? { id: { not: excludeUserId } } : undefined,
      orderBy: { createdAt: 'desc' },
      take,
      select: { id: true, username: true, avatar: true, level: true, isPremium: true, selectedColorStyle: true },
    });
    return rows.map((u) => mapPublicUser(u));
  }

  async getDiscoverFeed(currentUserId: number) {
    const [recommended, recent] = await Promise.all([
      this.getRandomUserSample(currentUserId, 4),
      this.getRecentUserSample(currentUserId, 4),
    ]);
    const recIds = new Set(recommended.map((u) => u.id));
    const recentDeduped = recent.filter((u) => !recIds.has(u.id));
    return { recommended, recent: recentDeduped };
  }

  async subscribe(followerId: number, followingId: number) {
    if (followerId === followingId) {
      throw new BadRequestException('Cannot subscribe to yourself');
    }

    const following = await this.prisma.user.findUnique({
      where: { id: followingId },
    });
    if (!following) throw new NotFoundException('User not found');

    const existing = await this.prisma.subscription.findUnique({
      where: { followerId_followingId: { followerId, followingId } },
    });

    if (existing) {
      throw new BadRequestException('Already subscribed');
    }

    await this.prisma.subscription.create({
      data: { followerId, followingId },
    });
    await this.xp.awardFollowXp(followerId, followingId);
    await this.notifications.createNotification({
      userId: followingId,
      senderId: followerId,
      type: 'FOLLOW',
      entityId: followingId,
    });

    // Проверяем взаимную подписку для создания дружбы
    const mutualSubscription = await this.prisma.subscription.findUnique({
      where: {
        followerId_followingId: {
          followerId: followingId,
          followingId: followerId,
        },
      },
    });

    if (mutualSubscription) {
      const [user1Id, user2Id] =
        followerId < followingId
          ? [followerId, followingId]
          : [followingId, followerId];

      const existingFriendship = await this.prisma.friendship.findUnique({
        where: { user1Id_user2Id: { user1Id, user2Id } },
      });

      if (!existingFriendship) {
        await this.prisma.friendship.create({
          data: { user1Id, user2Id },
        });
      }
    }

    return { subscribed: true, areFriends: !!mutualSubscription };
  }

  async unsubscribe(followerId: number, followingId: number) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { followerId_followingId: { followerId, followingId } },
    });

    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }

    await this.prisma.subscription.delete({ where: { id: subscription.id } });

    // Удаляем дружбу если была
    const [user1Id, user2Id] =
      followerId < followingId
        ? [followerId, followingId]
        : [followingId, followerId];
    await this.prisma.friendship.deleteMany({
      where: { user1Id, user2Id },
    });

    return { unsubscribed: true };
  }

  /** Один ответ для профиля: три параллельных запроса к БД, один HTTP round-trip с фронта. */
  async getSocialBundle(userId: number) {
    const [friends, followers, following] = await Promise.all([
      this.getFriends(userId),
      this.getFollowers(userId),
      this.getFollowing(userId),
    ]);
    return { friends, followers, following };
  }

  async getFriends(userId: number) {
    const friendships = await this.prisma.friendship.findMany({
      where: {
        OR: [{ user1Id: userId }, { user2Id: userId }],
      },
      include: {
        user1: { select: { id: true, username: true, avatar: true, level: true, isPremium: true, selectedColorStyle: true } },
        user2: { select: { id: true, username: true, avatar: true, level: true, isPremium: true, selectedColorStyle: true } },
      },
    });

    return friendships.map((f) =>
      mapPublicUser(f.user1Id === userId ? f.user2 : f.user1),
    );
  }

  async getFollowers(userId: number) {
    const subscriptions = await this.prisma.subscription.findMany({
      where: { followingId: userId },
      include: {
        follower: { select: { id: true, username: true, avatar: true, level: true, isPremium: true, selectedColorStyle: true } },
      },
    });

    return subscriptions.map((s) => mapPublicUser(s.follower));
  }

  async getFollowing(userId: number) {
    const subscriptions = await this.prisma.subscription.findMany({
      where: { followerId: userId },
      include: {
        following: { select: { id: true, username: true, avatar: true, level: true, isPremium: true, selectedColorStyle: true } },
      },
    });

    return subscriptions.map((s) => mapPublicUser(s.following));
  }

  async areFriends(user1Id: number, user2Id: number): Promise<boolean> {
    if (
      !Number.isFinite(user1Id) ||
      !Number.isFinite(user2Id) ||
      user1Id === user2Id
    ) {
      return false;
    }

    const [userId1, userId2] =
      user1Id < user2Id ? [user1Id, user2Id] : [user2Id, user1Id];

    const friendship = await this.prisma.friendship.findUnique({
      where: { user1Id_user2Id: { user1Id: userId1, user2Id: userId2 } },
    });

    return !!friendship;
  }

  async getRelationshipStatus(currentUserId: number, targetUserId: number) {
    if (!Number.isFinite(currentUserId) || !Number.isFinite(targetUserId)) {
      throw new BadRequestException('Invalid user id');
    }

    if (currentUserId === targetUserId) {
      return {
        isSelf: true,
        isFollowing: false,
        followedByTarget: false,
        areFriends: false,
        canMessage: false,
      };
    }

    const [isFollowing, followedByTarget, areFriends] = await Promise.all([
      this.prisma.subscription.findUnique({
        where: {
          followerId_followingId: {
            followerId: currentUserId,
            followingId: targetUserId,
          },
        },
      }),
      this.prisma.subscription.findUnique({
        where: {
          followerId_followingId: {
            followerId: targetUserId,
            followingId: currentUserId,
          },
        },
      }),
      this.areFriends(currentUserId, targetUserId),
    ]);

    return {
      isSelf: false,
      isFollowing: !!isFollowing,
      followedByTarget: !!followedByTarget,
      areFriends,
      /** Личные сообщения только при взаимной дружбе (та же логика, что у WebSocket). */
      canMessage: areFriends,
    };
  }

  async updateAvatar(userId: number, avatarUrl: string) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { avatar: avatarUrl },
      select: {
        id: true,
        username: true,
        email: true,
        avatar: true,
        banner: true,
        role: true,
        isBlocked: true,
        isPremium: true,
        premiumUntil: true,
        boostTokens: true,
        xp: true,
        level: true,
        selectedColorStyle: true,
        lastUsernameChange: true,
        selectedTheme: true,
      },
    });

    return {
      user: mapPublicUser(user),
      message: 'Avatar updated successfully',
    };
  }

  async updateBanner(userId: number, bannerPath: string | null) {
    const targetUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isPremium: true, premiumUntil: true },
    });
    if (!targetUser) throw new NotFoundException('User not found');
    if (!this.isPremiumActive(targetUser)) {
      throw new BadRequestException(
        'Кастомный баннер профиля доступен только пользователям Stelar Premium',
      );
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { banner: bannerPath },
      select: {
        id: true,
        username: true,
        email: true,
        avatar: true,
        banner: true,
        role: true,
        isBlocked: true,
        isPremium: true,
        premiumUntil: true,
        boostTokens: true,
        xp: true,
        level: true,
        selectedColorStyle: true,
        lastUsernameChange: true,
        selectedTheme: true,
      },
    });

    return {
      user: mapPublicUser(user),
      message: bannerPath ? 'Banner updated successfully' : 'Banner removed',
    };
  }

  private isPremiumActive(user: { isPremium: boolean; premiumUntil: Date | null }) {
    if (!user.isPremium) return false;
    if (!user.premiumUntil) return true;
    return user.premiumUntil.getTime() > Date.now();
  }

  /**
   * Меняет тему оформления. DEFAULT и NEBULA доступны всем.
   * SUPERNOVA — только при активном Premium (см. `isPremiumActive`).
   */
  async setTheme(userId: number, theme: string) {
    const PREMIUM_THEMES = new Set(['NEBULA', 'SUPERNOVA', 'AURORA_DEEP', 'VOID_HORIZON']);
    const LEVEL_GATED_THEMES: Record<string, number> = {
      PULSAR_RING: 100,
    };
    const ALLOWED_THEMES = new Set([
      'DEFAULT',
      'NEBULA',
      'SUPERNOVA',
      'PULSAR_RING',
      'AURORA_DEEP',
      'VOID_HORIZON',
    ]);

    if (!ALLOWED_THEMES.has(theme)) {
      throw new BadRequestException('Invalid theme');
    }

    if (PREMIUM_THEMES.has(theme) || LEVEL_GATED_THEMES[theme] != null) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { isPremium: true, premiumUntil: true, level: true },
      });
      if (!user) throw new NotFoundException('User not found');

      if (PREMIUM_THEMES.has(theme) && !this.isPremiumActive(user)) {
        throw new ForbiddenException(
          `Тема ${theme} доступна только при активном Premium`,
        );
      }

      const requiredLevel = LEVEL_GATED_THEMES[theme];
      if (requiredLevel != null && (user.level ?? 0) < requiredLevel) {
        throw new ForbiddenException(
          `Тема ${theme} открывается на уровне ${requiredLevel}`,
        );
      }
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { selectedTheme: theme as UserTheme },
      select: {
        id: true,
        username: true,
        email: true,
        avatar: true,
        banner: true,
        role: true,
        isBlocked: true,
        isPremium: true,
        premiumUntil: true,
        boostTokens: true,
        xp: true,
        level: true,
        selectedColorStyle: true,
        lastUsernameChange: true,
        selectedTheme: true,
      },
    });

    return {
      user: mapPublicUser(updated),
      message: `Тема обновлена: ${theme}`,
    };
  }

  /**
   * Premium-only: сохраняет выбранный стиль ника.
   * Допустимые значения должны входить в ALLOWED_COLOR_STYLES; null — сброс на дефолт.
   */
  async customizeColor(userId: number, colorStyle: string | null) {
    const ALLOWED_COLOR_STYLES = new Set([
      'tier-junk',
      'tier-dust',
      'tier-meteor',
      'tier-supernova',
      'tier-pulsar',
      'premium',
      'premium-cosmic',
      'premium-aurora',
      'premium-plasma',
      'premium-gold',
      'premium-stardust',
      'premium-void',
    ]);

    if (colorStyle != null && !ALLOWED_COLOR_STYLES.has(colorStyle)) {
      throw new BadRequestException('Invalid color style');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, level: true, isPremium: true, premiumUntil: true },
    });
    if (!user) throw new NotFoundException('User not found');
    if (!this.isPremiumActive(user)) {
      throw new ForbiddenException('Premium subscription is required');
    }

    if (colorStyle && colorStyle.startsWith('tier-')) {
      const minLevelByTier: Record<string, number> = {
        'tier-junk': 1,
        'tier-dust': 11,
        'tier-meteor': 31,
        'tier-supernova': 61,
        'tier-pulsar': 91,
      };
      const required = minLevelByTier[colorStyle] ?? 1;
      if (user.level < required) {
        throw new ForbiddenException(
          `Tier ${colorStyle} requires level ${required}, you are level ${user.level}`,
        );
      }
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { selectedColorStyle: colorStyle },
      select: {
        id: true,
        username: true,
        email: true,
        avatar: true,
        banner: true,
        role: true,
        isBlocked: true,
        isPremium: true,
        premiumUntil: true,
        boostTokens: true,
        xp: true,
        level: true,
        selectedColorStyle: true,
        lastUsernameChange: true,
        selectedTheme: true,
      },
    });

    return {
      user: mapPublicUser(updated),
      message: colorStyle ? 'Стиль ника обновлён' : 'Стиль ника сброшен',
    };
  }

  /**
   * Смена @username не чаще, чем раз в 30 дней. Уникальность проверяется регистронезависимо.
   */
  async changeUsername(userId: number, rawUsername: string) {
    const username = (rawUsername ?? '').trim();
    if (!username) {
      throw new BadRequestException('Username is required');
    }
    if (username.length < 3 || username.length > 30) {
      throw new BadRequestException('Username must be 3–30 characters long');
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      throw new BadRequestException(
        'Username may contain only letters, digits and underscores',
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        lastUsernameChange: true,
        isPremium: true,
        premiumUntil: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');

    // Динамический кулдаун: Premium-пользователи могут менять ник раз в 3 дня,
    // обычные — раз в 30 дней.
    const isPremiumActive = this.isPremiumActive(user);
    const COOLDOWN_DAYS = isPremiumActive ? 3 : 30;
    const COOLDOWN_MS = COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
    const last = user.lastUsernameChange;
    if (last) {
      const elapsed = Date.now() - last.getTime();
      if (elapsed < COOLDOWN_MS) {
        const daysLeft = Math.ceil((COOLDOWN_MS - elapsed) / (24 * 60 * 60 * 1000));
        throw new ForbiddenException(
          `Сменить ник можно раз в ${COOLDOWN_DAYS} дн. Осталось ${daysLeft} дн.`,
        );
      }
    }

    if (username.toLowerCase() === user.username.toLowerCase()) {
      throw new BadRequestException('New username matches the current one');
    }

    const taken = await this.prisma.user.findFirst({
      where: { username: { equals: username, mode: 'insensitive' }, NOT: { id: userId } },
      select: { id: true },
    });
    if (taken) {
      throw new ConflictException('Username already taken');
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        username,
        lastUsernameChange: new Date(),
      },
      select: {
        id: true,
        username: true,
        email: true,
        avatar: true,
        banner: true,
        role: true,
        isBlocked: true,
        isPremium: true,
        premiumUntil: true,
        boostTokens: true,
        xp: true,
        level: true,
        selectedColorStyle: true,
        lastUsernameChange: true,
        selectedTheme: true,
      },
    });

    return {
      user: mapPublicUser(updated),
      message: 'Никнейм обновлён',
    };
  }

  private readonly moderationUserSelect = {
    id: true,
    username: true,
    email: true,
    avatar: true,
    banner: true,
    role: true,
    isBlocked: true,
    blockedUntil: true,
    isPremium: true,
    premiumUntil: true,
    boostTokens: true,
    xp: true,
    level: true,
    selectedColorStyle: true,
    lastUsernameChange: true,
    selectedTheme: true,
  } as const;

  async blockUser(targetUserId: number, moderatorUserId: number, hours?: number) {
    if (targetUserId === moderatorUserId) {
      throw new BadRequestException('You cannot block yourself');
    }

    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, role: true, isBlocked: true },
    });
    if (!target) throw new NotFoundException('User not found');

    if (target.role === 'ADMIN') {
      throw new BadRequestException('Admin user cannot be blocked');
    }

    const blockedUntil = hours ? new Date(Date.now() + hours * 60 * 60 * 1000) : null;

    const updated = await this.prisma.user.update({
      where: { id: targetUserId },
      data: { isBlocked: true, blockedUntil },
      select: this.moderationUserSelect,
    });

    return {
      message: blockedUntil
        ? `User blocked until ${blockedUntil.toISOString()}`
        : 'User blocked successfully',
      user: mapPublicUser(updated),
    };
  }

  async unblockUser(targetUserId: number, moderatorUserId: number) {
    if (targetUserId === moderatorUserId) {
      throw new BadRequestException('You cannot unblock yourself');
    }

    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, isBlocked: true },
    });
    if (!target) throw new NotFoundException('User not found');

    const updated = await this.prisma.user.update({
      where: { id: targetUserId },
      data: { isBlocked: false, blockedUntil: null },
      select: this.moderationUserSelect,
    });

    return {
      message: target.isBlocked ? 'User unblocked successfully' : 'User was not blocked',
      user: mapPublicUser(updated),
    };
  }

  /** Отправляет пользователю предупреждение модератора в виде уведомления с произвольным текстом. */
  async warnUser(targetUserId: number, moderatorId: number, message: string) {
    if (targetUserId === moderatorId) {
      throw new BadRequestException('You cannot warn yourself');
    }

    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true },
    });
    if (!target) throw new NotFoundException('User not found');

    await this.notifications.createNotification({
      userId: targetUserId,
      senderId: moderatorId,
      type: 'WARNING',
      message,
    });

    return { message: 'Warning sent to user' };
  }

  /** Назначение роли пользователю. Доступно только администратору. */
  async updateUserRole(
    targetUserId: number,
    newRole: 'USER' | 'MODERATOR' | 'ADMIN',
    actingAdminId: number,
  ) {
    if (targetUserId === actingAdminId) {
      throw new BadRequestException('You cannot change your own role');
    }

    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, role: true },
    });
    if (!target) throw new NotFoundException('User not found');

    const updated = await this.prisma.user.update({
      where: { id: targetUserId },
      data: { role: newRole },
      select: {
        id: true,
        username: true,
        email: true,
        avatar: true,
        banner: true,
        role: true,
        isBlocked: true,
        isPremium: true,
        premiumUntil: true,
        boostTokens: true,
        xp: true,
        level: true,
        selectedColorStyle: true,
        lastUsernameChange: true,
        selectedTheme: true,
      },
    });

    return {
      message:
        target.role === newRole
          ? `User already has role ${newRole}`
          : `Role updated to ${newRole}`,
      user: mapPublicUser(updated),
    };
  }

  async getUserPosts(
    currentUserId: number,
    targetUserId: number,
    page = 1,
    limit = 20,
  ) {
    const skip = (page - 1) * limit;

    // Privacy: смотрим уровень приватности постов автора и решаем, что показать.
    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { postsPrivacy: true },
    });
    if (!target) throw new NotFoundException('User not found');

    const isSelf = currentUserId === targetUserId;
    if (!isSelf) {
      if (target.postsPrivacy === 'ONLY_ME') {
        return { posts: [], totalCount: 0, hasMore: false, page };
      }
      if (target.postsPrivacy === 'FRIENDS') {
        const friend = await this.areFriends(currentUserId, targetUserId);
        if (!friend) {
          return { posts: [], totalCount: 0, hasMore: false, page };
        }
      }
    }

    const [posts, totalCount] = await Promise.all([
      this.prisma.post.findMany({
        where: { userId: targetUserId },
        skip,
        take: limit,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: {
          user: { select: { id: true, username: true, avatar: true, level: true, isPremium: true, selectedColorStyle: true } },
          _count: { select: { likes: true, comments: true } },
          likes: { where: { userId: currentUserId }, select: { id: true } },
          bookmarks: { where: { userId: currentUserId }, select: { id: true } },
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
        },
      }),
      this.prisma.post.count({ where: { userId: targetUserId } }),
    ]);

    const mapped = posts.map((post) => {
      const { user, likes, _count, medias, poll, bookmarks, parentPost, ...rest } = post;
      const normalizedMedias = medias.map((m) => ({
        id: m.id,
        url: toAbsoluteMediaUrl(m.url),
        type: m.type,
        isSpoiler: m.isSpoiler,
      }));
      const normalizedParent =
        parentPost == null
          ? null
          : {
              id: parentPost.id,
              content: parentPost.content,
              embedUrl: parentPost.embedUrl,
              createdAt: parentPost.createdAt,
              author: mapPublicUser(parentPost.user),
              medias: parentPost.medias.map((m) => ({
                id: m.id,
                url: toAbsoluteMediaUrl(m.url),
                type: m.type,
                isSpoiler: m.isSpoiler,
              })),
              image:
                parentPost.medias.length > 0
                  ? toAbsoluteMediaUrl(parentPost.medias[0]?.url ?? null)
                  : null,
            };
      const pollOptions =
        poll && Array.isArray(poll.options) && poll.options.every((v) => typeof v === 'string')
          ? (poll.options as string[])
          : [];
      const pollVotes = poll
        ? poll.votes.reduce<number[]>((acc, v) => {
            if (!acc[v.optionIndex]) acc[v.optionIndex] = 0;
            acc[v.optionIndex] += 1;
            return acc;
          }, new Array(pollOptions.length).fill(0))
        : [];
      return {
        ...rest,
        isPoll: rest.isPoll,
        image: normalizedMedias[0]?.url ?? null,
        medias: normalizedMedias,
        author: mapPublicUser(user),
        isLiked: likes.length > 0,
        bookmarkedByMe: bookmarks.length > 0,
        likesCount: _count.likes,
        commentsCount: _count.comments,
        parentPostId: rest.parentPostId,
        parentPost: normalizedParent,
        poll: poll
          ? {
              id: poll.id,
              question: poll.question,
              options: pollOptions,
              allowChangeVote: poll.allowChangeVote,
              votes: pollVotes,
              totalVotes: poll.votes.length,
              myVote:
                poll.votes.find((v) => v.userId === currentUserId)?.optionIndex ??
                null,
            }
          : null,
      };
    });

    return {
      posts: mapped,
      totalCount,
      hasMore: skip + mapped.length < totalCount,
      page,
    };
  }

  async getLikedPosts(userId: number, page = 1, limit = 20) {
    const take = Math.min(Math.max(limit, 1), 50);
    const safePage = Math.max(page, 1);
    const skip = (safePage - 1) * take;

    const [rows, totalCount] = await this.prisma.$transaction([
      this.prisma.like.findMany({
        where: { userId },
        skip,
        take,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: {
          post: {
            include: {
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
            },
          },
        },
      }),
      this.prisma.like.count({ where: { userId } }),
    ]);

    const posts = rows.map((row) => {
      const { post } = row;
      const { user, likes, _count, medias, poll, bookmarks, parentPost, ...rest } = post;
      const normalizedMedias = medias.map((m) => ({
        id: m.id,
        url: toAbsoluteMediaUrl(m.url),
        type: m.type,
        isSpoiler: m.isSpoiler,
      }));
      const normalizedParent =
        parentPost == null
          ? null
          : {
              id: parentPost.id,
              content: parentPost.content,
              embedUrl: parentPost.embedUrl,
              createdAt: parentPost.createdAt,
              author: mapPublicUser(parentPost.user),
              medias: parentPost.medias.map((m) => ({
                id: m.id,
                url: toAbsoluteMediaUrl(m.url),
                type: m.type,
                isSpoiler: m.isSpoiler,
              })),
              image:
                parentPost.medias.length > 0
                  ? toAbsoluteMediaUrl(parentPost.medias[0]?.url ?? null)
                  : null,
            };
      const pollOptions =
        poll &&
        Array.isArray(poll.options) &&
        poll.options.every((v) => typeof v === 'string')
          ? (poll.options as string[])
          : [];
      const pollVotes = poll
        ? poll.votes.reduce<number[]>((acc, v) => {
            if (!acc[v.optionIndex]) acc[v.optionIndex] = 0;
            acc[v.optionIndex] += 1;
            return acc;
          }, new Array(pollOptions.length).fill(0))
        : [];

      return {
        ...rest,
        image: normalizedMedias[0]?.url ?? null,
        medias: normalizedMedias,
        author: mapPublicUser(user),
        isLiked: likes.length > 0,
        bookmarkedByMe: bookmarks.length > 0,
        likesCount: _count.likes,
        commentsCount: _count.comments,
        parentPostId: rest.parentPostId,
        parentPost: normalizedParent,
        poll: poll
          ? {
              id: poll.id,
              question: poll.question,
              options: pollOptions,
              allowChangeVote: poll.allowChangeVote,
              votes: pollVotes,
              totalVotes: poll.votes.length,
              myVote:
                poll.votes.find((v) => v.userId === userId)?.optionIndex ??
                null,
            }
          : null,
      };
    });

    return {
      posts,
      totalCount,
      hasMore: skip + posts.length < totalCount,
      page: safePage,
    };
  }

  async activatePremiumDemo(userId: number) {
    const now = new Date();
    const premiumUntil = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        isPremium: true,
        premiumUntil,
        boostTokens: 3,
        boostTokensRefreshedAt: now,
      },
      select: {
        id: true,
        username: true,
        email: true,
        avatar: true,
        banner: true,
        role: true,
        isBlocked: true,
        isPremium: true,
        premiumUntil: true,
        boostTokens: true,
        xp: true,
        level: true,
        selectedColorStyle: true,
        lastUsernameChange: true,
        selectedTheme: true,
      },
    });

    return {
      user: mapPublicUser(user),
      message: 'Stellar Premium активирован на 5 дней (пробный период)',
    };
  }
}
