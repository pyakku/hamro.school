-- Creates the role the API connects as at runtime.
--
-- Two roles, deliberately:
--   hamro      (owner)  — owns the tables, runs migrations and the seed.
--                         Table owners bypass RLS, which is what lets a
--                         migration touch every school's rows.
--   hamro_app  (app)    — what the API connects as. Subject to every RLS
--                         policy, so a query that forgets its tenant filter
--                         returns nothing instead of another school's data.
--
-- Docker runs this automatically on first boot. Running Postgres some other
-- way? Run this file by hand as the owner:
--   APP_DB_PASSWORD=... psql -d hamro_school_dev -f docker/postgres/init/01-app-role.sql

\set app_password `echo "${APP_DB_PASSWORD:-hamro_app}"`

-- \gexec, not a DO block: psql does not substitute :variables inside
-- dollar-quoted strings, so a password passed in that way arrives as the
-- literal text ":'app_password'".
SELECT format('CREATE ROLE hamro_app LOGIN PASSWORD %L', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hamro_app')
\gexec

SELECT format('ALTER ROLE hamro_app PASSWORD %L', :'app_password')
\gexec

SELECT format('GRANT CONNECT ON DATABASE %I TO hamro_app', current_database())
\gexec

GRANT USAGE ON SCHEMA public TO hamro_app;

-- The app reads and writes data. It never changes the shape of the database:
-- no CREATE, no ALTER, no DROP. Migrations run as the owner.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO hamro_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO hamro_app;

-- Tables created later by a migration get the same grants automatically.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO hamro_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO hamro_app;
