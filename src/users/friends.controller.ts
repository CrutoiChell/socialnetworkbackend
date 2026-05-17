import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUserId } from '../auth/current-user-id.decorator';
import { UsersService } from './users.service';

/** Список друзей (взаимная подписка) — GET /friends */
@Controller('friends')
@UseGuards(JwtAuthGuard)
export class FriendsController {
  constructor(private users: UsersService) {}

  @Get()
  listFriends(@CurrentUserId() userId: number) {
    return this.users.getFriends(userId);
  }
}
