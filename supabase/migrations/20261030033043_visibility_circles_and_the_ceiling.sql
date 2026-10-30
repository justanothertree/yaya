-- ✅ APPLIED 30 Oct 2026 as `visibility_circles_and_the_ceiling`.
--
-- Phase 1 of docs/2026-10-30-one-visibility-ladder-plan.md: the structures and the rules, with
-- **nothing calling them**. Proved: no function in `public` references `visibility_ceiling`,
-- `clamp_visibility`, `may_publish_a_page` or either circle table, and the member-to-member
-- matrix is unchanged — 14/14 activity hashes and 14/14 trophy hashes identical, 813 events.
--
-- ⚠️ DENY-ALL, AND THE REVOKE IS NOT OPTIONAL. CLAUDE.md §3: `pg_default_acl` on `public` hands
-- `arwdDxtm` to anon AND authenticated on every new table, so deny-all is something a table has
-- to be GIVEN. Both tables are RLS-on / zero-policies / zero-grants, and it was checked per
-- privilege rather than per table — including TRUNCATE, which has no policy type and which RLS
-- therefore never covers. All false for both roles on both tables.
--
-- ⚠️ "ONLY EVAN MAY CHOOSE PUBLIC" IS EXPRESSED AS DATA, NOT AS A NAME. The ceiling asks
-- `admin_users`, which today holds exactly one row and that row is his. A username literal would
-- be a second place the answer lives, and the first one to go stale.
--
-- ⚠️ UNKNOWN AGE IS CAPPED LIKE A MINOR, and the consequence is worth stating plainly: **13 of
-- the 14 members sit at a `friends` ceiling today**, because nobody's age has been established
-- yet. That is correct — a cap that assumes adulthood protects nobody — but it means Phase 2
-- (applying the ceiling on READ) must NOT run before the adult/minor list arrives, or it will
-- narrow almost everybody rather than the three rows §3 of the plan predicts. The plan says so
-- now; this note is here because the function is where somebody will be standing when it bites.
--
-- ⚠️ `may_publish_a_page` IS A SECOND FUNCTION AND MUST STAY ONE. Publishing a page and choosing
-- a level are two switches that are ALLOWED TO DISAGREE — which is exactly why three of Josh's
-- blocks are marked `public` on a page no stranger can load. Folding this into
-- `visibility_ceiling` would read as tidying up and would re-create that bug the next time
-- somebody simplifies two near-identical checks. Today it is admin-only; later it becomes any
-- established adult, never a minor, and that is one line in one place.
--
-- ⚠️ CIRCLE MEMBERSHIP IS A LIST, NEVER A GRANT. A row in `visibility_circle_members` says the
-- owner put somebody in a circle; it does not say they are still a friend. Friendship can end
-- after the circle is written, so every read against a circle must AND it with `are_friends` at
-- read time. The table comment says so where somebody writing that query will see it.

create table if not exists public.visibility_circles (
  id         uuid primary key default gen_random_uuid(),
  owner      uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now(),
  constraint visibility_circles_name_ok check (btrim(name) <> '' and length(btrim(name)) <= 40),
  constraint visibility_circles_owner_name unique (owner, name)
);

create table if not exists public.visibility_circle_members (
  circle_id uuid not null references public.visibility_circles(id) on delete cascade,
  member    uuid not null references auth.users(id) on delete cascade,
  added_at  timestamptz not null default now(),
  primary key (circle_id, member)
);

create index if not exists visibility_circles_owner_idx on public.visibility_circles (owner);
create index if not exists visibility_circle_members_member_idx on public.visibility_circle_members (member);

alter table public.visibility_circles        enable row level security;
alter table public.visibility_circle_members enable row level security;

revoke all on public.visibility_circles        from public, anon, authenticated;
revoke all on public.visibility_circle_members from public, anon, authenticated;

comment on table public.visibility_circles is
  'A named set of friends, reusable across items (the "Certain friends" level). Deny-all: RLS on, zero policies, no grants -- reached only through SECURITY DEFINER RPCs, which do not exist yet. Phase 1 of docs/2026-10-30-one-visibility-ladder-plan.md.';
comment on table public.visibility_circle_members is
  'Who is in a circle. A member here must also be an accepted friend of the circle owner at READ time -- membership is a convenience list, never a grant on its own.';

create or replace function public.visibility_ceiling(p_owner uuid)
returns public.visibility_tier
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  select case
    when p_owner is null then 'private'::public.visibility_tier
    when exists (select 1 from public.admin_users a where a.user_id = p_owner)
      then 'public'::public.visibility_tier
    when exists (select 1 from public.profiles p
                  where p.user_id = p_owner and p.age_band = 'adult')
      then 'members'::public.visibility_tier
    else 'friends'::public.visibility_tier
  end;
$function$;

comment on function public.visibility_ceiling(uuid) is
  'The widest level this owner may choose. Admin -> public (today that is one account, evan); an established adult -> members; everybody else, INCLUDING anyone whose age is not yet established -> friends. Unknown is capped like a minor on purpose: a cap that assumes adulthood protects nobody. When Public opens up, this function changes in one place.';

create or replace function public.clamp_visibility(p_owner uuid, p_wanted public.visibility_tier)
returns public.visibility_tier
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  select least(coalesce(p_wanted, 'private'::public.visibility_tier),
               public.visibility_ceiling(p_owner));
$function$;

comment on function public.clamp_visibility(uuid, public.visibility_tier) is
  'What this owner actually gets, given what they asked for. least() over the enum sort order, which is private < certain < friends < members < public -- so a narrower request is always honoured and a wider one is cut to the ceiling. Null asks for nothing and gets private.';

create or replace function public.may_publish_a_page(p_owner uuid)
returns boolean
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  select exists (select 1 from public.admin_users a where a.user_id = p_owner);
$function$;

comment on function public.may_publish_a_page(uuid) is
  'Whether this owner may set public_page. SEPARATE FROM visibility_ceiling ON PURPOSE: publishing a page and choosing a level are two switches that are allowed to disagree, which is why three of Joshs blocks are marked public on a page nobody outside can load. Folding this into the ceiling would re-create that bug the next time somebody simplifies two near-identical checks. Today: admin only. Later: any established adult, never a minor -- one line, here.';

revoke all on function public.visibility_ceiling(uuid) from public, anon;
revoke all on function public.clamp_visibility(uuid, public.visibility_tier) from public, anon;
revoke all on function public.may_publish_a_page(uuid) from public, anon;
grant execute on function public.visibility_ceiling(uuid) to authenticated;
grant execute on function public.clamp_visibility(uuid, public.visibility_tier) to authenticated;
grant execute on function public.may_publish_a_page(uuid) to authenticated;
