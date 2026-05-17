import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';
import { RolesGuard } from '../auth/roles.guard';

@Module({
  imports: [UsersModule, NotificationsModule],
  controllers: [PostsController],
  providers: [PostsService, RolesGuard],
})
export class PostsModule {}
