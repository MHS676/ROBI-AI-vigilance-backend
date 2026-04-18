-- CreateEnum
CREATE TYPE "MediaType" AS ENUM ('VIDEO', 'AUDIO', 'WIFI_SENSING');

-- CreateTable
CREATE TABLE "local_media" (
    "id" TEXT NOT NULL,
    "mediaType" "MediaType" NOT NULL,
    "absolutePath" TEXT NOT NULL,
    "fileSize" BIGINT NOT NULL DEFAULT 0,
    "cameraNumber" INTEGER,
    "micNumber" INTEGER,
    "centerId" TEXT NOT NULL,
    "tableId" TEXT,
    "recordingDate" TEXT NOT NULL,
    "durationSec" DOUBLE PRECISION,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "local_media_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "local_media_absolutePath_key" ON "local_media"("absolutePath");

-- CreateIndex
CREATE INDEX "local_media_centerId_idx" ON "local_media"("centerId");

-- CreateIndex
CREATE INDEX "local_media_tableId_idx" ON "local_media"("tableId");

-- CreateIndex
CREATE INDEX "local_media_cameraNumber_idx" ON "local_media"("cameraNumber");

-- CreateIndex
CREATE INDEX "local_media_micNumber_idx" ON "local_media"("micNumber");

-- CreateIndex
CREATE INDEX "local_media_mediaType_idx" ON "local_media"("mediaType");

-- CreateIndex
CREATE INDEX "local_media_recordingDate_idx" ON "local_media"("recordingDate");

-- CreateIndex
CREATE INDEX "local_media_centerId_recordingDate_idx" ON "local_media"("centerId", "recordingDate");

-- AddForeignKey
ALTER TABLE "local_media" ADD CONSTRAINT "local_media_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "centers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "local_media" ADD CONSTRAINT "local_media_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "tables"("id") ON DELETE SET NULL ON UPDATE CASCADE;
