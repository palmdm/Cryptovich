-- CreateTable
CREATE TABLE "FederationFollower" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "actorUri" TEXT NOT NULL,
    "inbox" TEXT NOT NULL,
    "sharedInbox" TEXT,
    "preferredUsername" TEXT,
    "domain" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FederationFollower_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FederationFollower_creatorId_idx" ON "FederationFollower"("creatorId");

-- CreateIndex
CREATE INDEX "FederationFollower_domain_idx" ON "FederationFollower"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "FederationFollower_creatorId_actorUri_key" ON "FederationFollower"("creatorId", "actorUri");

-- AddForeignKey
ALTER TABLE "FederationFollower" ADD CONSTRAINT "FederationFollower_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "CreatorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
