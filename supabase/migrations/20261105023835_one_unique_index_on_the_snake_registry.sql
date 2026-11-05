-- ✅ APPLIED 5 Nov 2026 as `one_unique_index_on_the_snake_registry`.
--
-- Supabase's performance advisor, `duplicate_index`: "Table `public.player_registry` has
-- identical indexes {player_registry_player_name_key, ux_player_registry_name_ci}." Both were
-- `CREATE UNIQUE INDEX ... USING btree (player_name)` on the same column of the same table, so
-- one of them was two write amplifications and ~a page of storage for nothing.
--
-- ⚠️ WHICH ONE GOES IS NOT A TOSS-UP. `player_registry_player_name_key` is the index behind the
-- UNIQUE CONSTRAINT of the same name, and `profiles.username` has a foreign key to
-- `player_registry.player_name` -- a FK needs a unique constraint on the referenced column, so
-- that one cannot leave without taking `profiles_username_fkey` with it. Postgres would refuse
-- the drop anyway ("cannot drop index ... because constraint ... requires it"), which is the
-- reassuring half; the assertions below are the other half.
--
-- ⚠️ AND THE CASE-INSENSITIVITY IS NOT THE INDEX'S, WHICH IS WORTH SAYING BECAUSE A DOC HERE
-- IMPLIES IT IS. `docs/2026-08-26-one-players-name-discarded-everyones-round.sql` says
-- "`player_registry.player_name` carries a CASE-INSENSITIVE collation -- that is what the index
-- `ux_player_registry_name_ci` is for". The sentence is right about the column and loose about
-- the reason: the column's TYPE is `extensions.citext`, and every btree on it compares
-- case-insensitively, including the constraint's. That day's bug was a temp table's collation
-- rather than an index, and nothing in its fix referenced this index by name.
--
-- Measured either side rather than reasoned about:
--
--   indexes on (player_name)                                     2 -> 1
--   a registered name asked for in upper case still matches       1 row -> 1 row
--   scans before the drop   player_registry_player_name_key 161   ux_player_registry_name_ci 347
--
-- The second line is the one that matters: the 347 scans the dropped index was serving are
-- lookups the remaining one answers identically, because the two were identical.
--
-- ⚠️ CI STILL HAS IT. `migrations/00000000000000_baseline.sql` is a dump taken on 4 Nov and the
-- migrations are deliberately not replayed on top of it (see `[db.migrations]` in config.toml),
-- so the throwaway database db-guards builds carries the duplicate until that dump is
-- regenerated. Harmless -- nothing the guards ask is about an index -- and named here because it
-- is the first instance of the drift that arrangement accepts.

drop index if exists public.ux_player_registry_name_ci;

do $$
begin
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public' and c.relname = 'ux_player_registry_name_ci') then
    raise exception 'the duplicate index is still here';
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'player_registry_player_name_key' and contype = 'u') then
    raise exception 'the unique constraint went instead, and a foreign key needs it';
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'profiles_username_fkey' and contype = 'f') then
    raise exception 'profiles_username_fkey is gone';
  end if;
end $$;
