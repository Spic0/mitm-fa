-- Private, link-only presentation decks (/presentation/:slug) plus their
-- visit/event analytics. Purely additive: three new tables and one new
-- nullable FK direction off User — no existing table is altered, so this is
-- safe to apply to a live database with no backfill.

-- CreateTable
CREATE TABLE "PrivatePresentation" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "recipient" TEXT,
    "status" TEXT NOT NULL DEFAULT 'enabled',
    "expiresAt" TIMESTAMP(3),
    "passwordHash" TEXT,
    "content" JSONB,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrivatePresentation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PresentationVisit" (
    "id" TEXT NOT NULL,
    "presentationId" TEXT NOT NULL,
    "visitorKey" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "referrer" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dwellMs" INTEGER NOT NULL DEFAULT 0,
    "maxSectionIndex" INTEGER NOT NULL DEFAULT 0,
    "wizardCompleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PresentationVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PresentationEvent" (
    "id" TEXT NOT NULL,
    "presentationId" TEXT NOT NULL,
    "visitId" TEXT,
    "type" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PresentationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PrivatePresentation_slug_key" ON "PrivatePresentation"("slug");

-- CreateIndex
CREATE INDEX "PrivatePresentation_status_createdAt_idx" ON "PrivatePresentation"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PresentationVisit_presentationId_startedAt_idx" ON "PresentationVisit"("presentationId", "startedAt");

-- CreateIndex
CREATE INDEX "PresentationVisit_presentationId_visitorKey_idx" ON "PresentationVisit"("presentationId", "visitorKey");

-- CreateIndex
CREATE INDEX "PresentationEvent_presentationId_type_createdAt_idx" ON "PresentationEvent"("presentationId", "type", "createdAt");

-- AddForeignKey
-- SetNull, not Cascade: deleting the admin who created a deck must never
-- delete the deck itself (mirrors the nullable actor FK on SystemLog).
ALTER TABLE "PrivatePresentation" ADD CONSTRAINT "PrivatePresentation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PresentationVisit" ADD CONSTRAINT "PresentationVisit_presentationId_fkey" FOREIGN KEY ("presentationId") REFERENCES "PrivatePresentation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PresentationEvent" ADD CONSTRAINT "PresentationEvent_presentationId_fkey" FOREIGN KEY ("presentationId") REFERENCES "PrivatePresentation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PresentationEvent" ADD CONSTRAINT "PresentationEvent_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "PresentationVisit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
