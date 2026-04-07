import { Module } from '@nestjs/common'
import { MicrophonesService } from './microphones.service'
import { MicrophonesController } from './microphones.controller'

@Module({
  controllers: [MicrophonesController],
  providers: [MicrophonesService],
  exports: [MicrophonesService],
})
export class MicrophonesModule {}
