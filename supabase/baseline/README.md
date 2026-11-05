# The dump is not the schema

`../migrations/00000000000000_baseline.sql` is a schema-only dump of production, kept exactly
as the dump tool produced it. **It cannot build this schema on its own**, and the three files
here are the difference. `[db.seed] sql_paths` in `../config.toml` applies all four, in this order:

| file                                        | what it adds                                                   | why it is not in the dump                                                                                                                                          |
| ------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `00-privileges.sql`                         | revokes the schema's default privileges from the API roles     | pg_dump describes an ACL by what it HOLDS; a privilege production revoked leaves nothing to dump, so a restore keeps the local default and ends up more permissive |
| `01-extensions.sql`                         | `citext`, `pgcrypto`                                           | `db dump --schema public,finance` emits no `create extension`: an extension belongs to the database rather than to either schema                                   |
| `../migrations/00000000000000_baseline.sql` | tables, functions, policies, RLS, constraints, indexes, grants | —                                                                                                                                                                  |
| `02-triggers.sql`                           | the 24 triggers                                                | the dump that exists was filtered on the way out and dropped them; see below                                                                                       |
| `../seed.sql`                               | the fixtures the guards need                                   | not schema                                                                                                                                                         |

Each file's own header has the reasoning and the measurement behind it.
`../../scripts/baseline.test.mjs` asserts they still fit together, and runs on `npm run test`.

## Regenerating

⚠️ **A dump command is step one of four.** Running it replaces the dump and nothing else: a
regenerated dump has no `create extension`, no privilege revokes, and — if it is produced the
way this one was — no triggers.
The files here are what make that survivable: they are applied around the dump, not inside it, so
a regeneration cannot silently delete them.

1. **Dump the schema** over the same file:

   ```bash
   supabase db dump --linked --schema public,finance -f supabase/migrations/00000000000000_baseline.sql
   ```

   ⚠️ **The command lives here because the dump has no header to keep it in.** It had three
   comment lines on top until 4 Nov 2026 and they were removed, correctly — they claimed the file
   was the whole schema. A regeneration overwrites the file anyway, so a command stored inside it
   is a command that survives exactly until it is next needed.

   ⚠️ **AND THE FILE THAT IS HERE WAS NOT MADE WITH THAT COMMAND.** It came from a hand-rolled
   `pg_dump` pipeline on a machine with no Docker, and that pipeline's filtering is what dropped
   the triggers. Read against the CLI's own script, the tool does NOT drop them: it runs
   `pg_dump --schema-only --quote-all-identifier --role postgres` and then rewrites
   `CREATE TRIGGER "` to `CREATE OR REPLACE TRIGGER "` — which is also why this file's statements
   are quoted the way they are, and why a CLI dump makes `02-triggers.sql` a harmless no-op
   rather than a conflict. **So a fresh dump with no `CREATE TRIGGER` in it means the pipeline,
   never the database.**

2. **Count it against production, by object kind.** This is the check that would have caught the
   missing triggers on the day the dump was made — every other kind matched exactly, which is why
   nothing looked wrong:

   ```sql
   select 'tables' k, count(*) n from pg_class c join pg_namespace n2 on n2.oid = c.relnamespace
     where c.relkind = 'r' and n2.nspname in ('public','finance')
   union all select 'functions', count(*) from pg_proc p join pg_namespace n2 on n2.oid = p.pronamespace
     where n2.nspname in ('public','finance') and p.prokind = 'f'
   union all select 'policies', count(*) from pg_policies where schemaname in ('public','finance')
   union all select 'triggers', count(*) from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
     join pg_namespace n2 on n2.oid = c.relnamespace
     where not tg.tgisinternal and n2.nspname in ('public','finance')
   union all select 'views', count(*) from pg_class c join pg_namespace n2 on n2.oid = c.relnamespace
     where c.relkind = 'v' and n2.nspname in ('public','finance');
   ```

   On 4 Nov 2026 production answered tables 62, functions 271, policies 88, triggers 24, views 1,
   and the dump contained 62, 271, 88, **0**, 1.

3. **Re-run the query in `02-triggers.sql`'s header** and replace its statements with what comes
   back. This is the step that rots on its own: a trigger added to production after 4 Nov 2026 is
   in neither the dump nor this file, and nothing in CI will say so. The file's statements are
   `create or replace trigger`, so they are harmless if a future dump does carry triggers.
4. **Re-check `01-extensions.sql`** if the dump gained a new `extensions.*` reference that is
   resolved at DDL time — a column type, a DEFAULT, an index expression. `baseline.test.mjs`
   fails with the name of anything it does not provide, so running `npm run test` answers this
   rather than reading for it.

`00-privileges.sql` needs nothing on a regeneration: it is about the database the restore lands
in, not about the dump.

## What a naive regeneration costs

Less than it used to, which is the whole point of the split. Overwrite the dump and forget this
file, and the schema is still built with its extensions, its privileges and its 4 Nov triggers —
`db reset` still works and the guards still run. What you lose is anything added to production
since: a new trigger, or a new DDL-time dependency on an extension this directory does not
create. The second of those fails loudly in `npm run test`. The first does not fail at all, which
is why it is step 3 above and not a footnote.
