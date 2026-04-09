import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  HttpCode,
  HttpStatus,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { diskStorage } from 'multer'
import { extname, join } from 'path'
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger'
import { Role } from '@prisma/client'
import { CentersService } from './centers.service'
import { CreateCenterDto } from './dto/create-center.dto'
import { UpdateCenterDto } from './dto/update-center.dto'
import { AddCameraDto, AddEspNodeDto, AddMicrophoneDto } from './dto/add-hardware.dto'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../auth/guards/roles.guard'
import { Roles } from '../auth/decorators/roles.decorator'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { RequestUser } from '../auth/interfaces/jwt-payload.interface'

// ── Multer disk storage for center floor-plan maps ─────────────────────────
const mapStorage = diskStorage({
  destination: join(__dirname, '..', '..', 'uploads', 'center-maps'),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`
    cb(null, `${unique}${extname(file.originalname)}`)
  },
})

function mapFileFilter(
  _req: unknown,
  file: Express.Multer.File,
  cb: (error: Error | null, accept: boolean) => void,
) {
  const allowed = ['image/svg+xml', 'image/png', 'image/jpeg', 'image/jpg']
  cb(null, allowed.includes(file.mimetype))
}

@ApiTags('Centers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('centers')
export class CentersController {
  constructor(private readonly centersService: CentersService) {}

  // ── CRUD ──────────────────────────────────────────────────

  @Post()
  @Roles(Role.SUPER_ADMIN)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Create a new center/branch',
    description: 'Creates one of the 105 physical Falcon Security branches. **SUPER_ADMIN only.**',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        name:    { type: 'string' },
        code:    { type: 'string', example: 'FAL-ABJ-002' },
        address: { type: 'string' },
        city:    { type: 'string' },
        state:   { type: 'string' },
        country: { type: 'string' },
        phone:   { type: 'string' },
        mapFile: { type: 'string', format: 'binary' },
      },
      required: ['name', 'code'],
    },
  })
  @ApiResponse({ status: 201, description: 'Center created' })
  @ApiResponse({ status: 409, description: 'Center code already exists' })
  @UseInterceptors(FileInterceptor('mapFile', { storage: mapStorage, fileFilter: mapFileFilter, limits: { fileSize: 5 * 1024 * 1024 } }))
  create(
    @Body() dto: CreateCenterDto,
    @UploadedFile() mapFile: Express.Multer.File | undefined,
    @CurrentUser() user: RequestUser,
  ) {
    const mapUrl = mapFile ? `/uploads/center-maps/${mapFile.filename}` : undefined
    return this.centersService.create(dto, user, mapUrl)
  }

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({
    summary: 'List centers',
    description: 'SUPER_ADMIN sees all 105 centers. ADMIN sees only their own center.',
  })
  findAll(@CurrentUser() user: RequestUser) {
    return this.centersService.findAll(user)
  }

  @Get(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: 'Get center details — includes all cameras, tables, and hardware' })
  @ApiParam({ name: 'id', description: 'Center CUID' })
  findOne(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.centersService.findOne(id, user)
  }

  @Patch(':id')
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Update center info' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCenterDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.centersService.update(id, dto, user)
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Deactivate center (soft delete)' })
  remove(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.centersService.remove(id, user)
  }

  // ── HARDWARE SUB-RESOURCES ────────────────────────────────
  // centerId is taken from the URL — no need to repeat it in body.
  // All hardware-add operations are SUPER_ADMIN only.

  @Get(':centerId/hardware')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({
    summary: 'Hardware inventory for a center',
    description:
      'Returns all cameras, ESP nodes, and microphones registered to this center.\n\n' +
      'Each camera and microphone shows whether it is currently **assigned** to a table or **available** for mapping.',
  })
  @ApiParam({ name: 'centerId', description: 'Center CUID' })
  @ApiResponse({ status: 200, description: 'Hardware inventory with assignment status' })
  getHardware(@Param('centerId') centerId: string, @CurrentUser() user: RequestUser) {
    return this.centersService.getHardwareInventory(centerId, user)
  }

  @Post(':centerId/cameras')
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Add a camera to this center',
    description:
      'Registers a new RTSP camera and assigns it to the center.\n\n' +
      'centerId is taken from the URL — do **not** include it in the request body.',
  })
  @ApiParam({ name: 'centerId', description: 'Center CUID' })
  @ApiResponse({ status: 201, description: 'Camera registered and linked to center' })
  addCamera(
    @Param('centerId') centerId: string,
    @Body() dto: AddCameraDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.centersService.addCamera(centerId, dto, user)
  }

  @Post(':centerId/esp-nodes')
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Add an ESP32/ESP8266 WiFi sensing node to this center',
    description:
      'Registers a new ESP node by its unique MAC address.\n\n' +
      'centerId is taken from the URL — do **not** include it in the request body.',
  })
  @ApiParam({ name: 'centerId', description: 'Center CUID' })
  @ApiResponse({ status: 201, description: 'ESP node registered' })
  @ApiResponse({ status: 409, description: 'MAC address already registered' })
  addEspNode(
    @Param('centerId') centerId: string,
    @Body() dto: AddEspNodeDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.centersService.addEspNode(centerId, dto, user)
  }

  @Post(':centerId/microphones')
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Add a microphone (LEFT or RIGHT channel) to this center',
    description:
      'Registers a new microphone and links it to the center.\n\n' +
      'centerId is taken from the URL — do **not** include it in the request body.',
  })
  @ApiParam({ name: 'centerId', description: 'Center CUID' })
  @ApiResponse({ status: 201, description: 'Microphone registered' })
  addMicrophone(
    @Param('centerId') centerId: string,
    @Body() dto: AddMicrophoneDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.centersService.addMicrophone(centerId, dto, user)
  }
}
