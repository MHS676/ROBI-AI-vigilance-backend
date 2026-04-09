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
import { EspNodesService } from './esp-nodes.service'
import { CreateEspNodeDto } from './dto/create-esp-node.dto'
import { UpdateEspNodeDto } from './dto/update-esp-node.dto'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../auth/guards/roles.guard'
import { Roles } from '../auth/decorators/roles.decorator'
import { CurrentUser } from '../auth/decorators/current-user.decorator'

@ApiTags('ESP Nodes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('esp-nodes')
export class EspNodesController {
  constructor(private readonly espNodesService: EspNodesService) {}

  @Post()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: 'Register a new ESP32/ESP8266 WiFi sensing node' })
  create(@Body() dto: CreateEspNodeDto, @CurrentUser() user: any) {
    return this.espNodesService.create(dto, user)
  }

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: 'List all ESP nodes (scoped by role/center)' })
  findAll(@CurrentUser() user: any) {
    return this.espNodesService.findAll(user)
  }

  @Get(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: 'Get ESP node by ID' })
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.espNodesService.findOne(id, user)
  }

  @Post(':mac/heartbeat')
  @ApiOperation({ summary: 'Device heartbeat — updates lastSeenAt timestamp' })
  heartbeat(@Param('mac') mac: string) {
    return this.espNodesService.heartbeat(mac)
  }

  /** TCP-probe the node IP and update status */
  @Post(':id/ping')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: 'Ping ESP node IP — updates DeviceStatus, returns latency' })
  ping(@Param('id') id: string, @CurrentUser() user: any) {
    return this.espNodesService.ping(id, user)
  }

  @Patch(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: 'Update ESP node config' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateEspNodeDto,
    @CurrentUser() user: any,
  ) {
    return this.espNodesService.update(id, dto, user)
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: 'Deactivate ESP node' })
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.espNodesService.remove(id, user)
  }
}
