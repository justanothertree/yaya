-- ⛔ DRAFT — NOT APPLIED TO PRODUCTION. The Lab's catalog flags, votes and notes.
--
-- WHERE IT GOES: production applies this with `apply_migration` (name
-- `lab_catalog_and_feedback`), which assigns the timestamp. Then — in the same commit — the file
-- moves to `supabase/migrations/<that timestamp>_lab_catalog_and_feedback.sql` with its header
-- reworded to ✅ APPLIED, and its md5 line goes into `supabase/migrations/applied.md5`. It lives
-- in `supabase/drafts/` until then because `scripts/migration-md5.mjs` fails the build on any
-- file in `migrations/` production has no record of, which is the right rule. The release order
-- and the rollback are in docs/2026-11-07-lab-catalog-and-feedback.md.
--
-- WHAT IT ADDS, in the house pattern (CLAUDE.md §3): four tables with RLS ON, ZERO policies and
-- no grants to anon or authenticated — deny-all — reached only through SECURITY DEFINER functions
-- that check auth.uid() themselves. Nothing here is readable or writable by a table verb.
--
--   lab_demos            one row per experiment id: featured / experiment / hidden, set by the
--                        admin only. Never deleted — hiding is a flag, so ids, saved creations
--                        and feedback all survive it. Nothing ever hides a demo automatically.
--   lab_votes            one row per (account, demo): +1 or −1, changed in place, removed by
--                        deleting it. The primary key IS the one-vote rule, and a vote is written
--                        with INSERT … ON CONFLICT DO UPDATE, so two racing calls from one account
--                        end as one row. No counter is stored anywhere: totals are counted when
--                        asked, so there is nothing to drift under concurrency.
--   lab_comments         short plaintext notes — idea / more of this / bug — bounded in length,
--                        in lines and in rate. Edited and deleted by their author; removed (kept,
--                        hidden) by the admin.
--   lab_comment_reports  one private report per (note, reporter). Only the admin reads them, and
--                        even the admin is shown counts by reason, never who reported.
--
-- WHO SEES WHAT — the rules reused, not invented:
--   • A vote is never shown to anybody but its voter. There is no function that returns voters.
--   • The shared total counts only votes whose voter could show the room their activity anyway:
--     not suspended, and visibility_ceiling(voter) at 'members' or above — so an adult or the
--     admin. A minor's, or an unestablished age's, vote is kept and changeable like any other but
--     is NOT in the total another member sees, because their ceiling is Friends and a total is a
--     (thin) picture of what they did. The admin sees how many votes were kept out, as a number.
--   • Totals are for signed-in members. A guest gets the owner's flags and nothing counted.
--   • A note is read through can_see(author, 'members') — the profile ladder, so a minor's note
--     reaches their friends and no other member — plus its author, plus the admin, because a
--     note is feedback addressed to the site's owner the way a bug report is. The panel says so
--     before anybody writes one. docs/OPEN-DECISIONS.md §13 records that call.
--   • A suspended member writes nothing (votes, notes, reports), and their notes stop reaching
--     other members; their own and the admin's view are unchanged.
--   • There is no member-to-member block on this site (friendships are pending/accepted only),
--     so there is nothing further to consult; §13 says that rather than inventing one here.

create table public.lab_demos (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  featured boolean not null default false,
  experiment boolean not null default false,
  hidden boolean not null default false,
  changed_at timestamptz not null default now(),
  changed_by uuid references auth.users (id) on delete set null
);

create table public.lab_votes (
  user_id uuid not null references auth.users (id) on delete cascade,
  demo_id text not null references public.lab_demos (id),
  value smallint not null check (value in (-1, 1)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, demo_id)
);
create index lab_votes_by_demo on public.lab_votes (demo_id);

create table public.lab_comments (
  id uuid primary key default gen_random_uuid(),
  demo_id text not null references public.lab_demos (id),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('idea', 'more', 'bug')),
  body text not null,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  removed_at timestamptz,
  removed_by uuid references auth.users (id) on delete set null,
  -- the same bounds the functions apply, held by the table so no path can skip them
  constraint lab_comments_length check (char_length(body) between 2 and 500),
  constraint lab_comments_trimmed check (body ~ '^\S' and body ~ '\S$'),
  -- plaintext: a newline is the only control character, and at most eight of them
  constraint lab_comments_plain check (body !~ '[\x01-\x09\x0b-\x1f\x7f]'),
  constraint lab_comments_lines check (char_length(body) - char_length(replace(body, E'\n', '')) <= 8)
);
create index lab_comments_page on public.lab_comments (demo_id, created_at desc, id desc);
create index lab_comments_by_author on public.lab_comments (user_id, created_at desc);

create table public.lab_comment_reports (
  comment_id uuid not null references public.lab_comments (id) on delete cascade,
  reporter uuid not null references auth.users (id) on delete cascade,
  reason text not null check (reason in ('spam', 'unkind', 'unsafe', 'other')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution text check (resolution in ('removed', 'kept')),
  primary key (comment_id, reporter),
  constraint lab_reports_resolved check ((resolved_at is null) = (resolution is null))
);
create index lab_reports_open on public.lab_comment_reports (comment_id) where resolved_at is null;
create index lab_reports_by_reporter on public.lab_comment_reports (reporter, created_at desc);

alter table public.lab_demos enable row level security;
alter table public.lab_votes enable row level security;
alter table public.lab_comments enable row level security;
alter table public.lab_comment_reports enable row level security;

-- ⚠️ EXPLICIT, BECAUSE THE SCHEMA'S DEFAULT ACL GRANTS EVERYTHING (CLAUDE.md §3): RLS with no
-- policy refuses rows, but not TRUNCATE, and a grant nobody can use is one somebody must reason
-- about at every review. service_role keeps its access, as on every other table here.
revoke all on table public.lab_demos, public.lab_votes, public.lab_comments,
  public.lab_comment_reports from public, anon, authenticated;
grant all on table public.lab_demos, public.lab_votes, public.lab_comments,
  public.lab_comment_reports to service_role;

-- every experiment in the Lab on 7 Nov 2026, in the order they were added. A later toy is
-- registered by the admin's own catalog (admin_lab_register); src/lab/catalog.test.ts holds this
-- list to the DEMOS registry so neither can drift without a red test.
insert into public.lab_demos (id) values
  ('swarm'), ('life'), ('fluid'), ('music'), ('kaleido'), ('lava'), ('galaxy'), ('marble'),
  ('growth'), ('aquarium'), ('tunnel'), ('cloth'), ('ribbons'), ('fractal'), ('light'), ('harp'),
  ('neon'), ('sand'), ('pond'), ('slime'), ('mirror'), ('bubbles'), ('clay'), ('fireflies'),
  ('blackhole'), ('erosion'), ('snowflake'), ('pixelsort'), ('squish'), ('lightning'),
  ('voiceprint'), ('marbles'), ('glass'), ('harmonograph'), ('rain'), ('loom'), ('ferro'),
  ('trials'), ('waterworks'), ('studio'), ('critters'), ('strut'), ('gust'), ('seedling'),
  ('mobius'), ('pinball'), ('crossing'), ('shadowbox'), ('fold'), ('topple'), ('printshop')
on conflict (id) do nothing;

/* ------------------------------------------------------------------ the rules, in one place */

-- Does this voter's vote go into the total other members see. Not a privacy check on any one
-- row — no row is ever shown — but a statement about whose activity a shared number may carry.
create or replace function public.lab_vote_counts(p_voter uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles p
    where p.user_id = p_voter and not coalesce(p.suspended, false)
  ) and public.visibility_ceiling(p_voter) >= 'members'::public.visibility_tier;
$$;

-- May the caller read this note. Its author, the admin (a note is feedback addressed to the
-- site's owner), and otherwise the profile ladder at 'members' — clamped to the author's own
-- ceiling inside can_see, so a minor's note reaches their friends only. A removed note reaches
-- its author and the admin; a suspended author's notes stop reaching anybody else.
create or replace function public.lab_can_read_comment(p_author uuid, p_removed boolean)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select case
    when auth.uid() is null then false
    when p_author = auth.uid() then true
    when public.is_admin() then true
    when p_removed then false
    when coalesce((select suspended from public.profiles where user_id = p_author), true) then false
    else public.can_see(p_author, 'members'::public.visibility_tier)
  end;
$$;

create or replace function public.lab_demo_open(p_demo text)
returns void
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.lab_demos d
    where d.id = p_demo and (not d.hidden or public.is_admin())
  ) then
    raise exception 'no such experiment' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.lab_comment_json(c public.lab_comments)
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', c.id,
    'demo', c.demo_id,
    'kind', c.kind,
    -- no condition needed: lab_can_read_comment hands a removed note to its author and the
    -- admin only, and both may read what it said
    'body', c.body,
    'author', (select username::text from public.profiles where user_id = c.user_id),
    'mine', c.user_id = auth.uid(),
    'at', c.created_at,
    'edited', c.edited_at,
    'removed', c.removed_at is not null
  );
$$;

/* ------------------------------------------------------------------ the catalog */

-- The owner's flags for every experiment, and — for a signed-in member — the vote totals and
-- the caller's own vote. Callable by guests, who get the flags and nothing counted. Hidden
-- experiments are listed only to the admin. The admin also gets how many votes were kept out of
-- the totals, how many notes of each kind, and how many reports are open.
create or replace function public.lab_catalog()
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  admin boolean := public.is_admin();
  member boolean := me is not null
    and exists (select 1 from public.profiles where user_id = me and not coalesce(suspended, false));
begin
  return coalesce((
    select jsonb_agg(q.r order by q.r ->> 'id')
    from (
      select jsonb_strip_nulls(jsonb_build_object(
        'id', d.id,
        'featured', d.featured,
        'experiment', d.experiment,
        'hidden', d.hidden,
        'up', case when member then (select count(*) from public.lab_votes v
                                      where v.demo_id = d.id and v.value = 1
                                        and public.lab_vote_counts(v.user_id)) end,
        'down', case when member then (select count(*) from public.lab_votes v
                                        where v.demo_id = d.id and v.value = -1
                                          and public.lab_vote_counts(v.user_id)) end,
        'mine', case when me is not null then (select v.value from public.lab_votes v
                                               where v.demo_id = d.id and v.user_id = me) end,
        'withheld', case when admin then (select count(*) from public.lab_votes v
                                          where v.demo_id = d.id
                                            and not public.lab_vote_counts(v.user_id)) end,
        'notes', case when admin then (
          select jsonb_build_object(
            'idea', count(*) filter (where c.kind = 'idea'),
            'more', count(*) filter (where c.kind = 'more'),
            'bug', count(*) filter (where c.kind = 'bug'))
          from public.lab_comments c where c.demo_id = d.id and c.removed_at is null) end,
        'reports', case when admin then (
          select count(distinct r.comment_id) from public.lab_comment_reports r
          join public.lab_comments c on c.id = r.comment_id
          where c.demo_id = d.id and r.resolved_at is null) end
      )) as r
      from public.lab_demos d
      where not d.hidden or admin
    ) q
  ), '[]'::jsonb);
end;
$$;

/* ------------------------------------------------------------------ votes */

-- p_value 1 or -1 sets the caller's vote, 0 removes it. Answers with the experiment's totals as
-- the caller is allowed to see them, so the button can show the result of its own press.
create or replace function public.lab_vote(p_demo text, p_value int)
returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'sign in first' using errcode = '28000';
  end if;
  if public.is_suspended(me) then
    raise exception 'this account cannot post' using errcode = '42501';
  end if;
  perform public.lab_demo_open(p_demo);
  if (select hidden from public.lab_demos where id = p_demo) then
    raise exception 'this experiment is retired' using errcode = '42501';
  end if;
  if p_value is null or p_value not in (-1, 0, 1) then
    raise exception 'a vote is 1, -1 or 0' using errcode = '22023';
  end if;
  if p_value = 0 then
    delete from public.lab_votes where user_id = me and demo_id = p_demo;
  else
    insert into public.lab_votes (user_id, demo_id, value)
    values (me, p_demo, p_value)
    on conflict (user_id, demo_id)
      do update set value = excluded.value, updated_at = now()
      where public.lab_votes.value is distinct from excluded.value;
  end if;
  return jsonb_build_object(
    'id', p_demo,
    'up', (select count(*) from public.lab_votes v
           where v.demo_id = p_demo and v.value = 1 and public.lab_vote_counts(v.user_id)),
    'down', (select count(*) from public.lab_votes v
             where v.demo_id = p_demo and v.value = -1 and public.lab_vote_counts(v.user_id)),
    'mine', nullif(p_value, 0)
  );
end;
$$;

/* ------------------------------------------------------------------ notes */

-- A page of the notes on one experiment that the caller may read, newest first. Keyset paged:
-- pass the last item's `at` and `id` to get the next page. At most 30 a page.
create or replace function public.lab_comments_page(
  p_demo text,
  p_before timestamptz default null,
  p_before_id uuid default null,
  p_limit int default 20
)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  n int := least(greatest(coalesce(p_limit, 20), 1), 30);
  items jsonb;
begin
  if auth.uid() is null then
    raise exception 'sign in first' using errcode = '28000';
  end if;
  perform public.lab_demo_open(p_demo);
  select coalesce(jsonb_agg(public.lab_comment_json(c) order by c.created_at desc, c.id desc), '[]')
    into items
  from (
    select c.* from public.lab_comments c
    where c.demo_id = p_demo
      and (p_before is null
           or (c.created_at, c.id) < (p_before, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
      and public.lab_can_read_comment(c.user_id, c.removed_at is not null)
    order by c.created_at desc, c.id desc
    limit n + 1
  ) c;
  return jsonb_build_object(
    'items', (select coalesce(jsonb_agg(e order by o), '[]') from jsonb_array_elements(items) with ordinality t(e, o) where o <= n),
    'more', jsonb_array_length(items) > n
  );
end;
$$;

-- what a note's text becomes before it is checked: CRLF to LF, the ends trimmed
create or replace function public.lab_clean_body(p_body text)
returns text
language sql immutable
set search_path = public, pg_temp
as $$
  select btrim(replace(replace(coalesce(p_body, ''), E'\r\n', E'\n'), E'\r', E'\n'), E' \n\t');
$$;

create or replace function public.lab_comment_add(p_demo text, p_kind text, p_body text)
returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  v_body text := public.lab_clean_body(p_body);
  c public.lab_comments;
begin
  if me is null then
    raise exception 'sign in first' using errcode = '28000';
  end if;
  if public.is_suspended(me) then
    raise exception 'this account cannot post' using errcode = '42501';
  end if;
  perform public.lab_demo_open(p_demo);
  if (select hidden from public.lab_demos where id = p_demo) then
    raise exception 'this experiment is retired' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('idea', 'more', 'bug') then
    raise exception 'a note is an idea, a more, or a bug' using errcode = '22023';
  end if;
  -- ⚠️ THE LIMITS ARE COUNTED HERE, WHERE THEY CANNOT BE SKIPPED: the panel's own checks are a
  -- courtesy. Serialised per author by the advisory lock, so two racing posts cannot both see
  -- four and both make a sixth.
  perform pg_advisory_xact_lock(hashtextextended('lab_comment:' || me::text, 0));
  if (select count(*) from public.lab_comments
       where user_id = me and created_at > now() - interval '10 minutes') >= 5 then
    raise exception 'slow down: five notes in ten minutes is the most' using errcode = '54000';
  end if;
  if (select count(*) from public.lab_comments
       where user_id = me and created_at > now() - interval '1 day') >= 20 then
    raise exception 'twenty notes a day is the most' using errcode = '54000';
  end if;
  if exists (select 1 from public.lab_comments
              where user_id = me and demo_id = p_demo and body = v_body
                and created_at > now() - interval '1 day') then
    raise exception 'you already left that note' using errcode = '23505';
  end if;
  insert into public.lab_comments (demo_id, user_id, kind, body)
  values (p_demo, me, p_kind, v_body)
  returning * into c;
  return public.lab_comment_json(c);
end;
$$;

create or replace function public.lab_comment_edit(p_id uuid, p_body text, p_kind text default null)
returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  c public.lab_comments;
begin
  if me is null then
    raise exception 'sign in first' using errcode = '28000';
  end if;
  if public.is_suspended(me) then
    raise exception 'this account cannot post' using errcode = '42501';
  end if;
  if p_kind is not null and p_kind not in ('idea', 'more', 'bug') then
    raise exception 'a note is an idea, a more, or a bug' using errcode = '22023';
  end if;
  -- null means "not changing it", never "clear it" (CLAUDE.md §8)
  update public.lab_comments
     set body = case when p_body is null then body else public.lab_clean_body(p_body) end,
         kind = coalesce(p_kind, kind),
         edited_at = now()
   where id = p_id and user_id = me and removed_at is null
  returning * into c;
  if c.id is null then
    raise exception 'no such note of yours' using errcode = 'P0002';
  end if;
  return public.lab_comment_json(c);
end;
$$;

-- The author takes their note back. The row goes, and any report on it with it: what they
-- withdrew is not kept as evidence (OPEN-DECISIONS §13).
create or replace function public.lab_comment_delete(p_id uuid)
returns boolean
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'sign in first' using errcode = '28000';
  end if;
  delete from public.lab_comments where id = p_id and user_id = me;
  if not found then
    raise exception 'no such note of yours' using errcode = 'P0002';
  end if;
  return true;
end;
$$;

-- Report a note to the admin, privately. Answers 'reported' or 'already'.
create or replace function public.lab_comment_report(p_id uuid, p_reason text)
returns text
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  c public.lab_comments;
begin
  if me is null then
    raise exception 'sign in first' using errcode = '28000';
  end if;
  if public.is_suspended(me) then
    raise exception 'this account cannot post' using errcode = '42501';
  end if;
  if p_reason is null or p_reason not in ('spam', 'unkind', 'unsafe', 'other') then
    raise exception 'a report says spam, unkind, unsafe or other' using errcode = '22023';
  end if;
  select * into c from public.lab_comments where id = p_id;
  -- one answer for "no such note" and "a note you cannot see", so a report is no probe
  if c.id is null or c.removed_at is not null
     or not public.lab_can_read_comment(c.user_id, false) then
    raise exception 'no such note' using errcode = 'P0002';
  end if;
  if c.user_id = me then
    raise exception 'that note is yours: edit or delete it' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('lab_report:' || me::text, 0));
  if (select count(*) from public.lab_comment_reports
       where reporter = me and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'ten reports an hour is the most' using errcode = '54000';
  end if;
  insert into public.lab_comment_reports (comment_id, reporter, reason)
  values (p_id, me, p_reason)
  on conflict (comment_id, reporter) do nothing;
  return case when found then 'reported' else 'already' end;
end;
$$;

/* ------------------------------------------------------------------ the owner's controls */

-- Feature, mark as an experiment, hide or restore. A null leaves that flag as it is.
create or replace function public.admin_lab_set_demo(
  p_demo text,
  p_featured boolean default null,
  p_experiment boolean default null,
  p_hidden boolean default null
)
returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  d public.lab_demos;
begin
  if not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.lab_demos
     set featured = coalesce(p_featured, featured),
         experiment = coalesce(p_experiment, experiment),
         hidden = coalesce(p_hidden, hidden),
         changed_at = now(),
         changed_by = me
   where id = p_demo
  returning * into d;
  if d.id is null then
    raise exception 'no such experiment' using errcode = 'P0002';
  end if;
  return jsonb_build_object('id', d.id, 'featured', d.featured,
                            'experiment', d.experiment, 'hidden', d.hidden);
end;
$$;

-- Register experiments the database has not met yet — a toy added after this migration. Called
-- by the admin's own Lab with the ids it ships; returns how many were new.
create or replace function public.admin_lab_register(p_ids text[])
returns int
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  n int;
begin
  if not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_ids is null or cardinality(p_ids) > 200 then
    raise exception 'between none and two hundred ids' using errcode = '22023';
  end if;
  insert into public.lab_demos (id)
  select distinct unnest(p_ids)
  on conflict (id) do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- The open reports, one entry per note, with how many reports of each reason. Never who.
create or replace function public.admin_lab_reports()
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(e order by e ->> 'first' desc)
    from (
      select public.lab_comment_json(c)
             || jsonb_build_object(
                  'first', min(r.created_at),
                  'reasons', (select jsonb_object_agg(x.reason, x.n) from (
                                select r2.reason, count(*) as n from public.lab_comment_reports r2
                                where r2.comment_id = c.id and r2.resolved_at is null
                                group by r2.reason) x)
                ) as e
      from public.lab_comment_reports r
      join public.lab_comments c on c.id = r.comment_id
      where r.resolved_at is null
      group by c.id
      order by min(r.created_at) desc
      limit 100
    ) q
  ), '[]'::jsonb);
end;
$$;

-- remove: hide the note from everyone but its author and the admin, and close its reports as
-- 'removed'. restore: undo a remove. keep: close its reports as 'kept' and leave it up.
create or replace function public.admin_lab_moderate(p_id uuid, p_action text)
returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  c public.lab_comments;
begin
  if not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_action is null or p_action not in ('remove', 'restore', 'keep') then
    raise exception 'remove, restore or keep' using errcode = '22023';
  end if;
  update public.lab_comments
     set removed_at = case p_action when 'remove' then coalesce(removed_at, now())
                                    when 'restore' then null else removed_at end,
         removed_by = case p_action when 'remove' then coalesce(removed_by, me)
                                    when 'restore' then null else removed_by end
   where id = p_id
  returning * into c;
  if c.id is null then
    raise exception 'no such note' using errcode = 'P0002';
  end if;
  if p_action in ('remove', 'keep') then
    update public.lab_comment_reports
       set resolved_at = now(),
           resolution = case p_action when 'remove' then 'removed' else 'kept' end
     where comment_id = p_id and resolved_at is null;
  end if;
  return public.lab_comment_json(c);
end;
$$;

/* ------------------------------------------------------------------ who may call what */

-- ⚠️ `revoke … from public` DOES NOT COVER anon HERE (CLAUDE.md §3): anon holds execute directly
-- through the default ACL, so every function is revoked from both by name, then granted back to
-- exactly the roles that use it. The helpers are granted to nobody: they run inside the functions
-- that call them, as the definer.
revoke all on function
  public.lab_vote_counts(uuid), public.lab_can_read_comment(uuid, boolean),
  public.lab_demo_open(text), public.lab_comment_json(public.lab_comments),
  public.lab_clean_body(text),
  public.lab_catalog(), public.lab_vote(text, int),
  public.lab_comments_page(text, timestamptz, uuid, int),
  public.lab_comment_add(text, text, text), public.lab_comment_edit(uuid, text, text),
  public.lab_comment_delete(uuid), public.lab_comment_report(uuid, text),
  public.admin_lab_set_demo(text, boolean, boolean, boolean), public.admin_lab_register(text[]),
  public.admin_lab_reports(), public.admin_lab_moderate(uuid, text)
from public, anon, authenticated;

-- the catalog's flags are the one thing a guest is shown
grant execute on function public.lab_catalog() to anon, authenticated;
grant execute on function
  public.lab_vote(text, int),
  public.lab_comments_page(text, timestamptz, uuid, int),
  public.lab_comment_add(text, text, text), public.lab_comment_edit(uuid, text, text),
  public.lab_comment_delete(uuid), public.lab_comment_report(uuid, text),
  -- the admin functions refuse everybody else on their first line, and are granted to
  -- `authenticated` only because the admin signs in as one
  public.admin_lab_set_demo(text, boolean, boolean, boolean), public.admin_lab_register(text[]),
  public.admin_lab_reports(), public.admin_lab_moderate(uuid, text)
to authenticated;
