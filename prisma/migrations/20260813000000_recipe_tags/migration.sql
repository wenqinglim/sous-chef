-- AlterTable: add freeform recipe tags (curation metadata, e.g. "curry", "weeknight").
-- Postgres native array; empty array is a safe default for existing rows.
ALTER TABLE "recipes" ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT '{}';
