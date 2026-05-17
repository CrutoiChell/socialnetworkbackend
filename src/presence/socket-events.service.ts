import { Injectable } from '@nestjs/common';
import type { Server } from 'socket.io';
import { OnlinePresenceService } from './online-presence.service';

@Injectable()
export class SocketEventsService {
  private server: Server | null = null;

  constructor(private presence: OnlinePresenceService) {}

  setServer(server: Server) {
    this.server = server;
  }

  emitToUser<T>(userId: number, event: string, payload: T) {
    if (!this.server) return;
    const socketIds = this.presence.getSocketIdsForUser(userId);
    if (!socketIds.length) return;
    this.server.to(socketIds).emit(event, payload);
  }

  /** Бродкаст всем подключённым клиентам (для глобальных событий вроде удаления сообщения в общем чате). */
  emitToAll<T>(event: string, payload: T) {
    if (!this.server) return;
    this.server.emit(event, payload);
  }
}
