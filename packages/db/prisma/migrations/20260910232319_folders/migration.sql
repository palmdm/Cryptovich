-- CreateEnum
CREATE TYPE "FolderItemKind" AS ENUM ('PRODUCT', 'UPLOAD', 'LINK');

-- CreateTable
CREATE TABLE "Folder" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Folder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FolderItem" (
    "id" TEXT NOT NULL,
    "folderId" TEXT NOT NULL,
    "kind" "FolderItemKind" NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "productId" TEXT,
    "storageKey" TEXT,
    "originalFilename" TEXT,
    "mimeType" TEXT,
    "sizeBytes" BIGINT,
    "url" TEXT,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FolderItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Folder_creatorId_position_idx" ON "Folder"("creatorId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "Folder_creatorId_slug_key" ON "Folder"("creatorId", "slug");

-- CreateIndex
CREATE INDEX "FolderItem_folderId_position_idx" ON "FolderItem"("folderId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "FolderItem_folderId_productId_key" ON "FolderItem"("folderId", "productId");

-- AddForeignKey
ALTER TABLE "Folder" ADD CONSTRAINT "Folder_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "CreatorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FolderItem" ADD CONSTRAINT "FolderItem_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FolderItem" ADD CONSTRAINT "FolderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "DigitalProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
