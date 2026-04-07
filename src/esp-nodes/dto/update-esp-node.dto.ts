import { PartialType } from '@nestjs/swagger'
import { CreateEspNodeDto } from './create-esp-node.dto'

export class UpdateEspNodeDto extends PartialType(CreateEspNodeDto) {}
