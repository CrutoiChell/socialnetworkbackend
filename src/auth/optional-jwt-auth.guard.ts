import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Observable } from 'rxjs';

/**
 * Без Bearer — пропускаем, user не выставляется. С Bearer — JWT; при ошибке/нет user
 * не кидаем Unauthorized, а считаем запрос гостевым (для публичных маршрутов).
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  override canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<{ headers?: { authorization?: string } }>();
    const auth = request.headers?.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      return true;
    }
    return super.canActivate(context) as Promise<boolean>;
  }

  override handleRequest<TUser>(err: Error | null, user: TUser): TUser {
    if (err || !user) {
      return undefined as TUser;
    }
    return user;
  }
}
