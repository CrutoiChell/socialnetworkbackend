import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

/**
 * E2E auth flow. Запускается с реальной БД (см. DATABASE_URL в .env.test или текущий .env).
 * Перед запуском: убедитесь что БД доступна и схема применена.
 */
describe('Auth (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const testEmail = `e2e-auth-${Date.now()}@stellar.test`;
  const testUsername = `e2e_auth_${Date.now()}`;
  const testPassword = 'secret123';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();

    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    // чистим за собой
    await prisma.user.deleteMany({
      where: { OR: [{ email: testEmail }, { username: testUsername }] },
    });
    await app.close();
  });

  describe('POST /auth/register', () => {
    it('400 при невалидных данных', () => {
      return request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'not-an-email', username: 'x', password: '123' })
        .expect(400);
    });

    it('201 и возвращает токен + пользователя', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: testEmail,
          username: testUsername,
          password: testPassword,
        })
        .expect(201);

      expect(response.body.token).toEqual(expect.any(String));
      expect(response.body.user).toEqual(
        expect.objectContaining({
          email: testEmail,
          username: testUsername,
        }),
      );
      expect(response.body.user.password).toBeUndefined();
    });

    it('409 при повторной регистрации того же email', () => {
      return request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: testEmail,
          username: `${testUsername}-2`,
          password: testPassword,
        })
        .expect(409);
    });
  });

  describe('POST /auth/login', () => {
    it('200 с валидными данными', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: testEmail, password: testPassword })
        .expect(201);

      expect(response.body.token).toEqual(expect.any(String));
      expect(response.body.user.email).toBe(testEmail);
    });

    it('401 при неверном пароле', () => {
      return request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: testEmail, password: 'wrong-pass' })
        .expect(401);
    });

    it('401 для несуществующего email', () => {
      return request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'nobody@nowhere.test', password: 'whatever' })
        .expect(401);
    });
  });

  describe('GET /users/me', () => {
    let token: string;

    beforeAll(async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: testEmail, password: testPassword });
      token = response.body.token;
    });

    it('401 без токена', () => {
      return request(app.getHttpServer()).get('/users/me').expect(401);
    });

    it('401 с битым токеном', () => {
      return request(app.getHttpServer())
        .get('/users/me')
        .set('Authorization', 'Bearer not.a.real.token')
        .expect(401);
    });

    it('200 с валидным токеном', async () => {
      const response = await request(app.getHttpServer())
        .get('/users/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.email).toBe(testEmail);
      expect(response.body.username).toBe(testUsername);
    });
  });
});
