import { Module } from '@nestjs/common'
import { CamerasService } from './cameras.service'
import { CamerasController } from './cameras.controller'
import { CameraPollerService } from './camera-poller.service'
import { EventsModule } from '../events/events.module'
import { StreamingModule } from '../streaming/streaming.module'

@Module({
  imports: [EventsModule, StreamingModule],
  controllers: [CamerasController],
  providers: [CamerasService, CameraPollerService],
  exports: [CamerasService],
})
export class CamerasModule {}
