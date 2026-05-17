# ─── Build stage ─────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

# Сначала только манифесты для оптимального кеша
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

# Генерируем Prisma Client
RUN npx prisma generate

# Копируем код и собираем
COPY . .
RUN npm run build

# ─── Runtime stage ───────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

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
