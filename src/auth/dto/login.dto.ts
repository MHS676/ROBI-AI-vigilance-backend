import { IsEmail, IsString, MinLength, IsNotEmpty } from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'

export class LoginDto {
  @ApiProperty({ example: 'admin@falconsecurity.ng' })
  @IsEmail()
  @IsNotEmpty()
  email: string

  @ApiProperty({ example: 'Falcon@Admin2024!' })
  @IsString()
  @MinLength(8)
  password: string
}
