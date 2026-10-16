-- CreateTable
CREATE TABLE "ProgramProgress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "completedKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastKey" TEXT,
    "lastSection" TEXT,
    "lastOpenedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProgramProgress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProgramProgress_userId_lastOpenedAt_idx" ON "ProgramProgress"("userId", "lastOpenedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProgramProgress_userId_productId_key" ON "ProgramProgress"("userId", "productId");

-- AddForeignKey
ALTER TABLE "ProgramProgress" ADD CONSTRAINT "ProgramProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramProgress" ADD CONSTRAINT "ProgramProgress_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
