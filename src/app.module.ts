import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { ChatModule } from './chat/chat.module';
import { PostsModule } from './posts/posts.module';
import { UsersModule } from './users/users.module';
import { PresenceModule } from './presence/presence.module';
import { StatsModule } from './stats/stats.module';
import { BookmarksModule } from './bookmarks/bookmarks.module';
import { NotificationsModule } from './notifications/notifications.module';
import { XpModule } from './xp/xp.module';
import { PaymentsModule } from './payments/payments.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'uploads'),
      serveRoot: '/uploads/',
    }),
    PrismaModule,
    XpModule,
    PresenceModule,
    AuthModule,
    ChatModule,
    PostsModule,
    UsersModule,
    BookmarksModule,
    NotificationsModule,
    StatsModule,
    PaymentsModule,
  ],
})
export class AppModule {}
