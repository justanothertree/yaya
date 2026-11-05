-- ⚠️ DENY-ALL IS SOMETHING A TABLE HAS TO BE GIVEN, NEVER SOMETHING IT STARTS WITH -- and a
-- RESTORE cannot be given it, because pg_dump describes an ACL by what it holds and never by
-- what it lacks. A table production revoked from `anon` has no anon entry left to dump, so
-- there is no statement to reproduce the revoke, while the schema's default privileges hand
-- `arwdDxtm` to anon and authenticated at creation time. The restored database therefore ends
-- up MORE permissive than the one it was taken from, silently, which is the direction that
-- reads as a real finding rather than as a bug in the fixture.
--
-- `[api] auto_expose_new_tables = false` in config.toml is the supported knob for this and it
-- stops four privileges short. Its SQL is exactly:
--
--   alter default privileges for role postgres in schema public
--     revoke select, insert, update, delete on tables from anon, authenticated, service_role;
--
-- so TRUNCATE, REFERENCES and TRIGGER are still handed out. Measured on db-guards run
-- 41956008931: eight findings of `a deny-all table is not deny-all`, every one of them
-- `has TRUNCATE on` -- visibility_circles, visibility_circle_members, visibility_certain and
-- picture_orphans, the four tables the house pattern keeps at RLS-on / zero-policies / no-grants.
--
-- ⚠️ AND TRUNCATE IS PRECISELY THE PRIVILEGE RLS CANNOT COVER, which is why the guard checks it
-- per privilege rather than reading one row and calling the table shut. There is no TRUNCATE
-- policy type: a deny-all table with a stray TRUNCATE grant is one verb away from being emptied,
-- and what stands between `anon` and that is PostgREST having no verb that emits one -- the
-- API's surface, not a privilege check. CLAUDE.md §3 has the measurement on a scratch table:
-- INSERT refused, DELETE allowed but 0 rows, TRUNCATE succeeded.
--
-- So this file says the whole thing rather than the four-sevenths the flag says. It is `revoke
-- all` rather than the three names the flag misses on purpose: if the CLI ever adds TRUNCATE to
-- its own list this becomes a harmless no-op, whereas three hand-written names would quietly
-- stop covering a privilege the list drops.
--
-- ⚠️ IT MUST RUN BEFORE THE DUMP, because default privileges apply at CREATE time. Afterwards it
-- would be a statement about objects that no longer need one. `[db.seed] sql_paths` puts it
-- first and `scripts/baseline.test.mjs` asserts that order.
--
-- Postgres's OWN default -- `PUBLIC` holds EXECUTE on a new function -- is deliberately left
-- alone. Production has it too, and the dump carries an explicit `REVOKE ALL ON FUNCTION ...
-- FROM PUBLIC` for every function where production took it away. Reproducing production is the
-- whole job here; being stricter than production would hide a finding just as surely.

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM anon, authenticated, service_role;
