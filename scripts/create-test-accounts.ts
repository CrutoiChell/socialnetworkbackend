import 'dotenv/config';
import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const ACCOUNTS: { email: string; username: string; password: string; role: UserRole }[] = [
  { email: 'user@local.dev', username: 'demo_user', password: 'User1234!', role: 'USER' },
  { email: 'moderator@local.dev', username: 'demo_moderator', password: 'Moder1234!', role: 'MODERATOR' },
  { email: 'admin@local.dev', username: 'demo_admin', password: 'Admin1234!', role: 'ADMIN' },
];

async function upsertAccount(account: (typeof ACCOUNTS)[number]) {
  const password = await bcrypt.hash(account.password, 10);
  const byEmail = await prisma.user.findUnique({ where: { email: account.email } });

  if (byEmail) {
    await prisma.user.update({
      where: { id: byEmail.id },
      data: { role: account.role, password, isBlocked: false },
    });
    console.log(`Updated existing user -> ${account.role}: ${account.email} (username: ${byEmail.username})`);
    return;
  }

  const taken = await prisma.user.findUnique({ where: { username: account.username } });
  if (taken) {
    console.error(`Username "${account.username}" is already used by ${taken.email}, skipping.`);
    return;
  }

  await prisma.user.create({
    data: {
      email: account.email,
      username: account.username,
      password,
      role: account.role,
      postsPrivacy: 'ALL',
    },
  });
  console.log(`Created ${account.role} user: ${account.email} (username: ${account.username})`);
}

async function main() {
  for (const account of ACCOUNTS) {
    await upsertAccount(account);
  }

  console.log('\nTest accounts ready:');
  for (const account of ACCOUNTS) {
    console.log(`  ${account.role.padEnd(9)} -> email: ${account.email.padEnd(20)} password: ${account.password}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
