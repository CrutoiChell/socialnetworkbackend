import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PostsService } from './posts.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';

type PrismaMock = {
  post: {
    create: jest.Mock;
    findMany: jest.Mock;
    findUnique: jest.Mock;
    delete: jest.Mock;
    count: jest.Mock;
  };
  comment: {
    create: jest.Mock;
    findUnique: jest.Mock;
    delete: jest.Mock;
    findMany: jest.Mock;
    count: jest.Mock;
  };
  like: {
    findUnique: jest.Mock;
    create: jest.Mock;
    delete: jest.Mock;
  };
  $transaction: jest.Mock;
};

describe('PostsService', () => {
  let service: PostsService;
  let prisma: PrismaMock;
  let users: { areFriends: jest.Mock; getFriends: jest.Mock };

  beforeEach(async () => {
    prisma = {
      post: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        delete: jest.fn(),
        count: jest.fn(),
      },
      comment: {
        create: jest.fn(),
        findUnique: jest.fn(),
        delete: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      like: {
        findUnique: jest.fn(),
        create: jest.fn(),
        delete: jest.fn(),
      },
      $transaction: jest.fn().mockImplementation((arr) => Promise.all(arr)),
    };
    users = {
      areFriends: jest.fn(),
      getFriends: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PostsService,
        { provide: PrismaService, useValue: prisma },
        { provide: UsersService, useValue: users },
      ],
    }).compile();

    service = module.get<PostsService>(PostsService);
  });

  describe('createPost', () => {
    it('создаёт пост и возвращает author + counts', async () => {
      prisma.post.create.mockResolvedValue({
        id: 10,
        content: 'hi',
        image: null,
        userId: 1,
        createdAt: new Date(),
        user: { id: 1, username: 'alice', avatar: null },
        _count: { likes: 0, comments: 0 },
      });

      const result = await service.createPost(1, { content: 'hi' });
      expect(result.id).toBe(10);
      expect(result.author).toEqual({ id: 1, username: 'alice', avatar: null });
      expect(result.likesCount).toBe(0);
      expect(result.commentsCount).toBe(0);
    });
  });

  describe('likePost', () => {
    beforeEach(() => {
      // assertViewerCanAccessPost: возвращаем доступный пост
      prisma.post.findUnique.mockResolvedValue({
        userId: 1,
        user: { postsPrivacy: 'ALL' },
      });
    });

    it('добавляет лайк если его не было', async () => {
      prisma.like.findUnique.mockResolvedValue(null);
      prisma.like.create.mockResolvedValue({});

      const result = await service.likePost(5, 1);
      expect(result).toEqual({ liked: true });
      expect(prisma.like.create).toHaveBeenCalledWith({
        data: { userId: 1, postId: 5 },
      });
    });

    it('убирает лайк если он был (toggle)', async () => {
      prisma.like.findUnique.mockResolvedValue({ id: 99 });
      prisma.like.delete.mockResolvedValue({});

      const result = await service.likePost(5, 1);
      expect(result).toEqual({ liked: false });
      expect(prisma.like.delete).toHaveBeenCalledWith({ where: { id: 99 } });
    });
  });

  describe('deletePost', () => {
    it('бросает NotFoundException если пост отсутствует', async () => {
      prisma.post.findUnique.mockResolvedValue(null);
      await expect(service.deletePost(1, 1)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('бросает ForbiddenException если пост чужой', async () => {
      prisma.post.findUnique.mockResolvedValue({ id: 1, userId: 99 });
      await expect(service.deletePost(1, 1)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('удаляет пост владельца', async () => {
      prisma.post.findUnique.mockResolvedValue({ id: 1, userId: 1 });
      prisma.post.delete.mockResolvedValue({});

      const result = await service.deletePost(1, 1);
      expect(result).toEqual({ message: 'Post deleted' });
    });
  });

  describe('deleteComment', () => {
    it('бросает NotFoundException если комментария нет', async () => {
      prisma.comment.findUnique.mockResolvedValue(null);
      await expect(service.deleteComment(1, 1)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('бросает ForbiddenException если комментарий чужой', async () => {
      prisma.comment.findUnique.mockResolvedValue({ id: 1, userId: 99 });
      await expect(service.deleteComment(1, 1)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('удаляет свой комментарий', async () => {
      prisma.comment.findUnique.mockResolvedValue({ id: 1, userId: 1 });
      prisma.comment.delete.mockResolvedValue({});

      const result = await service.deleteComment(1, 1);
      expect(result).toEqual({ message: 'Comment deleted' });
    });
  });

  describe('access control by privacy', () => {
    it('бросает NotFoundException если поста нет', async () => {
      prisma.post.findUnique.mockResolvedValue(null);
      await expect(service.likePost(1, 1)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('запрещает доступ к ONLY_ME постам чужому', async () => {
      prisma.post.findUnique.mockResolvedValue({
        userId: 99,
        user: { postsPrivacy: 'ONLY_ME' },
      });
      await expect(service.likePost(1, 1)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('запрещает FRIENDS пост не-другу', async () => {
      prisma.post.findUnique.mockResolvedValue({
        userId: 99,
        user: { postsPrivacy: 'FRIENDS' },
      });
      users.areFriends.mockResolvedValue(false);

      await expect(service.likePost(1, 1)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('разрешает FRIENDS пост другу', async () => {
      prisma.post.findUnique.mockResolvedValue({
        userId: 99,
        user: { postsPrivacy: 'FRIENDS' },
      });
      users.areFriends.mockResolvedValue(true);
      prisma.like.findUnique.mockResolvedValue(null);
      prisma.like.create.mockResolvedValue({});

      const result = await service.likePost(1, 1);
      expect(result).toEqual({ liked: true });
    });

    it('разрешает доступ к своему ONLY_ME посту', async () => {
      prisma.post.findUnique.mockResolvedValue({
        userId: 1,
        user: { postsPrivacy: 'ONLY_ME' },
      });
      prisma.like.findUnique.mockResolvedValue(null);
      prisma.like.create.mockResolvedValue({});

      const result = await service.likePost(1, 1);
      expect(result).toEqual({ liked: true });
    });
  });
});
