-- The platform console needs to read across tenants; the app role cannot.
--
-- Every tenant policy gains one more way to be satisfied: a transaction that
-- has deliberately set `app.platform = 'on'`. That switch is set in exactly one
-- place — withPlatform() in src/platform/service.ts — and only after a platform
-- admin token has been verified.
--
-- This does widen the second layer of defence, so it is worth being precise
-- about what it does and does not do:
--
--   · It is per transaction, like app.school_id. Nothing leaks between requests.
--   · It does not weaken the first layer: the Prisma tenant extension still
--     scopes every school-facing query, and platform queries do not use it.
--   · It is greppable. One function sets it, and any new caller is visible in
--     review as `withPlatform`.
--
-- The alternative — a second database role with its own credentials — is
-- stronger and worth doing if the console ever grows write access beyond plans
-- and flags. For read-only listings this is the proportionate answer.

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

    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I '
      'USING (school_id = current_setting(''app.school_id'', true) '
      '       OR current_setting(''app.platform'', true) = ''on'') '
      'WITH CHECK (school_id = current_setting(''app.school_id'', true))',
      t.table_name
    );
  END LOOP;
END;
$fn$ LANGUAGE plpgsql;

SELECT enable_tenant_rls();
