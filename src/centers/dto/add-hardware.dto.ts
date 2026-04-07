import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  Matches,
} from 'class-validator'
import { OmitType } from '@nestjs/swagger'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { DeviceStatus, MicrophoneChannel } from '@prisma/client'
import { CreateCameraDto } from '../../cameras/dto/create-camera.dto'
import { CreateEspNodeDto } from '../../esp-nodes/dto/create-esp-node.dto'
import { CreateMicrophoneDto } from '../../microphones/dto/create-microphone.dto'

/**
 * Used in POST /centers/:centerId/cameras
 * centerId is injected from the URL param — not needed in the body.
 */
export class AddCameraDto extends OmitType(CreateCameraDto, [
  'centerId',
] as const) {}

/**
 * Used in POST /centers/:centerId/esp-nodes
 * centerId is injected from the URL param.
 */
export class AddEspNodeDto extends OmitType(CreateEspNodeDto, [
  'centerId',
] as const) {}

/**
 * Used in POST /centers/:centerId/microphones
 * centerId is injected from the URL param.
 */
export class AddMicrophoneDto extends OmitType(CreateMicrophoneDto, [
  'centerId',
] as const) {}
