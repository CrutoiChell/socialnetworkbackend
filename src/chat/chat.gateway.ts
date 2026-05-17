import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { BadRequestException } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users/users.service';
import { OnlinePresenceService } from '../presence/online-presence.service';
import { MessagesService } from './messages.service';
import { mapPublicUser } from '../common/public-url';
import { SocketEventsService } from '../presence/socket-events.service';
import { MentionsService } from '../notifications/mentions.service';

@WebSocketGateway({
  cors: {
    origin: [
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:3002',
    ],
    credentials: true,
  },
})
export class ChatGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit
{
  @WebSocketServer()
  server: Server;

  constructor(
    private jwt: JwtService,
    private prisma: PrismaService,
    private config: ConfigService,
    private users: UsersService,
    private presence: OnlinePresenceService,
    private messages: MessagesService,
    private socketEvents: SocketEventsService,
    private mentions: MentionsService,
  ) {}

  afterInit(server: Server) {
    this.socketEvents.setServer(server);
  }

  async handleConnection(socket: Socket) {
    try {
      const token = this.extractToken(socket);
      if (!token) return socket.disconnect();

      const payload = this.jwt.verify<{ sub: number }>(token, {
        secret: this.config.get<string>('JWT_SECRET', 'secret'),
      });

      socket.data.userId = payload.sub;
      const becameOnline = this.presence.addSocket(payload.sub, socket.id);

      console.log(`User ${payload.sub} connected (${socket.id})`);

      if (becameOnline) {
        this.server.emit('userOnline', { userId: payload.sub });
      }
    } catch {
      socket.disconnect();
    }
  }

  handleDisconnect(socket: Socket) {
    const userId = socket.data.userId as number;
    if (userId) {
      const fullyOffline = this.presence.removeSocket(userId, socket.id);
      console.log(`User ${userId} disconnected`);
      if (fullyOffline) {
        this.server.emit('userOffline', { userId });
      }
    }
  }

  @SubscribeMessage('sendMessage')
  async handleSendMessage(
    @ConnectedSocket() socket: Socket,
    @MessageBody()
    data: {
      receiverId: number;
      text?: string;
      type?: 'TEXT' | 'AUDIO';
      audioData?: string;
    },
  ) {
    const senderId = socket.data.userId as number;
    if (!senderId)
      return socket.emit('error', { message: 'Not authenticated' });
    const messageType = data?.type === 'AUDIO' ? 'AUDIO' : 'TEXT';
    const text = data?.text?.trim() ?? '';
    const audioData = data?.audioData?.trim() ?? '';

    if (!data?.receiverId) {
      throw new BadRequestException('receiverId is required');
    }
    if (messageType === 'TEXT' && !text) {
      throw new BadRequestException('text is required');
    }
    if (messageType === 'AUDIO' && !audioData) {
      throw new BadRequestException('audioData is required for audio message');
    }

    const areFriends = await this.users.areFriends(senderId, data.receiverId);
    if (!areFriends) {
      return socket.emit('error', { message: 'Can only message friends' });
    }

    const message = await this.prisma.message.create({
      data: {
        senderId,
        receiverId: data.receiverId,
        type: messageType,
        text: messageType === 'TEXT' ? text : null,
        audioData: messageType === 'AUDIO' ? audioData : null,
      },
      include: {
        sender: { select: { id: true, username: true, avatar: true, level: true, isPremium: true, selectedColorStyle: true } },
      },
    });

    const mapped = { ...message, sender: mapPublicUser(message.sender) };

    if (messageType === 'TEXT' && text) {
      await this.mentions.notifyMentions(text, senderId, message.id);
    }

    const receiverSocketIds = this.presence.getSocketIdsForUser(
      data.receiverId,
    );
    if (receiverSocketIds.length) {
      this.server.to(receiverSocketIds).emit('newMessage', mapped);
    }

    socket.emit('messageSent', mapped);
  }

  @SubscribeMessage('sendGlobalMessage')
  async handleGlobalMessage(
    @ConnectedSocket() socket: Socket,
    @MessageBody() data: { text: string },
  ) {
    const userId = socket.data.userId as number;
    if (!userId) return socket.emit('error', { message: 'Not authenticated' });
    if (!data?.text?.trim()) {
      throw new BadRequestException('text is required');
    }

    const message = await this.prisma.globalMessage.create({
      data: { userId, text: data.text.trim() },
      include: {
        user: { select: { id: true, username: true, avatar: true, level: true, isPremium: true, selectedColorStyle: true } },
      },
    });

    await this.mentions.notifyMentions(data.text, userId, message.id);

    this.server.emit(
      'newGlobalMessage',
      this.messages.toGlobalMessageDto(message),
    );
  }

  @SubscribeMessage('getOnlineUsers')
  handleGetOnlineUsers(@ConnectedSocket() socket: Socket) {
    socket.emit('onlineUsers', this.presence.getOnlineUserIds());
  }

  /**
   * Модерация: удаление сообщения по WS. Доступ — только ADMIN/MODERATOR.
   * Принимаем `{ messageId, scope: 'private' | 'global' }`. После удаления
   * `MessagesService` сам разошлёт событие `message:deleted` участникам/всем.
   */
  @SubscribeMessage('message:delete')
  async handleModeratorDelete(
    @ConnectedSocket() socket: Socket,
    @MessageBody() data: { messageId: number; scope?: 'private' | 'global' },
  ) {
    const moderatorId = socket.data.userId as number;
    if (!moderatorId)
      return socket.emit('error', { message: 'Not authenticated' });
    if (!data?.messageId || !Number.isFinite(data.messageId)) {
      return socket.emit('error', { message: 'Invalid messageId' });
    }

    const moderator = await this.prisma.user.findUnique({
      where: { id: moderatorId },
      select: { role: true },
    });
    if (
      !moderator ||
      (moderator.role !== 'ADMIN' && moderator.role !== 'MODERATOR')
    ) {
      return socket.emit('error', { message: 'Insufficient permissions' });
    }

    try {
      const scope = data.scope === 'global' ? 'global' : 'private';
      await this.messages.deleteMessageByModerator(
        data.messageId,
        scope,
        moderatorId,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Delete failed';
      socket.emit('error', { message });
    }
  }

  private extractToken(socket: Socket): string | undefined {
    const authToken = socket.handshake.auth?.token;
    if (typeof authToken === 'string' && authToken.length > 0) {
      return authToken;
    }

    const queryToken = socket.handshake.query?.token;
    if (typeof queryToken === 'string' && queryToken.length > 0) {
      return queryToken;
    }

    const authHeader = socket.handshake.headers?.authorization;
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      return authHeader.slice(7);
    }

    return undefined;
  }
}
