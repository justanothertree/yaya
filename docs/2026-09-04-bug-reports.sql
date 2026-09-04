-- Bug reports: somebody tells me something is broken, from wherever it broke.
--
-- Run this in the Supabase SQL editor. It creates one table and locks it down.
--
-- WHAT IT STORES
--   the text they wrote, the page they were on, the window size, which browser, who and when.
--   Nothing else. The client shows the reporter that exact list before it sends.
--
-- WHO CAN DO WHAT
--   · a signed-in person may INSERT, and only as themselves
--   · nobody may SELECT except an admin — not even the person who wrote it
--   · nobody may UPDATE or DELETE except an admin
--
--   ⚠️ Read is admin-only ON PURPOSE, and it is worth being explicit about why, because
--   "let people see their own reports" is the obvious next thought. A bug report is prose
--   somebody typed while annoyed; it can name other people, quote a private page, or paste
--   something they would not have written on a public wall. The safest shape for a one-way
--   channel is one way.

create table if not exists public.bug_report (
  id uuid primary key default gen_random_uuid(),
  reporter uuid not null references auth.users (id) on delete cascade,
  body text not null,
  route text,
  viewport text,
  browser text,
  created_at timestamptz not null default now(),
  handled boolean not null default false,

  -- ⚠️ Bounds in the DATABASE, not only in the form. The client caps these too, but the client
  -- is a suggestion: anyone can post to PostgREST directly with whatever they like, and an
  -- unbounded text column is a free place to store somebody else's data on my bill.
  constraint bug_report_body_len check (char_length(body) between 4 and 2000),
  constraint bug_report_route_len check (route is null or char_length(route) <= 80),
  constraint bug_report_viewport_len check (viewport is null or char_length(viewport) <= 20),
  constraint bug_report_browser_len check (browser is null or char_length(browser) <= 20)
);

alter table public.bug_report enable row level security;

-- insert, as yourself only
drop policy if exists "report a bug" on public.bug_report;
create policy "report a bug" on public.bug_report
  for insert to authenticated
  with check (reporter = auth.uid());

-- read and manage: admin only
drop policy if exists "admins read reports" on public.bug_report;
create policy "admins read reports" on public.bug_report
  for select to authenticated
  using (public.is_admin());

drop policy if exists "admins manage reports" on public.bug_report;
create policy "admins manage reports" on public.bug_report
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "admins clear reports" on public.bug_report;
create policy "admins clear reports" on public.bug_report
  for delete to authenticated
  using (public.is_admin());

-- ⚠️ `reporter` is filled by the DATABASE, not by the client. Without this the client would have
-- to send its own user id, and a policy that checks a value the client supplies is only as good
-- as the client's honesty about it. Defaulting it here means the insert cannot even express
-- "from somebody else".
alter table public.bug_report alter column reporter set default auth.uid();

-- explicit grants: the anon role gets nothing at all
revoke all on table public.bug_report from anon, public;
grant insert, select on table public.bug_report to authenticated;

-- newest first, and the unhandled ones are what I actually read
create index if not exists bug_report_open_idx
  on public.bug_report (created_at desc)
  where not handled;

-- ⚠️ A rate limit, because "anyone signed in may insert" plus a free-text column is a spam
-- surface. Ten an hour is far more than a person reporting real bugs will ever need and far
-- less than is useful to somebody filling a table.
create or replace function public.bug_report_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recent int;
begin
  select count(*) into recent
    from public.bug_report
   where reporter = auth.uid()
     and created_at > now() - interval '1 hour';
  if recent >= 10 then
    raise exception 'too many reports in the last hour';
  end if;
  return new;
end;
$$;

drop trigger if exists bug_report_rate_limit_t on public.bug_report;
create trigger bug_report_rate_limit_t
  before insert on public.bug_report
  for each row execute function public.bug_report_rate_limit();
