-- FOR THE RESTORE TEST ONLY (scripts/restore-test.sh), on a throwaway source built from the
-- baseline, the seed and the speed tidy-up's fixtures. Never run anywhere else.
--
-- Two jobs. First, rows awkward enough that "the data survived" means something: a quote, an
-- emoji, a newline, a tab, a backslash, a NULL in every nullable column, nested jsonb, bytea,
-- an array of high-precision numerics, an enum, an identity column (so a sequence has a position
-- to restore), and a foreign key into auth.users of its own. Second, the three things production
-- has that the 4 Nov baseline does not, so the restore meets them here before it meets them on a
-- Sunday: supabase_admin's default privileges in public, a realtime publication, and pg_cron jobs.

\set ON_ERROR_STOP 1

-- ── the probe ──────────────────────────────────────────────────────────────────────────────────
create table public.zz_restore_probe (
  gone text,
  id bigint generated always as identity primary key,
  note text not null check (length(note) > 0),
  made timestamptz not null,
  payload jsonb not null,
  blob bytea,
  amounts numeric(20, 8)[],
  tier public.visibility_tier,
  owner uuid references auth.users (id)
);
insert into public.zz_restore_probe (note, made, payload, blob, amounts, tier, owner) values
  (E'a line with a ⚠️, a ''quote'', a \\ backslash,\na newline and a\ttab', '2026-11-21 12:34:56.789+05:30',
   '{"a": [1, 2, {"b": null}], "ü": "ß"}', '\x00ff10', array[1.12345678, -99999999.99999999]::numeric(20, 8)[],
   'friends', '00000000-0000-4000-a000-000000000001'),
  ('nulls everywhere they are allowed', '1970-01-01 00:00:00+00', '[]', null, null, null, null),
  ('the far future', '9999-12-31 23:59:59.999999+00', '{"n": 1e300}', '', '{}', 'private',
   '00000000-0000-4000-a000-000000000004');

-- ⚠️ a column dropped BEFORE a commented one, as production's circuit_people has: a restore
-- renumbers the columns, and a manifest that named comments by number failed on exactly this
alter table public.zz_restore_probe drop column gone;
alter table public.zz_restore_probe enable row level security;
create policy zz_restore_probe_own on public.zz_restore_probe for select to authenticated
  using (owner = (select auth.uid()));
comment on table public.zz_restore_probe is 'the restore test''s probe';
comment on column public.zz_restore_probe.note is 'awkward on purpose';

-- two accounts beyond the seed's four, for the emails the bundle now carries: one with none (as a
-- phone sign-up has) and one an exact round trip has to work for — capitals, a plus, an apostrophe,
-- non-ASCII, and a backslash, which COPY's text format escapes on the way out and must unescape on
-- the way back in
insert into auth.users (id, email) values
  ('00000000-0000-4000-a000-000000000005', null),
  ('00000000-0000-4000-a000-000000000006', E'"Ada\\O''Neil"+Backup@Exämple.TEST');

-- grants that differ by role, down to a single column, so a restore that loses or widens one shows
revoke all on public.zz_restore_probe from public, anon, authenticated, service_role;
grant select on public.zz_restore_probe to authenticated;
grant select (id, note) on public.zz_restore_probe to anon;
grant all on public.zz_restore_probe to service_role;

-- a service-only SECURITY DEFINER function: anon and members must not be able to call it after a
-- restore any more than before one
create function public.zz_restore_probe_count() returns bigint
language sql security definer set search_path = '' as $$ select count(*) from public.zz_restore_probe $$;
revoke all on function public.zz_restore_probe_count() from public, anon, authenticated;
grant execute on function public.zz_restore_probe_count() to service_role;

-- ── what production has and the baseline does not ─────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    create role supabase_admin nologin;
  end if;
end $$;
-- Supabase's own default grants for objects supabase_admin creates in public (production has
-- these three; the dump carries them and a restore must leave them out)
alter default privileges for role supabase_admin in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema public grant all on functions to anon, authenticated, service_role;

create publication supabase_realtime for table public.zz_restore_probe, public.profiles;

-- the shape of pg_cron's job table, as far as extras.sql reads it
create table if not exists cron.job (
  jobid bigserial primary key,
  schedule text not null,
  command text not null,
  jobname text,
  active boolean not null default true
);
insert into cron.job (schedule, command, jobname, active) values
  ('17 4 * * *', E'delete from cron.job_run_details\n where end_time < now() - interval ''7 days''', 'cron-log-trim', true),
  -- unnamed, paused, and a command that ends in a newline: each one a field a careless round trip
  -- drops
  ('*/5 * * * *', E'select 1;\n', null, false);

-- a role named ONLY by a default-privilege line's FOR ROLE, and in no grant: a restore target
-- needs it all the same, and the first version's role list could not see it
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'zz_restore_owner') then
    create role zz_restore_owner nologin;
  end if;
end $$;
alter default privileges for role zz_restore_owner in schema public grant select on tables to authenticated;

-- and the two things a dump of public and finance leaves behind on Supabase's own tables: a policy
-- the app wrote there (production has eleven on realtime.messages, Realtime's channel
-- authorization), and a trigger there that calls into public
create schema if not exists realtime;
create table if not exists realtime.messages (
  id bigserial primary key,
  topic text not null,
  private boolean not null default true
);
alter table realtime.messages enable row level security;
create policy "members hear their own room" on realtime.messages for select to authenticated
  using (topic = 'room:' || (select auth.uid())::text and private);
-- and one unlike it in every way the capture has to spell out: restrictive, insert, two roles,
-- WITH CHECK and no USING
create policy "nobody sends to a public topic" on realtime.messages as restrictive for insert
  to anon, authenticated with check (private);
create function public.zz_restore_probe_noticed() returns trigger
language plpgsql as $$ begin return new; end $$;
create trigger zz_restore_probe_noticed after insert on auth.users
  for each row execute function public.zz_restore_probe_noticed();
