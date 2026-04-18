import { Module } from '@nestjs/common'
import { LocalMediaService } from './local-media.service'
import { LocalMediaController } from './local-media.controller'
import { PrismaModule } from '../prisma/prisma.module'

@Module({
  imports: [PrismaModule],
  providers: [LocalMediaService],
  controllers: [LocalMediaController],
  exports: [LocalMediaService],
})
export class LocalMediaModule {}
