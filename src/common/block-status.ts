import { PrismaService } from '../prisma/prisma.service';

type BlockableUser = {
  id: number;
  isBlocked: boolean;
  blockedUntil?: Date | null;
};

/**
 * Возвращает true, если пользователь сейчас заблокирован.
 * Если временная блокировка истекла — снимает её в БД и возвращает false.
 */
export async function isUserCurrentlyBlocked(
  prisma: PrismaService,
  user: BlockableUser,
): Promise<boolean> {
  if (!user.isBlocked) return false;
  if (user.blockedUntil && user.blockedUntil.getTime() <= Date.now()) {
    await prisma.user.update({
      where: { id: user.id },
      data: { isBlocked: false, blockedUntil: null },
    });
    return false;
  }
  return true;
}
