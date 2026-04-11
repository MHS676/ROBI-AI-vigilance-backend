-- CreateEnum
CREATE TYPE "InventoryStatus" AS ENUM ('PENDING', 'ASSIGNED', 'OFFLINE', 'REJECTED');

-- CreateEnum
CREATE TYPE "InventoryDeviceType" AS ENUM ('ESP32', 'AI_MICROPHONE', 'CAMERA');

-- CreateTable
CREATE TABLE "device_inventory" (
    "id" TEXT NOT NULL,
    "deviceType" "InventoryDeviceType" NOT NULL,
    "macAddress" TEXT,
    "ipAddress" TEXT,
    "firmwareVer" TEXT,
    "model" TEXT,
    "hostname" TEXT,
    "manufacturer" TEXT,
    "onvifXAddr" TEXT,
    "rtspUrl" TEXT,
    "status" "InventoryStatus" NOT NULL DEFAULT 'PENDING',
    "centerId" TEXT,
    "discoveryPayload" JSONB,
    "provisionConfig" JSONB,
    "lastSeenAt" TIMESTAMP(3),
    "provisionedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_inventory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "device_inventory_macAddress_key" ON "device_inventory"("macAddress");

-- CreateIndex
CREATE INDEX "device_inventory_status_idx" ON "device_inventory"("status");

-- CreateIndex
CREATE INDEX "device_inventory_deviceType_idx" ON "device_inventory"("deviceType");

-- CreateIndex
CREATE INDEX "device_inventory_centerId_idx" ON "device_inventory"("centerId");

-- AddForeignKey
ALTER TABLE "device_inventory" ADD CONSTRAINT "device_inventory_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
