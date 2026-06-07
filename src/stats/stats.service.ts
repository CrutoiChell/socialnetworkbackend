import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OnlinePresenceService } from '../presence/online-presence.service';

export type OverviewStats = {
  usersOnline: number;
  posts24h: number;
  newFriendships24h: number;
  globalMessages24h: number;
  privateMessages24h: number;
  newComments24h: number;
};

export type GlobalStats = {
  totalUsers: number;
  totalPosts: number;
  totalFriendships: number;
  totalGlobalMessages: number;
  totalComments: number;
};

@Injectable()
export class StatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly presence: OnlinePresenceService,
  ) {}

  async getOverview(): Promise<OverviewStats> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [
      posts24h,
      newFriendships24h,
      globalMessages24h,
      privateMessages24h,
      newComments24h,
    ] = await Promise.all([
      this.prisma.post.count({ where: { createdAt: { gte: since } } }),
      this.prisma.friendship.count({ where: { createdAt: { gte: since } } }),
      this.prisma.globalMessage.count({ where: { createdAt: { gte: since } } }),
      this.prisma.message.count({ where: { createdAt: { gte: since } } }),
      this.prisma.comment.count({ where: { createdAt: { gte: since } } }),
    ]);

    return {
      usersOnline: this.presence.getOnlineUserCount(),
      posts24h,
      newFriendships24h,
      globalMessages24h,
      privateMessages24h,
      newComments24h,
    };
  }

  async getGlobal(): Promise<GlobalStats> {
    const [totalUsers, totalPosts, totalFriendships, totalGlobalMessages, totalComments] =
      await Promise.all([
        this.prisma.user.count(),
        this.prisma.post.count(),
        this.prisma.friendship.count(),
        this.prisma.globalMessage.count(),
        this.prisma.comment.count(),
      ]);

    return {
      totalUsers,
      totalPosts,
      totalFriendships,
      totalGlobalMessages,
      totalComments,
    };
  }
}
