import { Injectable } from '@nestjs/common';
import { Prisma, XpActionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const XP_REWARD = {
  LIKE: 5,
  REPOST: 15,
  FOLLOW: 10,
  DAILY: 50,
} as const;

@Injectable()
export class XpService {
  constructor(private prisma: PrismaService) {}

  private isPremiumActive(user: { isPremium: boolean; premiumUntil: Date | null }) {
    if (!user.isPremium) return false;
    if (!user.premiumUntil) return true;
    return user.premiumUntil.getTime() > Date.now();
  }

  private withPremiumBonus(baseAmount: number, user: { isPremium: boolean; premiumUntil: Date | null }) {
    if (!this.isPremiumActive(user)) return baseAmount;
    return Math.round(baseAmount * 1.5);
  }

  static calculateLevel(xp: number): number {
    const safeXp = Math.max(0, Math.floor(xp));
    return Math.min(100, Math.floor(safeXp / 200) + 1);
  }

  async awardLikeXp(userId: number, postId: number) {
    return this.awardXpOnce(userId, 'LIKE', postId, XP_REWARD.LIKE);
  }

  async awardRepostXp(userId: number, originalPostId: number) {
    return this.awardXpOnce(userId, 'REPOST', originalPostId, XP_REWARD.REPOST);
  }

  async awardFollowXp(userId: number, followedUserId: number) {
    return this.awardXpOnce(userId, 'FOLLOW', followedUserId, XP_REWARD.FOLLOW);
  }

  async awardDailyLoginXp(userId: number) {
    const now = new Date();
    const todayKey = this.dayEntityId(now);

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          xp: true,
          level: true,
          lastLoginAt: true,
          isPremium: true,
          premiumUntil: true,
        },
      });
      if (!user) return { awarded: false };

      await tx.user.update({
        where: { id: userId },
        data: { lastLoginAt: now },
      });

      if (this.isSameUtcDay(user.lastLoginAt, now)) {
        return { awarded: false };
      }

      const logCreated = await this.tryCreateXpLog(
        tx,
        userId,
        'DAILY',
        todayKey,
      );
      if (!logCreated) return { awarded: false };

      const amount = this.withPremiumBonus(XP_REWARD.DAILY, user);
      const xp = user.xp + amount;
      const level = XpService.calculateLevel(xp);
      await tx.user.update({
        where: { id: userId },
        data: { xp, level },
      });

      return { awarded: true, xp, level };
    });
  }

  private async awardXpOnce(
    userId: number,
    actionType: XpActionType,
    entityId: number,
    amount: number,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const logCreated = await this.tryCreateXpLog(tx, userId, actionType, entityId);
      if (!logCreated) return { awarded: false };

      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, xp: true, level: true, isPremium: true, premiumUntil: true },
      });
      if (!user) return { awarded: false };
      const amountWithBonus = this.withPremiumBonus(amount, user);
      const xp = user.xp + amountWithBonus;
      const computedLevel = XpService.calculateLevel(xp);

      await tx.user.update({
        where: { id: userId },
        data: { xp, level: computedLevel },
      });

      return { awarded: true, xp, level: computedLevel };
    });
  }

  private async tryCreateXpLog(
    tx: Prisma.TransactionClient,
    userId: number,
    actionType: XpActionType,
    entityId: number,
  ) {
    try {
      await tx.xpLog.create({
        data: { userId, actionType, entityId },
      });
      return true;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return false;
      }
      throw error;
    }
  }

  private dayEntityId(date: Date): number {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return Number(`${y}${m}${d}`);
  }

  private isSameUtcDay(a: Date | null, b: Date): boolean {
    if (!a) return false;
    return (
      a.getUTCFullYear() === b.getUTCFullYear() &&
      a.getUTCMonth() === b.getUTCMonth() &&
      a.getUTCDate() === b.getUTCDate()
    );
  }
}
