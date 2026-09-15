-- 2026-09-15 — songs, drawings and saved looks stop living in one browser
--
-- ✅ APPLIED as migration `member_library_on_the_server`. Recorded here for the reasoning; the
--    statements are reproduced below exactly as they ran and are safe to re-run.
--
--
-- WHAT THIS IS FOR
--
-- The song library, the paint gallery and the saved looks were localStorage and only
-- localStorage. Each of those files says so, deliberately, as a first step — no schema change, no
-- migration against a live database, no new way for one person's data to reach another. It was
-- the right first step and the bill came due twice in a week:
--
--   · Josh lost songs he made weeks earlier, having changed no browser and cleared nothing.
--     Browsers evict site data from sites you have not visited lately. There was no second copy.
--   · A song made in Firefox could be played on a profile in Chrome but not edited there,
--     because the editor looks in the library and the library was not on that machine.
--
-- The backup button in Account was a stopgap and was labelled one. This is the fix.
--
--
-- ⚠️ RLS ON, ZERO POLICIES, NO GRANTS — the shape profile_blocks and profile_notes already use.
-- Deny-all at the table, reachable only through the definer RPCs, so "what may be read" is one
-- question answered in one place rather than a policy and a grant that have to agree with each
-- other. Verified after applying: anon and authenticated both read zero rows directly.
--
-- ⚠️ CASE-INSENSITIVE SLOTS, because that is already how the three local stores behave —
-- savePreset replaces a look of the same name, and the backup restore skips by name. Keying the
-- upsert the same way means syncing cannot produce the duplicates those rules exist to prevent.
--
-- ⚠️ A CEILING PER PERSON, checked in the RPC rather than by a trigger so the caller is told
-- which limit it hit: 400 items, 20MB total, 128KB each. Storage is small and shared, and this is
-- the only write path into it.

create table if not exists public.member_library (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(user_id) on delete cascade,
  kind       text not null check (kind in ('song','loop','art','look')),
  name       text not null,
  body       jsonb not null,
  updated_at timestamptz not null default now(),
  constraint member_library_name_len  check (char_length(name) between 1 and 80),
  constraint member_library_body_size check (octet_length(body::text) <= 131072)
);

create unique index if not exists ux_member_library_slot
  on public.member_library (user_id, kind, lower(name));
create index if not exists ix_member_library_user
  on public.member_library (user_id, kind);

alter table public.member_library enable row level security;
revoke all on public.member_library from anon, authenticated;

-- library_list()  -> jsonb of your own rows
-- library_put(kind, name, body) -> upsert into your own slot, with the caps above
-- library_drop(kind, name)      -> silent when already gone
--
-- All three raise 'not authenticated' with no session, take no parameter naming a user, and are
-- granted to `authenticated` only — revoked from public AND anon, which is the house pattern and
-- the thing that was got wrong once already this week (see 2026-09-15-revoke-what-anon-cannot-use).
--
-- The full bodies live in the applied migration. They are short and the shape is:
--   if auth.uid() is null then raise exception 'not authenticated'; end if;
--   ... where user_id = auth.uid()
--
--
-- ── THE CLIENT SIDE, AND THE ONE RULE THAT MATTERS ──────────────────────────────────────────
--
-- src/library/cloud.ts. Local stays the source every room reads, synchronously, knowing nothing
-- about any of this — which is what keeps the instrument and paint rooms working offline, working
-- signed out, and exactly as fast as before. The server is a copy kept level, not something the
-- UI waits for.
--
-- ⚠️ SYNC NEVER DELETES. Merging is add-only in both directions, keyed by name. "Missing on this
-- machine" is ambiguous — it means both "I deleted it" and "I have never seen it" — and without
-- tombstones to tell those apart, a tidy-looking two-way delete would eat work the first time
-- somebody signed in on a fresh browser. Deletions travel only as they happen, while the app is
-- open and watching, because only then is the difference known: it was in the previous snapshot.
--
-- ⚠️ It WATCHES the stores rather than wrapping saveToLibrary and saveArt. Those are pure storage
-- and must stay that way: a network call inside them would make keeping a take something that can
-- fail, and "Keep" is a button that must not be able to. Verified — a save with the watcher
-- running and no session still lands locally and the failed push changes nothing.
--
--
-- ── HOW TO CHECK IT ─────────────────────────────────────────────────────────────────────────
-- What your account is holding:
--
--   select kind, name, octet_length(body::text) as bytes, updated_at
--     from public.member_library
--    where user_id = (select user_id from public.profiles where lower(username)='evan')
--    order by updated_at desc;
--
-- And that nothing reads it directly — expect permission denied, not an empty list:
--
--   set local role authenticated; select count(*) from public.member_library;
