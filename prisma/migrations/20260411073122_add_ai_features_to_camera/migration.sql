-- CreateEnum
CREATE TYPE "AiFeature" AS ENUM ('WEAPON', 'FIGHT', 'FALL', 'FIRE', 'CROWD');

-- AlterTable
ALTER TABLE "cameras" ADD COLUMN     "aiFeatures" JSONB NOT NULL DEFAULT '["WEAPON","FIGHT","FALL","FIRE","CROWD"]';
