import { Controller, Get, Patch, Query, UseGuards } from '@nestjs/common';
import { CurrentUserId } from '../auth/current-user-id.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private notifications: NotificationsService) {}

  @Get()
  getNotifications(
    @CurrentUserId() userId: number,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.notifications.getNotifications(
      userId,
      Number(page) || 1,
      Number(limit) || 20,
    );
  }

  @Patch('read-all')
  readAll(@CurrentUserId() userId: number) {
    return this.notifications.readAll(userId);
  }
}
