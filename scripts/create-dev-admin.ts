import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const email = process.env.ADMIN_EMAIL ?? 'admin@local.dev';
const username = process.env.ADMIN_USERNAME ?? 'admin';
const passwordPlain = process.env.ADMIN_PASSWORD ?? 'Admin123!';

async function main() {
  const password = await bcrypt.hash(passwordPlain, 10);

  const byEmail = await prisma.user.findUnique({ where: { email } });

  if (byEmail) {
    await prisma.user.update({
      where: { id: byEmail.id },
      data: { role: 'ADMIN', password, isBlocked: false },
    });
    console.log(
      `Updated existing user to ADMIN: ${email} (username: ${byEmail.username})`,
    );
  } else {
    const taken = await prisma.user.findUnique({ where: { username } });
    if (taken) {
      console.error(
        `Username "${username}" is already used by ${taken.email}. Set ADMIN_USERNAME.`,
      );
      process.exit(1);
    }
    await prisma.user.create({
      data: {
        email,
        username,
        password,
        role: 'ADMIN',
      },
    });
    console.log(`Created ADMIN user (minimal profile): ${email}, username: ${username}`);
  }

  console.log(`Password: ${passwordPlain}`);
  console.log('JWT will include role ADMIN after login.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
