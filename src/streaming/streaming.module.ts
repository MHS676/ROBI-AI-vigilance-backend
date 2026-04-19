import { Module } from '@nestjs/common'
import { StreamingService } from './streaming.service'
import { StreamingController } from './streaming.controller'
import { PrismaModule } from '../prisma/prisma.module'
import { ConfigModule } from '@nestjs/config'

@Module({
  imports: [PrismaModule, ConfigModule],
  providers: [StreamingService],
  controllers: [StreamingController],
  exports: [StreamingService],
})
export class StreamingModule {}
