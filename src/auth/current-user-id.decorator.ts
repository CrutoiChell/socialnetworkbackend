import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';

/**
 * ID текущего пользователя из JWT (Passport кладёт результат validate в req.user).
 * Поддерживает userId | id | sub — на случай разных версий клиента/токена.
 */
export const CurrentUserId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): number => {
    const req = ctx.switchToHttp().getRequest();
    const u = req.user as
      | { userId?: number; id?: number; sub?: number | string }
      | undefined;
    if (!u) throw new UnauthorizedException();
    const raw = u.userId ?? u.id ?? u.sub;
    const id = typeof raw === 'string' ? Number(raw) : raw;
    if (id == null || !Number.isFinite(id)) {
      throw new UnauthorizedException();
    }
    return id;
  },
);
