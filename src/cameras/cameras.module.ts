import { Module } from '@nestjs/common'
import { CamerasService } from './cameras.service'
import { CamerasController } from './cameras.controller'

@Module({
  controllers: [CamerasController],
  providers: [CamerasService],
  exports: [CamerasService],
})
export class CamerasModule {}
