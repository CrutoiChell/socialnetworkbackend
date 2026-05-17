import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { mapPublicUser } from '../common/public-url';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { SocketEventsService } from '../presence/socket-events.service';

type GlobalMessageWithUser = Prisma.GlobalMessageGetPayload<{
  include: {
    user: { select: { id: true; username: true; avatar: true; level: true; isPremium: true } };
  };
}>;

type LastMessageRow = {
  id: number;
  text: string | null;
  type: 'TEXT' | 'AUDIO';
  audioData: string | null;
  senderId: number;
  receiverId: number;
  createdAt: Date;
  sender_id: number;
  sender_username: string;
  sender_avatar: string | null;
  sender_level: number;
  sender_is_premium: boolean;
  sender_selected_color_style: string | null;
  receiver_id: number;
  receiver_username: string;
  receiver_avatar: string | null;
  receiver_level: number;
  receiver_is_premium: boolean;
  receiver_selected_color_style: string | null;
};

@Injectable()
export class MessagesService {
  constructor(
    private prisma: PrismaService,
    private users: UsersService,
    private socketEvents: SocketEventsService,
  ) {}

  /**
   * Фронт ожидает sender / senderId (как в личных сообщениях); у GlobalMessage в БД — userId + user.
   */
  toGlobalMessageDto(m: GlobalMessageWithUser) {
    const user = mapPublicUser(m.user);
    return {
      id: m.id,
      text: m.text,
      createdAt: m.createdAt,
      userId: m.userId,
      senderId: m.userId,
      receiverId: null,
      user,
      sender: user,
    };
  }

  async getGlobalMessages(limit = 50) {
    // Берём последние N сообщений и возвращаем в хронологическом порядке (старые → новые).
    const rows = await this.prisma.globalMessage.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, username: true, avatar: true, level: true, isPremium: true, selectedColorStyle: true } },
      },
    });
    return rows.reverse().map((m) => this.toGlobalMessageDto(m));
  }

  /**
   * Последнее сообщение на каждого друга — один запрос, без выгрузки всей истории.
   */
  async getConversations(userId: number) {
    const friends = await this.users.getFriends(userId);
    const friendIds = friends.map((f) => f.id);
    if (friendIds.length === 0) return [];

    const rows = await this.prisma.$queryRaw<LastMessageRow[]>`
      SELECT DISTINCT ON (x.partner_id)
        x.id,
        x.text,
        x.type,
        x."audioData",
        x."senderId",
        x."receiverId",
        x."createdAt",
        s.id AS sender_id,
        s.username AS sender_username,
        s.avatar AS sender_avatar,
        s.level AS sender_level,
        s."isPremium" AS sender_is_premium,
        s."selectedColorStyle" AS sender_selected_color_style,
        r.id AS receiver_id,
        r.username AS receiver_username,
        r.avatar AS receiver_avatar,
        r.level AS receiver_level,
        r."isPremium" AS receiver_is_premium,
        r."selectedColorStyle" AS receiver_selected_color_style
      FROM (
        SELECT
          m.id,
          m.text,
          m.type,
          m."audioData",
          m."senderId",
          m."receiverId",
          m."createdAt",
          CASE WHEN m."senderId" = ${userId} THEN m."receiverId" ELSE m."senderId" END AS partner_id
        FROM messages m
        WHERE m."senderId" = ${userId} OR m."receiverId" = ${userId}
      ) x
      INNER JOIN users s ON s.id = x."senderId"
      INNER JOIN users r ON r.id = x."receiverId"
      WHERE x.partner_id IN (${Prisma.join(friendIds)})
      ORDER BY x.partner_id, x."createdAt" DESC
    `;

    const conversations = rows.map((row) => {
      const lastMessage = {
        id: row.id,
        text: row.text,
        type: row.type,
        audioData: row.audioData,
        senderId: row.senderId,
        receiverId: row.receiverId,
        createdAt: row.createdAt,
        sender: {
          id: row.sender_id,
          username: row.sender_username,
          avatar: row.sender_avatar,
          level: row.sender_level,
          isPremium: row.sender_is_premium,
          selectedColorStyle: row.sender_selected_color_style,
        },
        receiver: {
          id: row.receiver_id,
          username: row.receiver_username,
          avatar: row.receiver_avatar,
          level: row.receiver_level,
          isPremium: row.receiver_is_premium,
          selectedColorStyle: row.receiver_selected_color_style,
        },
      };
      const userRaw =
        row.senderId === userId ? lastMessage.receiver : lastMessage.sender;
      const user = mapPublicUser(userRaw);
      return { user, lastMessage };
    });

    conversations.sort(
      (a, b) =>
        new Date(b.lastMessage.createdAt).getTime() -
        new Date(a.lastMessage.createdAt).getTime(),
    );

    return conversations;
  }

  async getConversation(userId: number, otherUserId: number, limit = 50) {
    const areFriends = await this.users.areFriends(userId, otherUserId);
    if (!areFriends) {
      throw new ForbiddenException('Can only view chat with friends');
    }

    const rows = await this.prisma.message.findMany({
      where: {
        OR: [
          { senderId: userId, receiverId: otherUserId },
          { senderId: otherUserId, receiverId: userId },
        ],
      },
      take: limit,
      orderBy: { createdAt: 'asc' },
      include: {
        sender: { select: { id: true, username: true, avatar: true, level: true, isPremium: true, selectedColorStyle: true } },
        receiver: { select: { id: true, username: true, avatar: true, level: true, isPremium: true, selectedColorStyle: true } },
      },
    });
    return rows.map((m) => ({
      ...m,
      sender: mapPublicUser(m.sender),
      receiver: mapPublicUser(m.receiver),
    }));
  }

  /**
   * Удаление сообщения модератором.
   * Поддерживает оба чата:
   *   - scope='private' → таблица messages
   *   - scope='global'  → таблица global_messages
   * После удаления шлёт WebSocket-событие `message:deleted`:
   *   - В приватном чате — обоим участникам.
   *   - В глобальном — всем подключённым клиентам.
   */
  async deleteMessageByModerator(
    messageId: number,
    scope: 'private' | 'global',
    moderatorId: number,
  ) {
    if (!Number.isFinite(messageId) || messageId < 1) {
      throw new ForbiddenException('Invalid message id');
    }

    if (scope === 'global') {
      const message = await this.prisma.globalMessage.findUnique({
        where: { id: messageId },
      });
      if (!message) throw new NotFoundException('Message not found');

      await this.prisma.globalMessage.delete({ where: { id: messageId } });
      this.socketEvents.emitToAll('message:deleted', {
        messageId,
        scope,
        moderatorId,
      });
      return { deleted: true, messageId, scope };
    }

    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
    });
    if (!message) throw new NotFoundException('Message not found');

    await this.prisma.message.delete({ where: { id: messageId } });
    const payload = { messageId, scope, moderatorId };
    this.socketEvents.emitToUser(message.senderId, 'message:deleted', payload);
    this.socketEvents.emitToUser(message.receiverId, 'message:deleted', payload);
    return { deleted: true, messageId, scope };
  }

  /**
   * Удаление своего сообщения (автор). Проверяет senderId === userId.
   */
  async deleteOwnMessage(
    messageId: number,
    scope: 'private' | 'global',
    userId: number,
  ) {
    if (!Number.isFinite(messageId) || messageId < 1) {
      throw new ForbiddenException('Invalid message id');
    }

    if (scope === 'global') {
      const msg = await this.prisma.globalMessage.findUnique({
        where: { id: messageId },
      });
      if (!msg) throw new NotFoundException('Message not found');
      if (msg.userId !== userId) {
        throw new ForbiddenException('You can only delete your own messages');
      }
      await this.prisma.globalMessage.delete({ where: { id: messageId } });
      this.socketEvents.emitToAll('message:deleted', { messageId, scope, moderatorId: userId });
      return { deleted: true, messageId, scope };
    }

    const msg = await this.prisma.message.findUnique({
      where: { id: messageId },
    });
    if (!msg) throw new NotFoundException('Message not found');
    if (msg.senderId !== userId) {
      throw new ForbiddenException('You can only delete your own messages');
    }
    await this.prisma.message.delete({ where: { id: messageId } });
    const payload = { messageId, scope, moderatorId: userId };
    this.socketEvents.emitToUser(msg.senderId, 'message:deleted', payload);
    this.socketEvents.emitToUser(msg.receiverId, 'message:deleted', payload);
    return { deleted: true, messageId, scope };
  }

  /**
   * Редактирование текста сообщения. Только автор может редактировать.
   * Ставит isEdited=true, обновляет updatedAt.
   */
  async editMessage(
    messageId: number,
    scope: 'private' | 'global',
    userId: number,
    newText: string,
  ) {
    const text = (newText ?? '').trim();
    if (!text) throw new ForbiddenException('Text cannot be empty');
    if (!Number.isFinite(messageId) || messageId < 1) {
      throw new ForbiddenException('Invalid message id');
    }

    if (scope === 'global') {
      const msg = await this.prisma.globalMessage.findUnique({
        where: { id: messageId },
      });
      if (!msg) throw new NotFoundException('Message not found');
      if (msg.userId !== userId) {
        throw new ForbiddenException('You can only edit your own messages');
      }
      const updated = await this.prisma.globalMessage.update({
        where: { id: messageId },
        data: { text },
      });
      this.socketEvents.emitToAll('message:edited', {
        messageId,
        scope,
        text,
        updatedAt: updated.createdAt, // globalMessage не имеет updatedAt — используем createdAt
      });
      return { edited: true, messageId, text };
    }

    const msg = await this.prisma.message.findUnique({
      where: { id: messageId },
    });
    if (!msg) throw new NotFoundException('Message not found');
    if (msg.senderId !== userId) {
      throw new ForbiddenException('You can only edit your own messages');
    }
    const updated = await this.prisma.message.update({
      where: { id: messageId },
      data: { text, isEdited: true },
    });
    const payload = {
      messageId,
      scope,
      text,
      isEdited: true,
      updatedAt: updated.updatedAt,
    };
    this.socketEvents.emitToUser(msg.senderId, 'message:edited', payload);
    this.socketEvents.emitToUser(msg.receiverId, 'message:edited', payload);
    return { edited: true, messageId, text, updatedAt: updated.updatedAt };
  }
}
