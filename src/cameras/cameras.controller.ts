import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common'
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger'
import { Role } from '@prisma/client'
import { CamerasService } from './cameras.service'
import { CreateCameraDto } from './dto/create-camera.dto'
import { UpdateCameraDto } from './dto/update-camera.dto'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../auth/guards/roles.guard'
import { Roles } from '../auth/decorators/roles.decorator'
import { CurrentUser } from '../auth/decorators/current-user.decorator'

@ApiTags('Cameras')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('cameras')
export class CamerasController {
  constructor(private readonly camerasService: CamerasService) {}

  @Post()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: 'Register a new camera with RTSP URL' })
  create(@Body() dto: CreateCameraDto, @CurrentUser() user: any) {
    return this.camerasService.create(dto, user)
  }

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: 'List cameras (scoped by role/center)' })
  findAll(@CurrentUser() user: any) {
    return this.camerasService.findAll(user)
  }

  @Get(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: 'Get camera by ID' })
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.camerasService.findOne(id, user)
  }

  /** Ping the camera IP, update DeviceStatus, return {status, latencyMs} */
  @Post(':id/ping')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: 'Ping camera IP — updates DeviceStatus in DB, returns latency' })
  ping(@Param('id') id: string, @CurrentUser() user: any) {
    return this.camerasService.ping(id, user)
  }

  @Patch(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: 'Update camera info or RTSP URL' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCameraDto,
    @CurrentUser() user: any,
  ) {
    return this.camerasService.update(id, dto, user)
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: 'Deactivate camera' })
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.camerasService.remove(id, user)
  }
}
