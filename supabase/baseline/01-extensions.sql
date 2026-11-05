-- ⚠️ THE DUMP CANNOT BUILD THE SCHEMA IT DESCRIBES, AND THIS IS THE MISSING FIRST PAGE.
-- `db dump --schema public,finance` emits no `create extension`: an extension belongs to the
-- database rather than to either named schema, so it falls outside what was asked for -- while
-- two things in the dump need one, and need it at DDL time rather than at call time:
--
--   * `profiles.username` and `player_registry.player_name` are `extensions.citext` columns, and
--     a column's type is resolved when the table is created. Measured: db-guards run
--     41951750375, the workflow's first real run, died on statement 673 with
--     `type "extensions.citext" does not exist` -- the first citext COLUMN, which is not the
--     dump's first citext mention.
--   * `circuit_groups.join_code` defaults to `encode(extensions.gen_random_bytes(6), 'hex')`,
--     and a DEFAULT is parsed along with the column. That one did NOT fail, because the local
--     stack already carries pgcrypto in `extensions`. It is created here anyway, as insurance
--     that costs nothing where it is already present.
--
-- Everything else this schema borrows -- `extensions.http_get`, `extensions.urlencode`,
-- `vault.decrypted_secrets` -- is reached only from inside a function body, which the dump's own
-- `check_function_bodies = false` lets through unresolved. Those functions exist in CI's copy of
-- the schema and would fail if called; nothing in supabase/tests calls them. Creating `http`
-- here for completeness would make the job depend on the local image carrying it, for nothing.
--
-- ⚠️ THIS FILE IS DELIBERATELY NOT PART OF THE DUMP, for the reason 02-triggers.sql gives at
-- length: the dump's header says how to regenerate it, and a regeneration is a fresh file that
-- silently drops anything hand-written inside the old one. `[db.seed] sql_paths` in config.toml
-- applies this first, then the dump, then the triggers, then the fixtures; the ORDER is the
-- whole point of the numbering and `scripts/baseline.test.mjs` asserts it.

CREATE SCHEMA IF NOT EXISTS "extensions";

CREATE EXTENSION IF NOT EXISTS "citext" WITH SCHEMA "extensions";

CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";
