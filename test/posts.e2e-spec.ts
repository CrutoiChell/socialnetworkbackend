import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

/**
 * E2E flow для постов: создание, лайки, комментарии, приватность.
 */
describe('Posts (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const stamp = Date.now();
  const aliceEmail = `e2e-posts-alice-${stamp}@stellar.test`;
  const bobEmail = `e2e-posts-bob-${stamp}@stellar.test`;
  let aliceToken: string;
  let bobToken: string;
  let aliceId: number;
  let bobId: number;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();

    prisma = app.get(PrismaService);

    const aliceRes = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: aliceEmail,
        username: `alice_${stamp}`,
        password: 'secret123',
      });
    aliceToken = aliceRes.body.token;
    aliceId = aliceRes.body.user.id;

    const bobRes = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: bobEmail,
        username: `bob_${stamp}`,
        password: 'secret123',
      });
    bobToken = bobRes.body.token;
    bobId = bobRes.body.user.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { id: { in: [aliceId, bobId].filter(Boolean) } },
    });
    await app.close();
  });

  let postId: number;

  describe('POST /posts', () => {
    it('401 без токена', () => {
      return request(app.getHttpServer())
        .post('/posts')
        .send({ content: 'hello' })
        .expect(401);
    });

    it('400 если контент пустой', () => {
      return request(app.getHttpServer())
        .post('/posts')
        .set('Authorization', `Bearer ${aliceToken}`)
        .send({ content: '' })
        .expect(400);
    });

    it('создаёт пост с автором', async () => {
      const res = await request(app.getHttpServer())
        .post('/posts')
        .set('Authorization', `Bearer ${aliceToken}`)
        .send({ content: 'first stellar post' })
        .expect(201);

      expect(res.body.id).toEqual(expect.any(Number));
      expect(res.body.content).toBe('first stellar post');
      expect(res.body.author).toEqual(expect.objectContaining({ id: aliceId }));
      expect(res.body.likesCount).toBe(0);
      expect(res.body.commentsCount).toBe(0);
      postId = res.body.id;
    });
  });

  describe('GET /posts', () => {
    it('возвращает пагинированный список', async () => {
      const res = await request(app.getHttpServer())
        .get('/posts?page=1&limit=20')
        .set('Authorization', `Bearer ${aliceToken}`)
        .expect(200);

      expect(res.body).toEqual(
        expect.objectContaining({
          posts: expect.any(Array),
          totalCount: expect.any(Number),
          hasMore: expect.any(Boolean),
          page: 1,
        }),
      );
    });
  });

  describe('GET /posts/:id', () => {
    it('возвращает пост со списком комментариев', async () => {
      const res = await request(app.getHttpServer())
        .get(`/posts/${postId}`)
        .set('Authorization', `Bearer ${aliceToken}`)
        .expect(200);

      expect(res.body.id).toBe(postId);
      expect(res.body.author.id).toBe(aliceId);
    });

    it('404 для несуществующего поста', () => {
      return request(app.getHttpServer())
        .get('/posts/99999999')
        .set('Authorization', `Bearer ${aliceToken}`)
        .expect(404);
    });
  });

  describe('POST /posts/:id/like (toggle)', () => {
    it('первый клик — liked: true', async () => {
      const res = await request(app.getHttpServer())
        .post(`/posts/${postId}/like`)
        .set('Authorization', `Bearer ${bobToken}`)
        .expect(201);
      expect(res.body).toEqual({ liked: true });
    });

    it('второй клик — liked: false', async () => {
      const res = await request(app.getHttpServer())
        .post(`/posts/${postId}/like`)
        .set('Authorization', `Bearer ${bobToken}`)
        .expect(201);
      expect(res.body).toEqual({ liked: false });
    });
  });

  describe('Comments flow', () => {
    let commentId: number;

    it('добавляет комментарий', async () => {
      const res = await request(app.getHttpServer())
        .post(`/posts/${postId}/comments`)
        .set('Authorization', `Bearer ${bobToken}`)
        .send({ text: 'nice post' })
        .expect(201);

      expect(res.body.text).toBe('nice post');
      expect(res.body.userId).toBe(bobId);
      commentId = res.body.id;
    });

    it('возвращает список комментариев с пагинацией', async () => {
      const res = await request(app.getHttpServer())
        .get(`/posts/${postId}/comments?page=1&limit=20`)
        .set('Authorization', `Bearer ${aliceToken}`)
        .expect(200);

      expect(res.body.comments).toEqual(expect.any(Array));
      expect(res.body.commentsCount).toBeGreaterThan(0);
    });

    it('запрещает удаление чужого комментария', async () => {
      await request(app.getHttpServer())
        .delete(`/posts/comments/${commentId}`)
        .set('Authorization', `Bearer ${aliceToken}`)
        .expect(403);
    });

    it('разрешает удаление собственного комментария', async () => {
      await request(app.getHttpServer())
        .delete(`/posts/comments/${commentId}`)
        .set('Authorization', `Bearer ${bobToken}`)
        .expect(200);
    });
  });

  describe('DELETE /posts/:id', () => {
    it('запрещает удаление чужого поста', async () => {
      await request(app.getHttpServer())
        .delete(`/posts/${postId}`)
        .set('Authorization', `Bearer ${bobToken}`)
        .expect(403);
    });

    it('разрешает владельцу', async () => {
      await request(app.getHttpServer())
        .delete(`/posts/${postId}`)
        .set('Authorization', `Bearer ${aliceToken}`)
        .expect(200);
    });
  });
});
