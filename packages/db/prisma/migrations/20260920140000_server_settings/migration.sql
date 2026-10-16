-- Server-wide switches owned by the administrator (API access mode,
-- whether federation is on for this installation, and whatever comes
-- next). Hand-written because `prisma migrate dev` needs a TTY.
CREATE TABLE "ServerSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServerSetting_pkey" PRIMARY KEY ("key")
);
