/*
  Warnings:

  - You are about to drop the column `search_vector` on the `KnowledgeChunk` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "KnowledgeChunk_search_vector_gin_idx";

-- AlterTable
ALTER TABLE "KnowledgeChunk" DROP COLUMN "search_vector";

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "pinned" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ClinicalChecklist" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "titleAr" TEXT NOT NULL,
    "titleEn" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'emergency',
    "stepsJson" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClinicalChecklist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrugReference" (
    "id" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "classAr" TEXT,
    "entriesJson" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DrugReference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClinicalChecklist_key_key" ON "ClinicalChecklist"("key");

-- CreateIndex
CREATE UNIQUE INDEX "DrugReference_nameEn_key" ON "DrugReference"("nameEn");
