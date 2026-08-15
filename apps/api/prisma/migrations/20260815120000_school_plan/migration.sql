-- Self-signup: a school picks its own subdomain and lands on the beta plan.

CREATE TYPE "SchoolPlan" AS ENUM ('BETA', 'STARTER', 'PRO');

ALTER TABLE "schools"
  ADD COLUMN "plan" "SchoolPlan" NOT NULL DEFAULT 'BETA',
  ADD COLUMN "onboarded_at" TIMESTAMPTZ(3);

-- The slug is a DNS label: it becomes <slug>.hamro.school, so the database
-- should refuse anything that could not be one. Application validation also
-- rejects reserved names like "admin" and "api", which this cannot know about.
ALTER TABLE "schools"
  ADD CONSTRAINT "schools_slug_is_dns_label"
  CHECK (slug ~ '^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$' AND length(slug) >= 2);
