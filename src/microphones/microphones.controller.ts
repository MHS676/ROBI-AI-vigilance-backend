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
import { MicrophonesService } from './microphones.service'
import { CreateMicrophoneDto } from './dto/create-microphone.dto'
import { UpdateMicrophoneDto } from './dto/update-microphone.dto'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../auth/guards/roles.guard'
import { Roles } from '../auth/decorators/roles.decorator'
import { CurrentUser } from '../auth/decorators/current-user.decorator'

@ApiTags('Microphones')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('microphones')
export class MicrophonesController {
  constructor(private readonly microphonesService: MicrophonesService) {}

  @Post()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: 'Register a new microphone (LEFT or RIGHT channel)' })
  create(@Body() dto: CreateMicrophoneDto, @CurrentUser() user: any) {
    return this.microphonesService.create(dto, user)
  }

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: 'List microphones (scoped by role/center)' })
  findAll(@CurrentUser() user: any) {
    return this.microphonesService.findAll(user)
  }

  @Get(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: 'Get microphone by ID' })
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.microphonesService.findOne(id, user)
  }

  @Patch(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: 'Update microphone config' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateMicrophoneDto,
    @CurrentUser() user: any,
  ) {
    return this.microphonesService.update(id, dto, user)
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: 'Deactivate microphone' })
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.microphonesService.remove(id, user)
  }
}
