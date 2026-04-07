import {
  IsEmail,
  IsString,
  MinLength,
  IsNotEmpty,
  IsOptional,
  IsEnum,
} from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Role } from '@prisma/client'

export class RegisterDto {
  @ApiProperty({ example: 'john.doe@falconsecurity.ng' })
  @IsEmail()
  @IsNotEmpty()
  email: string

  @ApiProperty({ example: 'Falcon@Agent2024!' })
  @IsString()
  @MinLength(8)
  password: string

  @ApiProperty({ example: 'John' })
  @IsString()
  @IsNotEmpty()
  firstName: string

  @ApiProperty({ example: 'Doe' })
  @IsString()
  @IsNotEmpty()
  lastName: string

  @ApiPropertyOptional({ enum: Role, default: Role.AGENT })
  @IsEnum(Role)
  @IsOptional()
  role?: Role

  @ApiPropertyOptional({ example: 'clxyz...' })
  @IsString()
  @IsOptional()
  centerId?: string
}
