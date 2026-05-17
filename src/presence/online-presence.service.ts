import { Injectable } from '@nestjs/common';

@Injectable()
export class OnlinePresenceService {
  private readonly socketsByUser = new Map<number, Set<string>>();

  /** @returns true if this is the user's first active socket (newly online) */
  addSocket(userId: number, socketId: string): boolean {
    const set = this.socketsByUser.get(userId) ?? new Set<string>();
    const wasEmpty = set.size === 0;
    set.add(socketId);
    this.socketsByUser.set(userId, set);
    return wasEmpty;
  }

  /** @returns true if the user has no sockets left (fully offline) */
  removeSocket(userId: number, socketId: string): boolean {
    const set = this.socketsByUser.get(userId);
    if (!set) return true;
    set.delete(socketId);
    if (set.size === 0) {
      this.socketsByUser.delete(userId);
      return true;
    }
    this.socketsByUser.set(userId, set);
    return false;
  }

  getOnlineUserCount(): number {
    return this.socketsByUser.size;
  }

  getOnlineUserIds(): number[] {
    return Array.from(this.socketsByUser.keys());
  }

  getSocketIdsForUser(userId: number): string[] {
    const set = this.socketsByUser.get(userId);
    return set ? Array.from(set) : [];
  }
}
