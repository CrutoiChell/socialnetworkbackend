# ─── Build stage ─────────────────────────────────────────
FROM node:20-slim AS builder
WORKDIR /app

# OpenSSL нужен Prisma для подключения к Postgres
RUN apt-get update -y && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

# Сначала только манифесты для оптимального кеша
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

# Генерируем Prisma Client под целевую платформу
RUN npx prisma generate

# Копируем код и собираем
COPY . .
RUN npm run build

# ─── Runtime stage ───────────────────────────────────────
FROM node:20-slim AS runner
WORKDIR /app

ENV NODE_ENV=production

# OpenSSL для Prisma в рантайме
RUN apt-get update -y && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

# Только prod-зависимости
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev && npx prisma generate

# Скомпилированный билд
COPY --from=builder /app/dist ./dist

# Папка для пользовательских загрузок
RUN mkdir -p uploads/avatars

EXPOSE 4000

# Перед стартом применяем миграции и поднимаем сервер
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
