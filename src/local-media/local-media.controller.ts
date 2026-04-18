import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger'
import { LocalMediaService } from './local-media.service'
import { SearchMediaDto } from './dto/search-media.dto'
import { CreateMediaRecordDto } from './dto/create-media-record.dto'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../auth/guards/roles.guard'
import { Roles } from '../auth/decorators/roles.decorator'
import { Role } from '@prisma/client'

@ApiTags('Local Media')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('local-media')
export class LocalMediaController {
  constructor(private readonly svc: LocalMediaService) {}

  // ── Search ────────────────────────────────────────────────────────────────

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: 'Paginated search — filter by cameraNumber, micNumber, date, mediaType …' })
  search(@Query() dto: SearchMediaDto) {
    return this.svc.search(dto)
  }

  // ── Storage stats ─────────────────────────────────────────────────────────

  @Get('stats')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: 'Total file count and size on disk' })
  stats(@Query('centerId') centerId?: string) {
    return this.svc.storageStats(centerId)
  }

  // ── Single record ─────────────────────────────────────────────────────────

  @Get(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: 'Get one media record by ID' })
  findOne(@Param('id') id: string) {
    return this.svc.findOne(id)
  }

  // ── Manual register (e.g. after external write) ───────────────────────────

  @Post()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: 'Register an existing file in the media index' })
  register(@Body() dto: CreateMediaRecordDto) {
    return this.svc.register(dto)
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a file from disk and remove its DB record' })
  remove(@Param('id') id: string) {
    return this.svc.remove(id)
  }
}
