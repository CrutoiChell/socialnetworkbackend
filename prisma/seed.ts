import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const count = await prisma.user.count();
  if (count > 0) {
    console.log(`Database already has ${count} user(s), skipping seed.`);
    return;
  }

  const password = await bcrypt.hash('Test1234!', 10);
  await prisma.user.create({
    data: {
      email: 'test@local.dev',
      username: 'testuser',
      password,
      postsPrivacy: 'ALL',
    },
  });
  console.log('Seeded test user: test@local.dev / Test1234! (username: testuser)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
