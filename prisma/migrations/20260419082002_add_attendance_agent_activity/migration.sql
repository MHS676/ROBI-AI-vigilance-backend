-- AlterTable
ALTER TABLE "users" ADD COLUMN     "facePhotoPath" TEXT;

-- CreateTable
CREATE TABLE "attendance" (
    "id" TEXT NOT NULL,
    "entryTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "entryImage" TEXT,
    "exitTime" TIMESTAMP(3),
    "exitImage" TEXT,
    "userId" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_activity" (
    "id" TEXT NOT NULL,
    "activeMinutes" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "gossipCount" INTEGER NOT NULL DEFAULT 0,
    "avgSentimentScore" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_activity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "attendance_userId_idx" ON "attendance"("userId");

-- CreateIndex
CREATE INDEX "attendance_centerId_idx" ON "attendance"("centerId");

-- CreateIndex
CREATE INDEX "attendance_entryTime_idx" ON "attendance"("entryTime");

-- CreateIndex
CREATE INDEX "attendance_userId_entryTime_idx" ON "attendance"("userId", "entryTime");

-- CreateIndex
CREATE INDEX "agent_activity_userId_idx" ON "agent_activity"("userId");

-- CreateIndex
CREATE INDEX "agent_activity_tableId_idx" ON "agent_activity"("tableId");

-- CreateIndex
CREATE INDEX "agent_activity_lastSeen_idx" ON "agent_activity"("lastSeen");

-- CreateIndex
CREATE INDEX "agent_activity_userId_lastSeen_idx" ON "agent_activity"("userId", "lastSeen");

-- CreateIndex
CREATE UNIQUE INDEX "agent_activity_userId_tableId_createdAt_key" ON "agent_activity"("userId", "tableId", "createdAt");

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "centers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_activity" ADD CONSTRAINT "agent_activity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_activity" ADD CONSTRAINT "agent_activity_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "tables"("id") ON DELETE CASCADE ON UPDATE CASCADE;
