-- 2026-09-02 — Two things: the home page's editable text, and the art block's missing word.
--
-- Both are client-ready and inert until this runs. Nothing here changes what any existing page
-- shows: the site keeps rendering its built-in text until somebody edits it, and the art block
-- has simply been failing to save.
--
--
-- 1. THE ART BLOCK
--
-- save_my_profile_blocks carries its own allowlist of block types, separate from the client's.
-- 'art' was never added, so choosing an art block and saving returns "invalid block" — which is
-- the "bad block" error from a while back, and it is still happening. Only the allowlist changes;
-- the rest of the function is reproduced as-is so this file is a complete, replayable definition
-- rather than a patch that assumes what is already there. One line differs from the live text,
-- for a linter's benefit rather than the database's — see the note on v_count below.
--
--
-- ABOUT THE "DESTRUCTIVE OPERATIONS" WARNING THE EDITOR SHOWS
--
-- Expected, and nothing here removes data. What triggers it:
--   * `create or replace function` twice   — replacing a definition, which is the point
--   * `drop policy if exists`              — on the policy the very next line recreates
--   * `revoke`                             — taking away rights nothing should have had
--   * `delete from public.profile_blocks`  — INSIDE the function body, scoped to `user_id = v_me`,
--                                            and already exactly what the live function does: it
--                                            replaces your blocks by clearing yours and
--                                            re-inserting. Defining a function does not run it.
--
-- The whole file is wrapped in begin/commit, so if any statement fails, none of it is applied.
--
--
-- 2. THE HOME PAGE'S TEXT
--
-- WHY A TABLE AND NOT THE REPO. The point of the editor is composing the front page while looking
-- at it, and a change that needs a deploy is not that. The code stays the source of what a
-- PROJECT is — the document only stores an order, a hidden list, and the text that differs — so
-- adding a project in the repo still makes it appear on its own.
--
-- WHY IT IS WORLD-READABLE. It is the front page. Every signed-out visitor needs it, so `select`
-- is open to everyone, deliberately. That is the whole of what is exposed: one row of the site's
-- own marketing copy, which is already public the moment it renders.
--
-- WHY THERE IS NO WRITE POLICY AT ALL. The only way in is save_site_content, which is SECURITY
-- DEFINER and checks is_admin(). Leaving the table with no insert/update/delete policy means a
-- future change to roles or grants cannot accidentally open a second door: with RLS on and no
-- policy, every direct write is refused before anything else is consulted. One door, and it is
-- watched.
--
-- WHAT THE FUNCTION REFUSES, and why each one is here rather than trusted to the client:
--   * not an admin                 — the client hides the button; this is what actually stops it
--   * an id other than 'home'      — so a compromised admin session cannot fill the table with
--                                    rows nobody reads and nobody is watching the size of
--   * a document that is not an object
--   * anything over 40kB           — the client stops at 36000, deliberately lower: this counts
--                                    `p_doc::text`, and Postgres renders jsonb with a space after
--                                    every colon and comma where the browser emits neither, about
--                                    9% more on a representative document. The editor spends the
--                                    smaller budget so it can never promise room that is not there
--
-- Note what is NOT enforced here: the shape of the document. The client validates and clamps
-- every field on the way OUT of storage (readHomeDoc), which is the side that matters — a reader
-- that trusts its input is one bad write away from publishing it. Duplicating that as jsonb
-- assertions would be a second copy to keep in step, and the copy that runs on read is the one
-- that protects the page.

begin;

-- ── 1. the art block ────────────────────────────────────────────────────────
create or replace function public.save_my_profile_blocks(p_blocks jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_me uuid := auth.uid();
  v_count int;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if jsonb_typeof(p_blocks) <> 'array' then raise exception 'p_blocks must be an array'; end if;

  -- ⚠️ ASSIGNED, not `select count(*) into v_count`, which is what the live definition says and
  -- what this otherwise reproduces. The two are identical in plpgsql, but the SQL editor lints the
  -- body as top-level SQL, where `select … into name` is the archaic spelling of CREATE TABLE AS —
  -- so it reports "creates a table without RLS: v_count" every time this file is opened. It never
  -- created a table (the live function has run that line on every profile save and there is no
  -- such table), but a warning you have to dismiss in order to proceed is a warning you stop
  -- reading, and that habit is worth more than one line of style.
  v_count := (select count(*) from jsonb_array_elements(p_blocks));
  if v_count > 20 then raise exception 'too many blocks (max 20)'; end if;

  if exists (
    select 1 from jsonb_array_elements(p_blocks) e
    where (e->>'block_type') not in (
            'bio','banner','stats','activity','guestbook','status','trophies',
            'song','visualizer','art'          -- <- 'art' is the addition
          )
       or (e->>'size') not in ('small','medium','large')
       or coalesce(e->>'visibility','members') not in ('public','friends','members','private')
       or length(e->>'config') > 16000
  ) then
    raise exception 'invalid block';
  end if;

  delete from public.profile_blocks where user_id = v_me;

  insert into public.profile_blocks (user_id, block_type, position, size, config, visibility)
  select v_me,
         e->>'block_type',
         (row_number() over ())::int,
         e->>'size',
         coalesce(e->'config','{}'::jsonb),
         coalesce(e->>'visibility','members')::public.visibility_tier
  from jsonb_array_elements(p_blocks) e;
end;
$$;

-- ── 2. the home page's text ─────────────────────────────────────────────────
create table if not exists public.site_content (
  id          text primary key,
  doc         jsonb       not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  uuid        references auth.users(id) on delete set null
);

alter table public.site_content enable row level security;

-- read: everyone, including signed-out visitors. This is the front page.
-- ⚠️ Granted explicitly rather than left to Supabase's default privileges. A policy says who MAY
-- read; the grant is what lets the request through at all, and a front page that renders for
-- signed-in people and is blank for everyone else is the exact failure that would follow.
grant select on public.site_content to anon, authenticated;
drop policy if exists "anyone can read site content" on public.site_content;
create policy "anyone can read site content"
  on public.site_content for select
  using (true);

-- write: no policy on purpose. The rpc below is the only way in.
revoke insert, update, delete on public.site_content from anon, authenticated;

create or replace function public.save_site_content(p_id text, p_doc jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  if p_id is null or p_id not in ('home') then
    raise exception 'unknown page';
  end if;
  if jsonb_typeof(p_doc) <> 'object' then
    raise exception 'p_doc must be an object';
  end if;
  if length(p_doc::text) > 40000 then
    raise exception 'too much content';
  end if;

  insert into public.site_content (id, doc, updated_at, updated_by)
  values (p_id, p_doc, now(), auth.uid())
  on conflict (id) do update
    set doc = excluded.doc,
        updated_at = now(),
        updated_by = excluded.updated_by;
end;
$$;

-- a signed-out visitor never publishes anything, so it is not offered to them
revoke all on function public.save_site_content(text, jsonb) from public, anon;
grant execute on function public.save_site_content(text, jsonb) to authenticated;

commit;

-- ── afterwards, to confirm ──────────────────────────────────────────────────
-- select position('''art''' in pg_get_functiondef(oid)) > 0 as art_allowed
--   from pg_proc where proname = 'save_my_profile_blocks';
-- select * from public.site_content;                       -- empty is correct until you publish
