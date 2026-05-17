import { Global, Module } from '@nestjs/common';
import { OnlinePresenceService } from './online-presence.service';
import { SocketEventsService } from './socket-events.service';

@Global()
@Module({
  providers: [OnlinePresenceService, SocketEventsService],
  exports: [OnlinePresenceService, SocketEventsService],
})
export class PresenceModule {}
