-- ═══════════════════════════════════════════════════════════════════════════
-- Tenant isolation, append-only audit, and the constraints Prisma can't express
--
-- Written by hand because none of it fits in schema.prisma. Everything here is
-- the second half of a guarantee whose first half lives in application code:
--
--   · RLS backs up the Prisma tenant extension (src/db/tenant.ts)
--   · The audit grants back up auditedWrite (src/db/audit.ts)
--   · The payment grants back up "money is reversed, never deleted"
--
-- Migrations run as the table owner, which is not subject to RLS. The API
-- connects as hamro_app, which is.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 1. Row-level security on every tenant table ────────────────────────────
--
-- Kept as a function rather than 43 hand-written policies so a later migration
-- that adds a table only has to call it again. `db/rls.test.ts` asserts that
-- every table with a school_id actually ended up with a policy, so forgetting
-- the call fails the test suite rather than shipping an unguarded table.

CREATE OR REPLACE FUNCTION enable_tenant_rls() RETURNS void AS $fn$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid
                       AND a.attname = 'school_id'
                       AND a.attnum > 0
                       AND NOT a.attisdropped
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t.table_name);

    -- current_setting(..., true) yields NULL when app.school_id was never set,
    -- and `school_id = NULL` is not true — so a connection with no tenant
    -- context sees nothing at all. Failing closed is the entire point.
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I '
      'USING (school_id = current_setting(''app.school_id'', true)) '
      'WITH CHECK (school_id = current_setting(''app.school_id'', true))',
      t.table_name
    );
  END LOOP;
END;
$fn$ LANGUAGE plpgsql;

SELECT enable_tenant_rls();

COMMENT ON FUNCTION enable_tenant_rls() IS
  'Applies the tenant_isolation RLS policy to every public table with a school_id. Call from any migration that adds one.';


-- ── 2. audit_logs is append-only ───────────────────────────────────────────
--
-- The application can write history and read it. It cannot revise it. This is
-- what makes the log worth anything in a dispute: not even a bug in
-- src/db/audit.ts can quietly rewrite who changed a mark.

REVOKE UPDATE, DELETE, TRUNCATE ON public.audit_logs FROM hamro_app;


-- ── 3. Money is reversed, never deleted ────────────────────────────────────
--
-- A deleted payment silently changes every historical total and breaks
-- reconciliation against a bank statement. Corrections are a reversing row
-- (payments.status = 'REVERSED'), so the app has no business deleting either
-- table.

REVOKE DELETE, TRUNCATE ON public.payments FROM hamro_app;
REVOKE DELETE, TRUNCATE ON public.payment_allocations FROM hamro_app;


-- ── 4. One current academic year per school ────────────────────────────────
--
-- A partial unique index; Prisma has no syntax for the WHERE clause.

CREATE UNIQUE INDEX academic_years_one_current_per_school
  ON public.academic_years (school_id)
  WHERE is_current;


-- ── 5. Uniqueness that ignores soft-deleted rows ───────────────────────────
--
-- Delete section "A" and create a new section "A" in the same grade and year,
-- and a plain unique constraint would refuse — the deleted row still occupies
-- the name. These three are the structures schools genuinely recreate.
--
-- Admission numbers and employee codes are deliberately NOT in this list: an
-- identity number that has been issued to a person should not be silently
-- handed to somebody else. Restore the record instead.

CREATE UNIQUE INDEX sections_name_per_grade_year_live
  ON public.sections (academic_year_id, grade_level_id, name)
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX subjects_code_per_school_live
  ON public.subjects (school_id, code)
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX grade_levels_level_per_school_live
  ON public.grade_levels (school_id, level)
  WHERE deleted_at IS NULL;


-- ── 6. Attendance sanity ───────────────────────────────────────────────────
--
-- An attendance record must belong to the same date as its session. The
-- denormalised date on the record is what makes attendance percentages a
-- single-table scan, and a mismatch would quietly corrupt every one of them.

CREATE OR REPLACE FUNCTION attendance_record_date_matches_session() RETURNS trigger AS $fn$
BEGIN
  IF NEW.date IS DISTINCT FROM (SELECT date FROM public.attendance_sessions WHERE id = NEW.session_id) THEN
    RAISE EXCEPTION 'attendance_records.date must equal its session date';
  END IF;
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

CREATE TRIGGER attendance_record_date_check
  BEFORE INSERT OR UPDATE OF date, session_id ON public.attendance_records
  FOR EACH ROW EXECUTE FUNCTION attendance_record_date_matches_session();
