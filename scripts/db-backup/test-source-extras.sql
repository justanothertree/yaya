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

alter table public.zz_restore_probe enable row level security;
create policy zz_restore_probe_own on public.zz_restore_probe for select to authenticated
  using (owner = (select auth.uid()));
comment on table public.zz_restore_probe is 'the restore test''s probe';
comment on column public.zz_restore_probe.note is 'awkward on purpose';

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
insert into cron.job (schedule, command, jobname) values
  ('17 4 * * *', E'delete from cron.job_run_details\n where end_time < now() - interval ''7 days''', 'cron-log-trim');
