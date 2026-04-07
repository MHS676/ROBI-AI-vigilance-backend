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
import { TablesService } from './tables.service'
import { CreateTableDto } from './dto/create-table.dto'
import { UpdateTableDto } from './dto/update-table.dto'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../auth/guards/roles.guard'
import { Roles } from '../auth/decorators/roles.decorator'
import { CurrentUser } from '../auth/decorators/current-user.decorator'

@ApiTags('Tables')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('tables')
export class TablesController {
  constructor(private readonly tablesService: TablesService) {}

  @Post()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({
    summary: 'Create a table — links ONE Camera + BoundingBox + ONE Microphone + ONE Agent',
  })
  create(@Body() dto: CreateTableDto, @CurrentUser() user: any) {
    return this.tablesService.create(dto, user)
  }

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: 'List all tables with full hardware mapping' })
  findAll(@CurrentUser() user: any) {
    return this.tablesService.findAll(user)
  }

  @Get(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.AGENT)
  @ApiOperation({ summary: 'Get table by ID' })
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.tablesService.findOne(id, user)
  }

  @Get('by-agent/:agentId')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.AGENT)
  @ApiOperation({ summary: 'Get the table assigned to a specific agent' })
  findByAgent(@Param('agentId') agentId: string, @CurrentUser() user: any) {
    return this.tablesService.findByAgent(agentId, user)
  }

  @Patch(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: 'Update table — re-assign camera, bounding box, microphone, or agent' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateTableDto,
    @CurrentUser() user: any,
  ) {
    return this.tablesService.update(id, dto, user)
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: 'Deactivate table (soft delete)' })
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.tablesService.remove(id, user)
  }
}
