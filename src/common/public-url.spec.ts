import { mapPublicUser, publicBaseUrl, toAbsoluteMediaUrl } from './public-url';

describe('public-url helpers', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.PUBLIC_APP_URL;
    delete process.env.PORT;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  describe('publicBaseUrl', () => {
    it('по умолчанию http://localhost:4000', () => {
      expect(publicBaseUrl()).toBe('http://localhost:4000');
    });

    it('берёт PUBLIC_APP_URL и срезает последний слеш', () => {
      process.env.PUBLIC_APP_URL = 'https://stellar.example.com/';
      expect(publicBaseUrl()).toBe('https://stellar.example.com');
    });

    it('использует PORT если PUBLIC_APP_URL не задан', () => {
      process.env.PORT = '8080';
      expect(publicBaseUrl()).toBe('http://localhost:8080');
    });
  });

  describe('toAbsoluteMediaUrl', () => {
    it('null/empty → null', () => {
      expect(toAbsoluteMediaUrl(null)).toBeNull();
      expect(toAbsoluteMediaUrl('')).toBeNull();
      expect(toAbsoluteMediaUrl('   ')).toBeNull();
    });

    it('http(s) URL отдаёт как есть', () => {
      expect(toAbsoluteMediaUrl('https://cdn.test/x.png')).toBe(
        'https://cdn.test/x.png',
      );
      expect(toAbsoluteMediaUrl('http://localhost:4000/uploads/y.jpg')).toBe(
        'http://localhost:4000/uploads/y.jpg',
      );
    });

    it('относительный путь дополняет до абсолютного', () => {
      expect(toAbsoluteMediaUrl('/uploads/x.png')).toBe(
        'http://localhost:4000/uploads/x.png',
      );
      expect(toAbsoluteMediaUrl('uploads/x.png')).toBe(
        'http://localhost:4000/uploads/x.png',
      );
    });
  });

  describe('mapPublicUser', () => {
    it('конвертирует относительный аватар в абсолютный', () => {
      const result = mapPublicUser({
        id: 1,
        username: 'alice',
        avatar: '/uploads/avatars/x.png',
      });
      expect(result.avatar).toBe('http://localhost:4000/uploads/avatars/x.png');
    });

    it('null avatar остаётся null', () => {
      const result = mapPublicUser({ id: 1, username: 'alice', avatar: null });
      expect(result.avatar).toBeNull();
    });

    it('сохраняет остальные поля', () => {
      const result = mapPublicUser({
        id: 1,
        username: 'alice',
        avatar: null,
      } as { id: number; username: string; avatar: string | null });
      expect(result).toMatchObject({ id: 1, username: 'alice' });
    });
  });
});
