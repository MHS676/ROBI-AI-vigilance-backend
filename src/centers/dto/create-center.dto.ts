import {
  IsString,
  IsOptional,
  IsBoolean,
  IsNotEmpty,
  Matches,
} from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class CreateCenterDto {
  @ApiProperty({ example: 'Falcon Branch — Abuja' })
  @IsString()
  @IsNotEmpty()
  name: string

  @ApiProperty({ example: 'FAL-ABJ-002' })
  @IsString()
  @Matches(/^FAL-[A-Z]{3}-\d{3}$/, {
    message: 'code must match format FAL-XXX-NNN',
  })
  code: string

  @ApiPropertyOptional({ example: '12 Garki Street' })
  @IsString()
  @IsOptional()
  address?: string

  @ApiPropertyOptional({ example: 'Abuja' })
  @IsString()
  @IsOptional()
  city?: string

  @ApiPropertyOptional({ example: 'FCT' })
  @IsString()
  @IsOptional()
  state?: string

  @ApiPropertyOptional({ example: 'Nigeria' })
  @IsString()
  @IsOptional()
  country?: string

  @ApiPropertyOptional({ example: '+234-800-FALCON-2' })
  @IsString()
  @IsOptional()
  phone?: string

  @ApiPropertyOptional({ default: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean
}
