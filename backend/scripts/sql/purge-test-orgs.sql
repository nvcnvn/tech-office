-- Purge organisations left behind by the integration suite.
--
-- Every test organisation is registered by helper_test.go's mustRegisterNewOrg with a
-- subdomain of the form 'to' + 20 hex characters, so the pattern below identifies them
-- exactly; anything a human created (which never takes that shape) is left alone.
--
-- Why this exists: the suite creates roughly 150 organisations per run and deletes none
-- of them. Left unchecked the local database grows without bound and the suite slows
-- down proportionally — a 5 GB database took the serial run from 316s to 535s and the
-- parallel run from 53s to 366s, and the extra latency broke timing-sensitive presence
-- and conversion tests. TestMain in the integration package now cleans up after each
-- run; this script clears a backlog that accumulated before that existed.
--
-- Usage:  make test-db-purge      (or: psql "$DATABASE_URL" -f this-file)

\set ON_ERROR_STOP on

BEGIN;

-- Organisation subtrees are removed whole, so referential integrity holds across the
-- delete even though the FK triggers are not evaluating it row by row. Not every FK to
-- public.organization is ON DELETE CASCADE (ritual_definition, among others, is not),
-- so without this the delete order would have to be topologically sorted by hand.
SET LOCAL session_replication_role = replica;

DO $$
DECLARE
    r        record;
    n        bigint;
    rows_del bigint := 0;
    orgs_del bigint;
BEGIN
    -- Every table that carries an organization_id, discovered rather than listed, so a
    -- new tenant-scoped table does not silently start leaking rows.
    FOR r IN
        SELECT c.table_schema AS s, c.table_name AS tn
          FROM information_schema.columns c
          JOIN information_schema.tables t
            ON t.table_schema = c.table_schema
           AND t.table_name  = c.table_name
         WHERE c.column_name  = 'organization_id'
           AND t.table_type   = 'BASE TABLE'
           AND c.table_schema NOT IN ('pg_catalog', 'information_schema')
    LOOP
        EXECUTE format(
            'DELETE FROM %I.%I WHERE organization_id IN '
            '(SELECT id FROM public.organization WHERE subdomain ~ ''^to[0-9a-f]{20}$'')',
            r.s, r.tn);
        GET DIAGNOSTICS n = ROW_COUNT;
        rows_del := rows_del + n;
    END LOOP;

    DELETE FROM public.organization WHERE subdomain ~ '^to[0-9a-f]{20}$';
    GET DIAGNOSTICS orgs_del = ROW_COUNT;

    RAISE NOTICE 'purged % test organisations and % org-scoped rows', orgs_del, rows_del;
END $$;

COMMIT;

SELECT count(*) FILTER (WHERE subdomain ~ '^to[0-9a-f]{20}$') AS test_orgs_remaining,
       count(*)                                              AS organizations_total
  FROM public.organization;
