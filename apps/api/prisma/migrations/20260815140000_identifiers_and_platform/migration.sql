-- Login identifiers, platform settings, and a place for real contact details.
--
-- Users sign in as `username@school-slug`, which is an identifier and not a
-- mailbox. Contact details move to their own columns so that notifications and
-- password resets have somewhere real to go.

ALTER TABLE "users" RENAME COLUMN "email" TO "identifier";

ALTER TABLE "users"
  ADD COLUMN "username" TEXT,
  ADD COLUMN "contact_email" TEXT;

-- Existing rows: everything before the first @ becomes the username, and the
-- old address is kept as a contact address since it was a real one.
UPDATE "users"
SET "username" = split_part("identifier", '@', 1),
    "contact_email" = "identifier";

ALTER TABLE "users" ALTER COLUMN "username" SET NOT NULL;

DROP INDEX IF EXISTS "users_school_id_email_key";
CREATE UNIQUE INDEX "users_school_id_username_key" ON "users" ("school_id", "username");
CREATE UNIQUE INDEX "users_identifier_key" ON "users" ("identifier");
CREATE INDEX "users_school_id_contact_email_idx" ON "users" ("school_id", "contact_email");

ALTER TABLE "platform_admins" ADD COLUMN "last_login_at" TIMESTAMPTZ(3);

CREATE TABLE "platform_settings" (
  "key" TEXT PRIMARY KEY,
  "value" JSONB NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);

-- The beta is open by default; the console can close it.
INSERT INTO "platform_settings" ("key", "value")
VALUES ('signupEnabled', 'true'::jsonb)
ON CONFLICT ("key") DO NOTHING;

-- platform_settings and platform_admins have no school_id, so RLS does not
-- apply — they are not tenant data. The app role still needs to read them.
GRANT SELECT, INSERT, UPDATE ON public.platform_settings TO hamro_app;
GRANT SELECT, UPDATE ON public.platform_admins TO hamro_app;
