import { Injectable } from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { mapPublicUser } from '../common/public-url';
import { SocketEventsService } from '../presence/socket-events.service';
import { PrismaService } from '../prisma/prisma.service';

type CreateNotificationInput = {
  userId: number;
  senderId: number;
  type: NotificationType;
  entityId?: number | null;
};

@Injectable()
export class NotificationsService {
  constructor(
    private prisma: PrismaService,
    private socketEvents: SocketEventsService,
  ) {}

  private buildMessage(type: NotificationType, username: string) {
    switch (type) {
      case 'LIKE':
        return `${username} поставил(а) лайк вашему посту`;
      case 'COMMENT':
        return `${username} прокомментировал(а) ваш пост`;
      case 'FOLLOW':
        return `${username} подписался(ась) на вас`;
      case 'VOTE':
        return `${username} проголосовал(а) в вашем опросе`;
      case 'MENTION':
        return `${username} упомянул(а) вас`;
      default:
        return `${username} отправил(а) уведомление`;
    }
  }

  async createNotification(input: CreateNotificationInput) {
    if (input.userId === input.senderId) return null;

    const notification = await this.prisma.notification.create({
      data: {
        userId: input.userId,
        senderId: input.senderId,
        type: input.type,
        entityId: input.entityId ?? null,
      },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            avatar: true,
            level: true,
            isPremium: true,
            selectedColorStyle: true,
          },
        },
      },
    });

    const sender = mapPublicUser(notification.sender);
    const payload = {
      id: notification.id,
      userId: notification.userId,
      senderId: notification.senderId,
      type: notification.type,
      entityId: notification.entityId,
      isRead: notification.isRead,
      createdAt: notification.createdAt,
      sender,
      message: this.buildMessage(notification.type, sender.username),
    };

    this.socketEvents.emitToUser(notification.userId, 'notification:received', payload);
    return payload;
  }

  async getNotifications(userId: number, page = 1, limit = 20) {
    const take = Math.min(Math.max(limit, 1), 50);
    const safePage = Math.max(page, 1);
    const skip = (safePage - 1) * take;

    const [rows, totalCount, unreadCount] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where: { userId },
        skip,
        take,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: {
          sender: {
            select: {
              id: true,
              username: true,
              avatar: true,
              level: true,
              isPremium: true,
              selectedColorStyle: true,
            },
          },
        },
      }),
      this.prisma.notification.count({ where: { userId } }),
      this.prisma.notification.count({ where: { userId, isRead: false } }),
    ]);

    return {
      notifications: rows.map((n) => {
        const sender = mapPublicUser(n.sender);
        return {
          id: n.id,
          userId: n.userId,
          senderId: n.senderId,
          type: n.type,
          entityId: n.entityId,
          isRead: n.isRead,
          createdAt: n.createdAt,
          sender,
          message: this.buildMessage(n.type, sender.username),
        };
      }),
      totalCount,
      unreadCount,
      hasMore: skip + rows.length < totalCount,
      page: safePage,
    };
  }

  async readAll(userId: number) {
    const result = await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
    return { updated: result.count };
  }
}
