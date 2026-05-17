import { Module } from '@nestjs/common';
import { FriendsController } from './friends.controller';
import { UsersController } from './users.controller';
import { UsersPublicController } from './users-public.controller';
import { UsersService } from './users.service';
import { RolesGuard } from '../auth/roles.guard';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [UsersPublicController, UsersController, FriendsController],
  providers: [UsersService, RolesGuard],
  exports: [UsersService],
})
export class UsersModule {}
