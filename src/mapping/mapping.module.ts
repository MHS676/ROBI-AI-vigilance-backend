import { Module } from '@nestjs/common'
import { MappingService } from './mapping.service'
import { MappingController } from './mapping.controller'
import { PrismaModule } from '../prisma/prisma.module'

@Module({
  imports: [PrismaModule],
  controllers: [MappingController],
  providers: [MappingService],
  exports: [MappingService],
})
export class MappingModule {}
