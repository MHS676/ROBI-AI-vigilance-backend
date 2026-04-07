import { Module } from '@nestjs/common'
import { EspNodesService } from './esp-nodes.service'
import { EspNodesController } from './esp-nodes.controller'

@Module({
  controllers: [EspNodesController],
  providers: [EspNodesService],
  exports: [EspNodesService],
})
export class EspNodesModule {}
