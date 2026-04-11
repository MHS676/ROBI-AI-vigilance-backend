// ─────────────────────────────────────────────────────────────────────────────
// ProvisioningController
//
// All routes are guarded by JwtAuthGuard + @Roles(SUPER_ADMIN).
// Only the Super Admin can approve/reject devices and trigger ONVIF scans.
//
// Endpoints:
//   GET  /provisioning/stats                    → inventory statistics
//   GET  /provisioning/devices                  → all devices (filterable)
//   GET  /provisioning/devices/pending          → PENDING devices only
//   GET  /provisioning/devices/:id              → single device
//   POST /provisioning/devices/:id/assign       → approve + send MQTT config
//   POST /provisioning/devices/:id/reject       → reject device
//   POST /provisioning/devices/:id/reprovision  → re-send config to assigned device
//   POST /provisioning/cameras/scan             → ONVIF camera scan
//   POST /provisioning/cameras/add              → add scanned camera to a center
// ─────────────────────────────────────────────────────────────────────────────

import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common'
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger'
import { Role } from '@prisma/client'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../auth/guards/roles.guard'
import { Roles } from '../auth/decorators/roles.decorator'
import { ProvisioningService } from './provisioning.service'
import { AssignDeviceDto } from './dto/assign-device.dto'
import { RejectDeviceDto } from './dto/reject-device.dto'
import { ScanCamerasDto } from './dto/scan-cameras.dto'
import { DeviceInventoryQueryDto } from './dto/device-inventory-query.dto'

@ApiTags('Provisioning')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
@Controller('provisioning')
export class ProvisioningController {
  constructor(private readonly provisioningService: ProvisioningService) {}

  // ── Statistics ─────────────────────────────────────────────────────────────

  @Get('stats')
  @ApiOperation({ summary: 'Device inventory statistics (counts by status)' })
  @ApiResponse({ status: 200, description: '{ total, pending, assigned, rejected, offline }' })
  getStats() {
    return this.provisioningService.getStats()
  }

  // ── Inventory Queries ──────────────────────────────────────────────────────

  @Get('devices')
  @ApiOperation({ summary: 'List all devices in inventory — filterable by status/type/center' })
  findAll(@Query() query: DeviceInventoryQueryDto) {
    return this.provisioningService.findAll(query)
  }

  @Get('devices/pending')
  @ApiOperation({ summary: 'List all PENDING devices awaiting Super Admin approval' })
  findPending() {
    return this.provisioningService.findPending()
  }

  @Get('devices/:id')
  @ApiOperation({ summary: 'Get a single device inventory record by ID' })
  @ApiParam({ name: 'id', description: 'DeviceInventory CUID' })
  findOne(@Param('id') id: string) {
    return this.provisioningService.findOne(id)
  }

  // ── Approval Workflow ──────────────────────────────────────────────────────

  @Post('devices/:id/assign')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Approve a PENDING device and assign it to a Center',
    description:
      'Updates status to ASSIGNED, publishes MQTT provisioning config to the device ' +
      '(centerId, tableId, WiFi credentials, server URLs), and emits a WS event to Super Admin.',
  })
  @ApiParam({ name: 'id', description: 'DeviceInventory CUID' })
  assign(@Param('id') id: string, @Body() dto: AssignDeviceDto) {
    return this.provisioningService.assign(id, dto)
  }

  @Post('devices/:id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reject a PENDING device',
    description: 'Sets status to REJECTED and stores the reason for audit purposes.',
  })
  @ApiParam({ name: 'id', description: 'DeviceInventory CUID' })
  reject(@Param('id') id: string, @Body() dto: RejectDeviceDto) {
    return this.provisioningService.reject(id, dto)
  }

  @Post('devices/:id/reprovision')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Re-send MQTT provisioning config to an already-ASSIGNED device',
    description: 'Useful when WiFi credentials change or device undergoes factory reset.',
  })
  @ApiParam({ name: 'id', description: 'DeviceInventory CUID' })
  reprovision(@Param('id') id: string, @Body() dto: AssignDeviceDto) {
    return this.provisioningService.reprovision(id, dto)
  }

  // ── Camera Discovery ────────────────────────────────────────────────────────

  @Post('cameras/scan')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Scan a branch subnet for Tiandy / Hikvision cameras via ONVIF + TCP',
    description:
      'Sends a WS-Discovery UDP multicast probe (ONVIF) to 239.255.255.250:3702 and ' +
      'runs a parallel TCP port scan (ports 80, 8080, 554) on the given subnet. ' +
      'Returns a list of discovered cameras with IP, manufacturer, and RTSP URL guess.',
  })
  scanCameras(@Body() dto: ScanCamerasDto) {
    return this.provisioningService.scanCameras(dto)
  }

  @Post('cameras/add')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Add an ONVIF-discovered camera to a Center',
    description:
      'Creates a Camera record and a DeviceInventory record (ASSIGNED). ' +
      'The Super Admin selects the camera from the scan results and clicks "Add".',
  })
  addDiscoveredCamera(
    @Body()
    body: {
      centerId:      string
      ipAddress:     string
      manufacturer?: string
      model?:        string
      onvifXAddr?:   string
      rtspUrl?:      string
      name?:         string
    },
  ) {
    return this.provisioningService.addDiscoveredCamera(body.centerId, body)
  }
}
