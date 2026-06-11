-- AlterTable: add user-customization columns
ALTER TABLE "recipes" ADD COLUMN "notes" TEXT;
ALTER TABLE "recipes" ADD COLUMN "edited" BOOLEAN NOT NULL DEFAULT false;
