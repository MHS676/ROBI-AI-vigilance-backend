import { Module } from '@nestjs/common'
import { StreamingService } from './streaming.service'
import { StreamingController } from './streaming.controller'
import { PrismaModule } from '../prisma/prisma.module'

@Module({
  imports: [PrismaModule],
  providers: [StreamingService],
  controllers: [StreamingController],
  exports: [StreamingService],
})
export class StreamingModule {}
