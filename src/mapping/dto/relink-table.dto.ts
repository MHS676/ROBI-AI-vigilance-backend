import { IsString, IsOptional, IsInt, Min, ValidateNested } from 'class-validator'
import { Type } from 'class-transformer'
import { ApiPropertyOptional } from '@nestjs/swagger'
import { BoundingBoxDto } from './link-table.dto'

/**
 * RelinkTableDto — swap one or more hardware components on an already-linked table.
 * All fields are optional; only the provided fields will be updated.
 * The endpoint will still validate that any new device/agent is unassigned.
 */
export class RelinkTableDto {
  @ApiPropertyOptional({
    example: 'clxyz456000001ghi',
    description: 'Replace the current camera with this camera ID (must be unassigned)',
  })
  @IsString()
  @IsOptional()
  cameraId?: string

  @ApiPropertyOptional({
    type: BoundingBoxDto,
    description: 'Update the bounding box without changing the camera',
  })
  @ValidateNested()
  @Type(() => BoundingBoxDto)
  @IsOptional()
  boundingBox?: BoundingBoxDto

  @ApiPropertyOptional({
    example: 'clxyz789000002jkl',
    description: 'Replace the current microphone with this microphone ID (must be unassigned)',
  })
  @IsString()
  @IsOptional()
  microphoneId?: string

  @ApiPropertyOptional({
    example: 'clxyz000000004mno',
    description: 'Replace the currently assigned agent with this agent ID (must be unassigned)',
  })
  @IsString()
  @IsOptional()
  agentId?: string

  @ApiPropertyOptional({
    example: 'Moved from booth 3 to booth 7',
    description: 'Update the freeform notes for this table',
  })
  @IsString()
  @IsOptional()
  notes?: string
}
