// Скрипт для очистки БД
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  console.log('🗑️  Очистка базы данных...')
  
  // Удаляем в правильном порядке (из-за foreign keys)
  await prisma.xpLog.deleteMany()
  await prisma.notification.deleteMany()
  await prisma.bookmark.deleteMany()
  await prisma.friendship.deleteMany()
  await prisma.subscription.deleteMany()
  await prisma.like.deleteMany()
  await prisma.comment.deleteMany()
  await prisma.pollVote.deleteMany()
  await prisma.poll.deleteMany()
  await prisma.postMedia.deleteMany()
  await prisma.post.deleteMany()
  await prisma.globalMessage.deleteMany()
  await prisma.message.deleteMany()
  await prisma.user.deleteMany()
  
  console.log('✅ База данных очищена!')
}

main()
  .catch((e) => {
    console.error('❌ Ошибка:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
