import { Module } from '@nestjs/common'
import { CentersService } from './centers.service'
import { CentersController } from './centers.controller'
import { StreamingModule } from '../streaming/streaming.module'

@Module({
  imports: [StreamingModule],
  controllers: [CentersController],
  providers: [CentersService],
  exports: [CentersService],
})
export class CentersModule {}
