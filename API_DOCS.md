# Social Network API Documentation

## Обзор

API социальной сети с поддержкой:
- Регистрация и авторизация
- Посты с лайками и комментариями
- Система подписок и друзей
- Личные чаты (только для друзей)
- Глобальный чат

## Аутентификация

Все защищенные эндпоинты требуют JWT токен в заголовке:
```
Authorization: Bearer <token>
```

### POST /auth/register
Регистрация нового пользователя
```json
{
  "email": "user@example.com",
  "username": "username",
  "password": "password123"
}
```

### POST /auth/login
Вход в систему
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

## Пользователи

### GET /users/me
Получить информацию о текущем пользователе

### GET /users/:id
Получить информацию о пользователе по ID

### GET /users/search?q=username
Поиск пользователей по имени

### POST /users/:id/subscribe
Подписаться на пользователя
- Если пользователь подписывается взаимно, создается дружба
- После дружбы открывается возможность личных сообщений

### DELETE /users/:id/unsubscribe
Отписаться от пользователя

### GET /users/me/friends
Получить список друзей

### GET /users/me/followers
Получить список подписчиков

### GET /users/me/following
Получить список подписок

## Посты

### POST /posts
Создать пост
```json
{
  "content": "Текст поста",
  "image": "url_изображения" // опционально
}
```

### GET /posts
Получить ленту постов
Query параметры:
- `page` - номер страницы (по умолчанию 1)
- `limit` - количество постов (по умолчанию 20)

### GET /posts/:id
Получить пост по ID с комментариями

### DELETE /posts/:id
Удалить свой пост

### POST /posts/:id/like
Лайкнуть/убрать лайк с поста

### POST /posts/:id/comments
Добавить комментарий к посту
```json
{
  "text": "Текст комментария"
}
```

### DELETE /posts/comments/:id
Удалить свой комментарий

## Сообщения (REST API)

### GET /messages/global?limit=50
Получить сообщения глобального чата

### GET /messages/conversations
Получить список всех диалогов

### GET /messages/conversation/:userId?limit=50
Получить историю сообщений с пользователем

## WebSocket (Чат)

Подключение к WebSocket:
```javascript
const socket = io('http://localhost:4000', {
  auth: { token: 'your_jwt_token' }
});
```

### События от клиента:

#### sendMessage
Отправить личное сообщение (только друзьям)
```javascript
socket.emit('sendMessage', {
  receiverId: 123,
  text: 'Привет!'
});
```

#### sendGlobalMessage
Отправить сообщение в глобальный чат
```javascript
socket.emit('sendGlobalMessage', {
  text: 'Всем привет!'
});
```

#### getOnlineUsers
Получить список онлайн пользователей
```javascript
socket.emit('getOnlineUsers');
```

### События от сервера:

#### newMessage
Новое личное сообщение
```javascript
socket.on('newMessage', (message) => {
  console.log('Новое сообщение:', message);
});
```

#### messageSent
Подтверждение отправки сообщения
```javascript
socket.on('messageSent', (message) => {
  console.log('Сообщение отправлено:', message);
});
```

#### newGlobalMessage
Новое сообщение в глобальном чате
```javascript
socket.on('newGlobalMessage', (message) => {
  console.log('Глобальное сообщение:', message);
});
```

#### userOnline / userOffline
Пользователь подключился/отключился
```javascript
socket.on('userOnline', ({ userId }) => {
  console.log('Пользователь онлайн:', userId);
});

socket.on('userOffline', ({ userId }) => {
  console.log('Пользователь оффлайн:', userId);
});
```

#### onlineUsers
Список онлайн пользователей
```javascript
socket.on('onlineUsers', (userIds) => {
  console.log('Онлайн:', userIds);
});
```

#### error
Ошибка
```javascript
socket.on('error', ({ message }) => {
  console.error('Ошибка:', message);
});
```

## Логика работы системы друзей

1. Пользователь A подписывается на пользователя B → создается подписка
2. Пользователь B подписывается на пользователя A → создается дружба автоматически
3. Теперь A и B могут отправлять друг другу личные сообщения
4. При отписке дружба удаляется, личные сообщения становятся недоступны

## Запуск

```bash
# Установка зависимостей
npm install

# Применение миграций
npx prisma db push

# Генерация Prisma Client
npx prisma generate

# Запуск в dev режиме
npm run start:dev

# Сборка
npm run build

# Запуск production
npm run start:prod
```

## Переменные окружения (.env)

```
DATABASE_URL="your_postgres_connection_string"
JWT_SECRET="your_secret_key"
PORT=4000
```
