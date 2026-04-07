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
import { CentersService } from './centers.service'
import { CreateCenterDto } from './dto/create-center.dto'
import { UpdateCenterDto } from './dto/update-center.dto'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../auth/guards/roles.guard'
import { Roles } from '../auth/decorators/roles.decorator'
import { CurrentUser } from '../auth/decorators/current-user.decorator'

@ApiTags('Centers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('centers')
export class CentersController {
  constructor(private readonly centersService: CentersService) {}

  @Post()
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create a new center/branch' })
  create(@Body() dto: CreateCenterDto, @CurrentUser() user: any) {
    return this.centersService.create(dto, user)
  }

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: 'List all centers (SUPER_ADMIN) or own center (ADMIN)' })
  findAll(@CurrentUser() user: any) {
    return this.centersService.findAll(user)
  }

  @Get(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: 'Get center details with cameras, tables, hardware' })
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.centersService.findOne(id, user)
  }

  @Patch(':id')
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Update center info' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCenterDto,
    @CurrentUser() user: any,
  ) {
    return this.centersService.update(id, dto, user)
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Deactivate center (soft delete)' })
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.centersService.remove(id, user)
  }
}
