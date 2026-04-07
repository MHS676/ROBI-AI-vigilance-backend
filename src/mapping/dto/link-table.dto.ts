import {
  IsString,
  IsNotEmpty,
  IsInt,
  Min,
  IsOptional,
  ValidateNested,
} from 'class-validator'
import { Type } from 'class-transformer'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

// ─── Bounding Box ──────────────────────────────────────────────────────────────
// Mirrors the BoundingBoxDto in tables module but is re-declared here so the
// mapping module is self-contained and doesn't create a circular dependency.
export class BoundingBoxDto {
  @ApiProperty({ example: 120, description: 'X coordinate of the top-left corner (px)' })
  @IsInt()
  @Min(0)
  x: number

  @ApiProperty({ example: 80, description: 'Y coordinate of the top-left corner (px)' })
  @IsInt()
  @Min(0)
  y: number

  @ApiProperty({ example: 320, description: 'Width of the bounding box (px, min 1)' })
  @IsInt()
  @Min(1)
  w: number

  @ApiProperty({ example: 240, description: 'Height of the bounding box (px, min 1)' })
  @IsInt()
  @Min(1)
  h: number
}

// ─── Link-Table DTO ────────────────────────────────────────────────────────────
export class LinkTableDto {
  @ApiProperty({
    example: 'clxyz123000000abc',
    description: 'CUID of the center that owns all the hardware being linked',
  })
  @IsString()
  @IsNotEmpty()
  centerId: string

  @ApiProperty({
    example: 'clxyz789000003def',
    description: 'CUID of the existing Table record to populate',
  })
  @IsString()
  @IsNotEmpty()
  tableId: string

  @ApiProperty({
    example: 'clxyz456000001ghi',
    description: 'CUID of the Camera to attach — must belong to the same center and be unassigned',
  })
  @IsString()
  @IsNotEmpty()
  cameraId: string

  @ApiProperty({
    type: BoundingBoxDto,
    description: 'Pixel bounding box on the camera frame where this table is monitored',
  })
  @ValidateNested()
  @Type(() => BoundingBoxDto)
  boundingBox: BoundingBoxDto

  @ApiProperty({
    example: 'clxyz789000002jkl',
    description:
      'CUID of the Microphone to attach — must belong to same center, be unassigned, and not linked to another table',
  })
  @IsString()
  @IsNotEmpty()
  microphoneId: string

  @ApiProperty({
    example: 'clxyz000000004mno',
    description:
      'User ID of the AGENT to assign — must belong to same center and not already have an assigned table',
  })
  @IsString()
  @IsNotEmpty()
  agentId: string

  @ApiPropertyOptional({
    example: 'VIP booth near window — faces main entrance',
    description: 'Optional human-readable notes about this table mapping',
  })
  @IsString()
  @IsOptional()
  notes?: string
}
