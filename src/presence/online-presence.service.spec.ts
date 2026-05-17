import { OnlinePresenceService } from './online-presence.service';

describe('OnlinePresenceService', () => {
  let service: OnlinePresenceService;

  beforeEach(() => {
    service = new OnlinePresenceService();
  });

  describe('addSocket', () => {
    it('первый сокет пользователя — становится онлайн', () => {
      expect(service.addSocket(1, 'sock-a')).toBe(true);
    });

    it('второй сокет того же пользователя — уже был онлайн', () => {
      service.addSocket(1, 'sock-a');
      expect(service.addSocket(1, 'sock-b')).toBe(false);
    });
  });

  describe('removeSocket', () => {
    it('последний сокет — пользователь уходит в офлайн', () => {
      service.addSocket(1, 'sock-a');
      expect(service.removeSocket(1, 'sock-a')).toBe(true);
    });

    it('не последний сокет — остаётся онлайн', () => {
      service.addSocket(1, 'sock-a');
      service.addSocket(1, 'sock-b');
      expect(service.removeSocket(1, 'sock-a')).toBe(false);
    });

    it('удаление неизвестного — не падает', () => {
      expect(service.removeSocket(99, 'no-such')).toBe(true);
    });
  });

  describe('queries', () => {
    it('getOnlineUserCount считает уникальных пользователей', () => {
      service.addSocket(1, 'a');
      service.addSocket(1, 'b');
      service.addSocket(2, 'c');
      expect(service.getOnlineUserCount()).toBe(2);
    });

    it('getOnlineUserIds возвращает все ID', () => {
      service.addSocket(1, 'a');
      service.addSocket(2, 'b');
      const ids = service.getOnlineUserIds().sort();
      expect(ids).toEqual([1, 2]);
    });

    it('getSocketIdsForUser возвращает все сокеты пользователя', () => {
      service.addSocket(1, 'a');
      service.addSocket(1, 'b');
      const sockets = service.getSocketIdsForUser(1).sort();
      expect(sockets).toEqual(['a', 'b']);
    });

    it('getSocketIdsForUser возвращает [] для неизвестного', () => {
      expect(service.getSocketIdsForUser(404)).toEqual([]);
    });
  });
});
