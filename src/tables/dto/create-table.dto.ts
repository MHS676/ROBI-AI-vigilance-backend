import {
  IsString,
  IsNotEmpty,
  IsInt,
  IsOptional,
  IsBoolean,
  IsObject,
  Min,
  ValidateNested,
} from 'class-validator'
import { Type } from 'class-transformer'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class BoundingBoxDto {
  @ApiProperty({ description: 'X coordinate (pixels or 0-1 normalized)', example: 120 })
  @IsInt()
  @Min(0)
  x: number

  @ApiProperty({ description: 'Y coordinate (pixels or 0-1 normalized)', example: 80 })
  @IsInt()
  @Min(0)
  y: number

  @ApiProperty({ description: 'Width of bounding box', example: 320 })
  @IsInt()
  @Min(1)
  w: number

  @ApiProperty({ description: 'Height of bounding box', example: 240 })
  @IsInt()
  @Min(1)
  h: number
}

export class CreateTableDto {
  @ApiProperty({ example: 'Table 01 — Teller A' })
  @IsString()
  @IsNotEmpty()
  name: string

  @ApiProperty({ example: 1, description: 'Physical table number within center (unique per center)' })
  @IsInt()
  @Min(1)
  tableNumber: number

  @ApiProperty({ example: 'clxyz...' })
  @IsString()
  @IsNotEmpty()
  centerId: string

  @ApiProperty({ example: 'clcam...' })
  @IsString()
  @IsNotEmpty()
  cameraId: string

  @ApiProperty({
    description: 'Camera bounding box for this table { x, y, w, h }',
    type: BoundingBoxDto,
  })
  @ValidateNested()
  @Type(() => BoundingBoxDto)
  boundingBox: BoundingBoxDto

  @ApiProperty({ example: 'clmic...' })
  @IsString()
  @IsNotEmpty()
  microphoneId: string

  @ApiProperty({ example: 'cluser...' })
  @IsString()
  @IsNotEmpty()
  agentId: string

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  notes?: string
}
