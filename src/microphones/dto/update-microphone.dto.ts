import { PartialType } from '@nestjs/swagger'
import { CreateMicrophoneDto } from './create-microphone.dto'

export class UpdateMicrophoneDto extends PartialType(CreateMicrophoneDto) {}
