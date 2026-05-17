# socialnetworkbackend — Стелар API

Бэкенд космической социальной сети **Стелар** на NestJS + Prisma + PostgreSQL.

Стек:
- **NestJS 11** + TypeScript
- **Prisma 6** + PostgreSQL
- **Socket.io** для чата в реальном времени
- **Passport** + JWT, OAuth (Google, GitHub, Yandex)
- **ЮKassa** для платежей
- **Multer** для загрузки медиа

## Быстрый старт (локально)

```bash
git clone https://github.com/CrutoiChell/socialnetworkbackend.git
cd socialnetworkbackend

# 1. Установить зависимости
npm install

# 2. Скопировать шаблон env и заполнить значения
cp .env.example .env
# Отредактируй .env: DATABASE_URL, JWT_SECRET, OAuth и ЮKassa ключи

# 3. Применить миграции и сгенерировать Prisma Client
npx prisma migrate deploy
npx prisma generate

# 4. Запустить в dev-режиме
npm run start:dev
```

API поднимется на `http://localhost:4000`.

## Запуск через Docker

```bash
cp .env.example .env
docker compose up -d --build
```

Поднимется PostgreSQL + API в одной сети. Миграции применяются автоматически при старте.

## Production-деплой

### Подготовка

1. Создай PostgreSQL базу на хостинге (Neon, Supabase, Railway, Render, любой VPS).
2. Получи production-ключи OAuth-провайдеров с production-callback URL вида:
   - `https://your-backend.example.com/auth/google/callback`
   - `https://your-backend.example.com/auth/github/callback`
   - `https://your-backend.example.com/auth/yandex/callback`
3. Создай магазин в [ЮKassa](https://yookassa.ru/my) и получи `shopId` + `secretKey`.

### Переменные окружения

Все переменные перечислены в `.env.example`. Самое важное:

| Переменная           | Описание                                          |
| -------------------- | ------------------------------------------------- |
| `DATABASE_URL`       | строка подключения к PostgreSQL                   |
| `JWT_SECRET`         | случайная строка ≥ 32 символов                    |
| `FRONTEND_URL`       | URL фронта (для редиректов после OAuth)           |
| `*_CLIENT_ID/SECRET` | OAuth credentials провайдеров                     |
| `UKASSA_*`           | ключи ЮKassa и URL возврата на `/premium`         |

### Деплой на Railway / Render / Fly.io

1. Подключи репозиторий к платформе.
2. Используй `Dockerfile` из репо (или native NestJS-билд).
3. Задай переменные окружения из `.env.example`.
4. Hosting автоматически выполнит `prisma migrate deploy` при старте контейнера.

### CORS

Сервер поднимается с CORS, настроенным под `FRONTEND_URL`. В продакшене обязательно укажи туда конкретный домен фронта.

## Структура проекта

```
src/
├── auth/            # JWT + OAuth (Google/GitHub/Yandex)
├── users/           # Профиль, друзья, подписки
├── posts/           # Посты, лайки, репосты, бусты, опросы
├── chat/            # WebSocket чат + REST endpoints
├── notifications/   # Уведомления, меншены
├── bookmarks/       # Закладки
├── payments/        # ЮKassa
├── stats/           # Статистика
├── presence/        # Online/offline статусы
├── prisma/          # Prisma service
├── xp/              # Геймификация (XP, уровни)
└── common/          # Утилиты, public-url
```

## Скрипты

```bash
npm run start:dev      # dev с hot-reload
npm run build          # компиляция в dist/
npm run start          # production-режим из dist/
npm run lint           # ESLint
npm run test           # unit-тесты
npm run test:e2e       # e2e-тесты
npx prisma studio      # GUI для БД
npx prisma migrate dev # создать миграцию
```

## API endpoints

Полный список эндпоинтов — см. `API_DOCS.md`.

Кратко:
- `/auth/*` — регистрация, логин, OAuth
- `/users/*` — профили, друзья, подписки, аватары
- `/posts/*` — лента, посты, лайки, репосты, опросы, бусты
- `/messages/*` — чат (REST + WebSocket)
- `/notifications/*` — уведомления
- `/bookmarks/*` — закладки
- `/payments/*` — ЮKassa
- `/stats/overview` — общая статистика

## Лицензия

MIT
