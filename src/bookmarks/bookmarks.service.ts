import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { mapPublicUser, toAbsoluteMediaUrl } from '../common/public-url';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BookmarksService {
  constructor(private prisma: PrismaService) {}

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
      if (v.optionIndex >= 0 && v.optionIndex < votes.length) votes[v.optionIndex] += 1;
    }

    return {
      id: poll.id,
      question: poll.question,
      options,
      allowChangeVote: poll.allowChangeVote,
      votes,
      totalVotes: poll.votes.length,
      myVote: poll.votes.find((v) => v.userId === userId)?.optionIndex ?? null,
    };
  }

  private mapPost(
    post: {
      id: number;
      content: string;
      embedUrl: string | null;
      isPoll: boolean;
      parentPostId: number | null;
      createdAt: Date;
      user: { id: number; username: string; avatar: string | null };
      _count: { likes: number; comments: number };
      likes: { id: number }[];
      bookmarks: { id: number }[];
      medias: {
        id: number;
        url: string;
        type: 'IMAGE' | 'VIDEO';
        isSpoiler: boolean;
      }[];
      poll:
        | {
            id: number;
            question: string;
            options: Prisma.JsonValue;
            allowChangeVote: boolean;
            votes: { optionIndex: number; userId: number }[];
          }
        | null;
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
              type: 'IMAGE' | 'VIDEO';
              isSpoiler: boolean;
            }[];
          }
        | null;
    },
    userId: number,
  ) {
    const medias = post.medias.map((m) => ({
      id: m.id,
      url: toAbsoluteMediaUrl(m.url),
      type: m.type,
      isSpoiler: m.isSpoiler,
    }));

    return {
      id: post.id,
      content: post.content,
      embedUrl: post.embedUrl,
      isPoll: post.isPoll,
      parentPostId: post.parentPostId,
      createdAt: post.createdAt,
      author: mapPublicUser(post.user),
      likesCount: post._count.likes,
      commentsCount: post._count.comments,
      likedByMe: post.likes.length > 0,
      bookmarkedByMe: post.bookmarks.length > 0,
      medias,
      image: medias[0]?.url ?? null,
      parentPost:
        post.parentPost == null
          ? null
          : {
              id: post.parentPost.id,
              content: post.parentPost.content,
              embedUrl: post.parentPost.embedUrl,
              createdAt: post.parentPost.createdAt,
              author: mapPublicUser(post.parentPost.user),
              medias: post.parentPost.medias.map((m) => ({
                id: m.id,
                url: toAbsoluteMediaUrl(m.url),
                type: m.type,
                isSpoiler: m.isSpoiler,
              })),
              image:
                post.parentPost.medias.length > 0
                  ? toAbsoluteMediaUrl(post.parentPost.medias[0]?.url ?? null)
                  : null,
            },
      poll: this.mapPoll(post.poll, userId),
    };
  }

  async toggleBookmark(userId: number, postId: number) {
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      select: { id: true },
    });
    if (!post) throw new NotFoundException('Post not found');

    const existing = await this.prisma.bookmark.findUnique({
      where: { userId_postId: { userId, postId } },
    });
    if (existing) {
      await this.prisma.bookmark.delete({ where: { id: existing.id } });
      return { bookmarked: false };
    }

    await this.prisma.bookmark.create({
      data: { userId, postId },
    });
    return { bookmarked: true };
  }

  async getBookmarks(userId: number, page = 1, limit = 20) {
    const take = Math.min(Math.max(limit, 1), 50);
    const safePage = Math.max(page, 1);
    const skip = (safePage - 1) * take;

    const [rows, totalCount] = await this.prisma.$transaction([
      this.prisma.bookmark.findMany({
        where: { userId },
        skip,
        take,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: {
          post: {
            include: {
              user: { select: { id: true, username: true, avatar: true, level: true } },
              _count: { select: { likes: true, comments: true } },
              likes: { where: { userId }, select: { id: true } },
              bookmarks: { where: { userId }, select: { id: true } },
              medias: { orderBy: { id: 'asc' } },
              poll: { include: { votes: { select: { optionIndex: true, userId: true } } } },
              parentPost: {
                include: {
                  user: { select: { id: true, username: true, avatar: true, level: true } },
                  medias: { orderBy: { id: 'asc' } },
                },
              },
            },
          },
        },
      }),
      this.prisma.bookmark.count({ where: { userId } }),
    ]);

    const posts = rows.map((row) => this.mapPost(row.post, userId));
    return {
      posts,
      totalCount,
      hasMore: skip + posts.length < totalCount,
      page: safePage,
    };
  }
}
