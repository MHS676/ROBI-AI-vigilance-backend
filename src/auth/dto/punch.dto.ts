import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsString, IsNotEmpty, IsOptional } from 'class-validator'

export class PunchDto {
  @ApiProperty({ description: 'CUID of the recognised agent', example: 'clxyz123abc' })
  @IsString()
  @IsNotEmpty()
  userId: string

  @ApiProperty({ description: 'CUID of the branch where the gate camera is installed', example: 'clcenter456' })
  @IsString()
  @IsNotEmpty()
  centerId: string

  @ApiPropertyOptional({
    description: 'Absolute path to the captured face JPEG saved on the local server',
    example: '/data/gate-captures/entry/2026-04-19_07-53-12_clxyz.jpg',
  })
  @IsOptional()
  @IsString()
  faceImage?: string
}
