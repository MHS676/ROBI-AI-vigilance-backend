import { ApiProperty } from '@nestjs/swagger'
import { IsArray, IsEnum } from 'class-validator'

/**
 * The set of AI inference models that can be toggled per-camera.
 *
 * These values are stored as a JSON array on Camera.aiFeatures and
 * forwarded to the Python AI microservice so it can start / stop the
 * relevant inference thread for that camera stream.
 */
export enum AiFeature {
  WEAPON = 'WEAPON', /// knife / gun / pistol / rifle / weapon detection
  FIGHT  = 'FIGHT',  /// physical altercation / aggression detection
  FALL   = 'FALL',   /// person-fall detection
  FIRE   = 'FIRE',   /// fire and smoke detection
  CROWD  = 'CROWD',  /// over-crowding / crowd density detection
}

export const AI_FEATURE_META: Record<
  AiFeature,
  { label: string; description: string; anomalyTypes: string[] }
> = {
  [AiFeature.WEAPON]: {
    label:        'Weapon Detection',
    description:  'Detects knives, guns, pistols, rifles and other weapons.',
    anomalyTypes: ['WEAPON_DETECTED'],
  },
  [AiFeature.FIGHT]: {
    label:        'Fight / Aggression',
    description:  'Detects physical altercations and aggressive behaviour.',
    anomalyTypes: ['FIGHT_DETECTED'],
  },
  [AiFeature.FALL]: {
    label:        'Fall Detection',
    description:  'Detects a person falling inside the camera zone.',
    anomalyTypes: ['FALL_DETECTED'],
  },
  [AiFeature.FIRE]: {
    label:        'Fire & Smoke',
    description:  'Detects fire or smoke in the camera frame.',
    anomalyTypes: ['FIRE_DETECTED'],
  },
  [AiFeature.CROWD]: {
    label:        'Crowd Detection',
    description:  'Alerts when over-crowding is detected.',
    anomalyTypes: ['CROWD_DETECTED'],
  },
}

/** Maps an anomaly_type string (from the AI service) to the AiFeature gate */
export const ANOMALY_TO_FEATURE: Record<string, AiFeature> = {
  WEAPON_DETECTED: AiFeature.WEAPON,
  FIGHT_DETECTED:  AiFeature.FIGHT,
  FALL_DETECTED:   AiFeature.FALL,
  FIRE_DETECTED:   AiFeature.FIRE,
  CROWD_DETECTED:  AiFeature.CROWD,
}

export class UpdateAiFeaturesDto {
  @ApiProperty({
    description: 'Enabled AI inference features for this camera.',
    type:        [String],
    enum:        AiFeature,
    isArray:     true,
    example:     [AiFeature.WEAPON, AiFeature.FALL],
  })
  @IsArray()
  @IsEnum(AiFeature, { each: true })
  aiFeatures: AiFeature[]
}
