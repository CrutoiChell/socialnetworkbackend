import { Module } from '@nestjs/common';
import { ChatGateway } from './chat.gateway';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { RolesGuard } from '../auth/roles.guard';

@Module({
  imports: [AuthModule, UsersModule, NotificationsModule],
  controllers: [MessagesController],
  providers: [ChatGateway, MessagesService, RolesGuard],
})
export class ChatModule {}
