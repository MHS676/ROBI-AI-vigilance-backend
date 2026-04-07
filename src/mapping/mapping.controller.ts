import {
  Controller,
  Post,
  Patch,
  Delete,
  Get,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common'
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
} from '@nestjs/swagger'
import { Role } from '@prisma/client'
import { MappingService } from './mapping.service'
import { LinkTableDto } from './dto/link-table.dto'
import { RelinkTableDto } from './dto/relink-table.dto'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../auth/guards/roles.guard'
import { Roles } from '../auth/decorators/roles.decorator'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { RequestUser } from '../auth/interfaces/jwt-payload.interface'

@ApiTags('Mapping')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('mapping')
export class MappingController {
  constructor(private readonly mappingService: MappingService) {}

  // ── POST /mapping/link-table ────────────────────────────────────────────────
  @Post('link-table')
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({
    summary: '🔗 Link a table to a camera, microphone, and agent — THE CORE mapping endpoint',
    description: `
Atomically links an existing Table record to:
- **Camera** (provides video feed + bounding box)
- **Microphone** (audio for that seat)
- **Agent** (the human monitoring this table)

**Pre-flight validations:**
1. Center must exist and be active
2. Table must belong to the specified center and be **unlinked**
3. Camera must belong to the same center and **not already assigned** to another table
4. Microphone must belong to the same center and **not already assigned** to another table
5. Agent must belong to the same center, have role AGENT, be active, and **not already assigned** to another table

All changes are written in a single \`$transaction\` — either all succeed or none.

**SUPER_ADMIN only.**
    `.trim(),
  })
  @ApiResponse({ status: 201, description: 'Table successfully linked' })
  @ApiResponse({ status: 400, description: 'Validation error (wrong center, inactive center/agent, wrong role)' })
  @ApiResponse({ status: 404, description: 'Center, table, camera, microphone, or agent not found' })
  @ApiResponse({ status: 409, description: 'Camera, microphone, or agent already assigned to another table' })
  linkTable(@Body() dto: LinkTableDto, @CurrentUser() user: RequestUser) {
    return this.mappingService.linkTable(dto, user)
  }

  // ── PATCH /mapping/relink-table/:tableId ────────────────────────────────────
  @Patch('relink-table/:tableId')
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({
    summary: '🔄 Swap one or more hardware components on an already-linked table',
    description: `
Partial update — only the fields you include will be changed.

Use this to:
- Replace a broken camera without disturbing the microphone/agent
- Reassign a table to a different agent on a shift change
- Update the bounding box after camera repositioning

**Each provided component is validated** — it must be unassigned and belong to the same center.
    `.trim(),
  })
  @ApiParam({ name: 'tableId', description: 'CUID of the table to update' })
  @ApiResponse({ status: 200, description: 'Hardware mapping updated' })
  @ApiResponse({ status: 404, description: 'Table or replacement component not found' })
  @ApiResponse({ status: 409, description: 'Replacement component already assigned elsewhere' })
  relinkTable(
    @Param('tableId') tableId: string,
    @Body() dto: RelinkTableDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.mappingService.relinkTable(tableId, dto, user)
  }

  // ── DELETE /mapping/unlink-table/:tableId ───────────────────────────────────
  @Delete('unlink-table/:tableId')
  @Roles(Role.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '🗑️ Unlink all hardware from a table (soft unlink — table record is kept)',
    description: `
Clears the camera, bounding box, microphone, and agent from a table.
The Table row itself is **not deleted** — it becomes an empty/unassigned slot.

Use before decommissioning hardware or moving equipment to a different center.
    `.trim(),
  })
  @ApiParam({ name: 'tableId', description: 'CUID of the table to unlink' })
  @ApiResponse({ status: 200, description: 'Table fully unlinked' })
  @ApiResponse({ status: 404, description: 'Table not found' })
  unlinkTable(@Param('tableId') tableId: string, @CurrentUser() user: RequestUser) {
    return this.mappingService.unlinkTable(tableId, user)
  }

  // ── GET /mapping/center/:centerId ───────────────────────────────────────────
  @Get('center/:centerId')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({
    summary: '📊 Full mapping view for a center',
    description: `
Returns a complete picture of this center's hardware mapping state:

- **linked**: Tables fully linked to a camera + microphone + agent
- **partial**: Tables with some (but not all) hardware assigned
- **empty**: Tables with no hardware assigned yet
- **available**: Cameras, microphones, and agents ready for assignment

Also includes **summary counts** for at-a-glance status.

ADMIN users can only access their own center.
    `.trim(),
  })
  @ApiParam({ name: 'centerId', description: 'Center CUID' })
  @ApiResponse({ status: 200, description: 'Center mapping breakdown' })
  @ApiResponse({ status: 404, description: 'Center not found' })
  getCenterMapping(
    @Param('centerId') centerId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.mappingService.getCenterMapping(centerId, user)
  }

  // ── GET /mapping/table/:tableId ─────────────────────────────────────────────
  @Get('table/:tableId')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({
    summary: '🔍 Detailed mapping view for a single table',
    description: `
Returns a single table with its complete hardware assignment:
- camera (name, RTSP URL, IP, status)
- microphone (name, channel, IP, status)
- agent (name, email, active status)
- boundingBox (JSON coordinates)

Also returns **isFullyLinked / isPartiallyLinked / isUnlinked** boolean flags.
    `.trim(),
  })
  @ApiParam({ name: 'tableId', description: 'Table CUID' })
  @ApiResponse({ status: 200, description: 'Table mapping details' })
  @ApiResponse({ status: 404, description: 'Table not found' })
  getTableMapping(@Param('tableId') tableId: string, @CurrentUser() user: RequestUser) {
    return this.mappingService.getTableMapping(tableId, user)
  }
}
