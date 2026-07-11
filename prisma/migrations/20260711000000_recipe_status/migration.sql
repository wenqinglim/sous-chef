-- AlterTable: add recipe status ("tried_and_tested" | "saved_for_later").
-- New rows default to saved_for_later; everything already in the library is
-- assumed tried_and_tested.
ALTER TABLE "recipes" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'saved_for_later';
UPDATE "recipes" SET "status" = 'tried_and_tested';
