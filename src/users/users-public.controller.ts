import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';

type ReqWithUser = {
  user?: { userId?: number; id?: number };
};

/**
 * Публичные маршруты с полным путём (без второго @Controller('users')),
 * чтобы не конкурировать с @Get(':id') — иначе /users/discover мог попадать в getUser и давать NaN → Prisma.
 */
@Controller()
export class UsersPublicController {
  constructor(private readonly users: UsersService) {}

  @Get('users/discover')
  @UseGuards(OptionalJwtAuthGuard)
  getDiscover(@Req() req: ReqWithUser) {
    const uid = req.user?.userId ?? req.user?.id ?? 0;
    return this.users.getDiscoverFeed(uid);
  }

  @Get('users/search')
  @UseGuards(OptionalJwtAuthGuard)
  searchUsers(@Query('q') query: string) {
    return this.users.searchUsers(query ?? '');
  }

  @Get('users/by-username/:name')
  @UseGuards(OptionalJwtAuthGuard)
  getByUsername(@Param('name') name: string) {
    return this.users.getByUsername(name);
  }
}
