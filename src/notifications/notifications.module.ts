import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { MentionsService } from './mentions.service';

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, MentionsService],
  exports: [NotificationsService, MentionsService],
})
export class NotificationsModule {}
