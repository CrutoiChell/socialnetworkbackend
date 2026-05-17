import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';

type PrismaMock = {
  user: { findUnique: jest.Mock; findMany: jest.Mock; update: jest.Mock };
  subscription: {
    findUnique: jest.Mock;
    create: jest.Mock;
    delete: jest.Mock;
    findMany: jest.Mock;
  };
  friendship: {
    findUnique: jest.Mock;
    create: jest.Mock;
    deleteMany: jest.Mock;
    findMany: jest.Mock;
  };
  post: { findMany: jest.Mock; count: jest.Mock };
};

describe('UsersService', () => {
  let service: UsersService;
  let prisma: PrismaMock;

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      subscription: {
        findUnique: jest.fn(),
        create: jest.fn(),
        delete: jest.fn(),
        findMany: jest.fn(),
      },
      friendship: {
        findUnique: jest.fn(),
        create: jest.fn(),
        deleteMany: jest.fn(),
        findMany: jest.fn(),
      },
      post: { findMany: jest.fn(), count: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [UsersService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  describe('getUser', () => {
    it('бросает BadRequestException при невалидном id', async () => {
      await expect(service.getUser(0)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(service.getUser(-1)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(service.getUser(NaN)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('бросает NotFoundException если пользователь не найден', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.getUser(999)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('возвращает пользователя с абсолютным URL аватара', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 1,
        username: 'alice',
        email: 'a@b.com',
        avatar: '/uploads/avatars/x.png',
        createdAt: new Date(),
        _count: { posts: 0, followers: 0, following: 0 },
      });

      const result = await service.getUser(1);
      expect(result.avatar).toMatch(
        /^https?:\/\/.+\/uploads\/avatars\/x\.png$/,
      );
    });
  });

  describe('subscribe', () => {
    it('запрещает подписку на себя', async () => {
      await expect(service.subscribe(1, 1)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('бросает NotFoundException если целевой пользователь не существует', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.subscribe(1, 2)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('бросает BadRequestException при повторной подписке', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 2 });
      prisma.subscription.findUnique.mockResolvedValueOnce({ id: 99 });

      await expect(service.subscribe(1, 2)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('создаёт дружбу при взаимной подписке', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 2 });
      // первая проверка существующей подписки = null, вторая для mutual = найдена
      prisma.subscription.findUnique
        .mockResolvedValueOnce(null) // existing
        .mockResolvedValueOnce({ id: 50, followerId: 2, followingId: 1 }); // mutual
      prisma.subscription.create.mockResolvedValue({});
      prisma.friendship.findUnique.mockResolvedValue(null);
      prisma.friendship.create.mockResolvedValue({});

      const result = await service.subscribe(1, 2);
      expect(result.subscribed).toBe(true);
      expect(result.areFriends).toBe(true);
      expect(prisma.friendship.create).toHaveBeenCalledWith({
        data: { user1Id: 1, user2Id: 2 },
      });
    });
  });

  describe('areFriends', () => {
    it('возвращает false для одинаковых id', async () => {
      expect(await service.areFriends(1, 1)).toBe(false);
    });

    it('возвращает false для невалидных id', async () => {
      expect(await service.areFriends(NaN, 2)).toBe(false);
      expect(await service.areFriends(1, Infinity)).toBe(false);
    });

    it('нормализует порядок id перед поиском дружбы (меньший — первым)', async () => {
      prisma.friendship.findUnique.mockResolvedValue({ id: 1 });
      const result = await service.areFriends(5, 2);
      expect(prisma.friendship.findUnique).toHaveBeenCalledWith({
        where: { user1Id_user2Id: { user1Id: 2, user2Id: 5 } },
      });
      expect(result).toBe(true);
    });
  });

  describe('getRelationshipStatus', () => {
    it('возвращает isSelf=true для своего профиля', async () => {
      const r = await service.getRelationshipStatus(7, 7);
      expect(r).toEqual({
        isSelf: true,
        isFollowing: false,
        followedByTarget: false,
        areFriends: false,
        canMessage: false,
      });
    });

    it('canMessage только при взаимной дружбе', async () => {
      prisma.subscription.findUnique
        .mockResolvedValueOnce({ id: 1 }) // current → target
        .mockResolvedValueOnce({ id: 2 }); // target → current
      prisma.friendship.findUnique.mockResolvedValue({ id: 99 });

      const r = await service.getRelationshipStatus(1, 2);
      expect(r.areFriends).toBe(true);
      expect(r.canMessage).toBe(true);
    });

    it('canMessage=false если нет дружбы', async () => {
      prisma.subscription.findUnique
        .mockResolvedValueOnce({ id: 1 })
        .mockResolvedValueOnce(null);
      prisma.friendship.findUnique.mockResolvedValue(null);

      const r = await service.getRelationshipStatus(1, 2);
      expect(r.canMessage).toBe(false);
    });
  });

  describe('searchUsers', () => {
    it('возвращает пустой массив при коротком запросе', async () => {
      expect(await service.searchUsers('')).toEqual([]);
      expect(await service.searchUsers('a')).toEqual([]);
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    });

    it('ищет по username с insensitive contains', async () => {
      prisma.user.findMany.mockResolvedValue([
        { id: 1, username: 'alice', avatar: null },
      ]);
      const result = await service.searchUsers('al');
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { username: { contains: 'al', mode: 'insensitive' } },
        }),
      );
      expect(result).toHaveLength(1);
    });
  });

  describe('getUserPosts privacy', () => {
    it('возвращает пустой список если автор скрыл посты (ONLY_ME) и смотрит чужой', async () => {
      prisma.user.findUnique.mockResolvedValue({ postsPrivacy: 'ONLY_ME' });

      const result = await service.getUserPosts(1, 2, 1, 20);
      expect(result.posts).toEqual([]);
      expect(prisma.post.findMany).not.toHaveBeenCalled();
    });

    it('возвращает посты владельцу даже при ONLY_ME', async () => {
      prisma.user.findUnique.mockResolvedValue({ postsPrivacy: 'ONLY_ME' });
      prisma.post.findMany.mockResolvedValue([]);
      prisma.post.count.mockResolvedValue(0);

      await service.getUserPosts(2, 2, 1, 20);
      expect(prisma.post.findMany).toHaveBeenCalled();
    });

    it('FRIENDS: чужому без дружбы возвращает пустой список', async () => {
      prisma.user.findUnique.mockResolvedValue({ postsPrivacy: 'FRIENDS' });
      prisma.friendship.findUnique.mockResolvedValue(null);

      const result = await service.getUserPosts(1, 2, 1, 20);
      expect(result.posts).toEqual([]);
    });

    it('FRIENDS: другу возвращает посты', async () => {
      prisma.user.findUnique.mockResolvedValue({ postsPrivacy: 'FRIENDS' });
      prisma.friendship.findUnique.mockResolvedValue({ id: 1 });
      prisma.post.findMany.mockResolvedValue([]);
      prisma.post.count.mockResolvedValue(0);

      await service.getUserPosts(1, 2, 1, 20);
      expect(prisma.post.findMany).toHaveBeenCalled();
    });
  });
});
