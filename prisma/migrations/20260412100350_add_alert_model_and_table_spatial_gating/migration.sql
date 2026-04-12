-- AlterTable
ALTER TABLE "tables" ADD COLUMN     "audioThresholdDb" INTEGER,
ADD COLUMN     "wifiZoneHeight" INTEGER,
ADD COLUMN     "wifiZoneWidth" INTEGER,
ADD COLUMN     "wifiZoneX" INTEGER,
ADD COLUMN     "wifiZoneY" INTEGER;

-- CreateTable
CREATE TABLE "alerts" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "imageUrl" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "centerId" TEXT NOT NULL,
    "tableId" TEXT,
    "cameraId" TEXT,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "alerts_centerId_idx" ON "alerts"("centerId");

-- CreateIndex
CREATE INDEX "alerts_tableId_idx" ON "alerts"("tableId");

-- CreateIndex
CREATE INDEX "alerts_cameraId_idx" ON "alerts"("cameraId");

-- CreateIndex
CREATE INDEX "alerts_type_idx" ON "alerts"("type");

-- CreateIndex
CREATE INDEX "alerts_severity_idx" ON "alerts"("severity");

-- CreateIndex
CREATE INDEX "alerts_timestamp_idx" ON "alerts"("timestamp");

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "centers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "tables"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_cameraId_fkey" FOREIGN KEY ("cameraId") REFERENCES "cameras"("id") ON DELETE SET NULL ON UPDATE CASCADE;
