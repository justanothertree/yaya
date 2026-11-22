-- ⏳ DRAFT, NOT APPLIED. Songs in chat: a recording of a song, sent into a chat room and heard by
-- that room's members. Evan, 21 Nov 2026: "shared songs become a chat attachment; caps of 5 MB per
-- file and 25 MB per account; keep them until deleted." On 22 Nov: "migration through CI first; ask
-- before any production apply, storage change, or function deploy."
--
-- The contract both halves are built against is docs/2026-11-22-chat-songs.md; the names, shapes
-- and caps below are that file's. The plan before it was docs/2026-11-17-share-a-song-in-site.md.
--
-- WHY THIS SHAPE. The bytes live in R2 under songs/<id>.<ext>, beside the pictures and signed by
-- the `chat-songs` edge function, which reads the same project secrets the `pictures` function
-- does. What may be heard by whom is decided here, and only here: the function signs a URL only
-- after one of these has answered, as the caller.
--
-- ⚠️ NOTHING HERE DELETES A ROW. A song somebody removes, and an upload never sent within the hour,
-- is marked `deleted_at`; the function deletes its object from R2 and then marks `object_gone_at`.
-- The row stays, so an object whose delete failed can still be found from it — which is the gap
-- `picture_drop` left, where the row went first and the key with it. `chat_song_abandoned` is how
-- the function finds those again.
--
-- ⚠️ NO OWNER ON ANYTHING A ROOM CAN SEE. The Lounge is pseudonymous: its messages carry no user id
-- and their authors live in a table members cannot read. So the owner of a song is kept only here,
-- in a deny-all table; the object key carries no owner; and nothing a member can call returns it
-- about anybody but themselves. `mine` is the only answer about it.
--
-- ⚠️ EVERY REVOKE NAMES anon. Production's default ACL hands anon and authenticated arwdDxtm on
-- every new table and EXECUTE on every new function, and `revoke … from public` does not touch
-- either (CLAUDE.md §3). db-guards.yml puts those defaults back before loading this file, so a
-- revoke that forgot anon fails there rather than here.
--
-- ⚠️ NOT IN visibility-guards.sql BLOCK B. That block lists the deny-all tables, and CI runs it
-- BEFORE any draft loads, where `has_table_privilege` on a table that does not exist yet raises
-- and takes the whole suite down. The test below checks this table per privilege instead; once
-- this is applied the table belongs in block B's list. Block K already exempts `chat_song_remove`.
--
-- TESTED: supabase/tests/chat-songs.sql, run by .github/workflows/db-guards.yml after loading this
-- file in one transaction (psql -1), then the standing guards again with it in place.
-- ROLLBACK, while nothing has been sent: drop the nine functions and the table. After a song has
-- been sent, the rows are the only record of which R2 objects exist — export them first.

create table public.chat_song_files (
  id uuid primary key default gen_random_uuid(),
  /* no foreign key: a row outlives its account so its object can still be found and deleted */
  owner uuid not null,
  /* ⚠️ A CHECK ON THE KEY, because the function DELETEs whatever key a row names. Minted only by
     `chat_song_claim`, and the constraint is what makes that true of every path: a key outside
     songs/ could otherwise name a picture. */
  key text not null unique check (key ~ '^songs/[0-9a-f-]{36}\.(m4a|webm|ogg)$'),
  mime text not null check (mime in ('audio/mp4', 'audio/webm', 'audio/ogg')),
  bytes integer not null check (bytes between 1 and 5242880),
  seconds numeric not null check (seconds > 0 and seconds <= 900),
  name text not null check (char_length(name) between 1 and 60),
  /* the room it is going to, chosen when the upload starts, so access is decided by the room it
     was SENT to and never by where a message mentioning it appears */
  room_id uuid references public.chat_rooms (id) on delete set null,
  message_id uuid references public.chat_messages (id) on delete set null,
  ready boolean not null default false,
  sent_at timestamptz,
  deleted_at timestamptz,
  /* when the R2 object was confirmed deleted; null on a deleted row means it may still be there */
  object_gone_at timestamptz,
  created_at timestamptz not null default now(),
  constraint chat_song_files_sent_is_ready check (sent_at is null or ready),
  constraint chat_song_files_gone_is_deleted check (object_gone_at is null or deleted_at is not null)
);
create index chat_song_files_owner on public.chat_song_files (owner);
create index chat_song_files_room on public.chat_song_files (room_id) where message_id is not null;

alter table public.chat_song_files enable row level security;
revoke all on public.chat_song_files from public, anon, authenticated;

/* ── starting an upload ───────────────────────────────────────────────────────────────────── */
create function public.chat_song_claim(
  p_room uuid, p_mime text, p_bytes integer, p_seconds numeric, p_name text
) returns table (id uuid, key text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_me uuid := auth.uid();
  v_id uuid := gen_random_uuid();
  v_ext text;
  /* one line, at most 60 characters: it becomes the message's text */
  v_name text := btrim(left(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), 60));
  v_held bigint;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if coalesce(public.is_suspended(v_me), false) then raise exception 'your account is suspended'; end if;
  if not public.chat_room_member(p_room) then raise exception 'not in this room'; end if;
  v_ext := case p_mime when 'audio/mp4' then 'm4a' when 'audio/webm' then 'webm'
                       when 'audio/ogg' then 'ogg' end;
  /* the CHECKs on the table are the backstop; these are the wording, as in picture_claim */
  if v_ext is null then raise exception 'that is not a kind of recording this keeps'; end if;
  if p_bytes is null or p_bytes < 1 then raise exception 'that recording came to nothing'; end if;
  if p_bytes > 5242880 then raise exception 'that one is over 5 MB'; end if;
  if p_seconds is null or p_seconds <= 0 then raise exception 'that recording has no length'; end if;
  if p_seconds > 900 then raise exception 'that one is over 15 minutes'; end if;
  if v_name = '' then raise exception 'needs a name'; end if;

  /* ⚠️ ONE CLAIM AT A TIME PER ACCOUNT. The ceiling sums OTHER rows, so it cannot be a CHECK, and
     two claims at once would both read the total before either inserted. */
  perform pg_advisory_xact_lock(hashtextextended('chat_song_claim:' || v_me::text, 0));

  /* ⚠️ A SONG NOT SENT WITHIN THE HOUR IS LET GO, so it stops counting. "Unfinished" means not
     SENT rather than not ready: a song that went up and was never sent is in no chat, so nothing
     anywhere shows it and nothing could ever remove it — it would hold quota for ever. Sending
     follows ready within a second, so an hour is far longer than any honest gap. The objects are
     deleted later, by the function, from `chat_song_abandoned`. */
  update public.chat_song_files f set deleted_at = now()
   where f.owner = v_me and f.sent_at is null and f.deleted_at is null
     and f.created_at < now() - interval '1 hour';

  select coalesce(sum(f.bytes), 0) into v_held from public.chat_song_files f
   where f.owner = v_me and f.deleted_at is null;
  if v_held + p_bytes > 26214400 then
    raise exception 'your songs in chat come to 25 MB — remove one first';
  end if;

  /* the key is minted from the id, never from a name or the owner */
  insert into public.chat_song_files (id, owner, key, mime, bytes, seconds, name, room_id)
  values (v_id, v_me, 'songs/' || v_id || '.' || v_ext, p_mime, p_bytes, p_seconds, v_name, p_room);
  return query select v_id, 'songs/' || v_id || '.' || v_ext;
end $$;

/* ── finishing it: the function checks the object, then marks it ready as the service ───────── */
/* ⚠️ `owner` IS RETURNED, AND IS ONLY EVER THE CALLER'S OWN ID: the row is found by
   `owner = auth.uid()` or not at all. It is what lets `ready` run as the service without the
   function deciding anything about ownership, as `picture_pending` does. */
create function public.chat_song_pending(p_id uuid)
returns table (key text, mime text, bytes integer, ready boolean, owner uuid)
language sql stable security definer set search_path = public, pg_temp as $$
  select f.key, f.mime, f.bytes, f.ready, f.owner from public.chat_song_files f
   where f.id = p_id and f.owner = auth.uid() and f.deleted_at is null;
$$;

/* ⚠️ SERVICE ONLY. A member who could call this could mark an object ready without the function
   ever measuring it, and the size and the first bytes are the only check on what R2 holds. */
create function public.chat_song_ready(p_id uuid, p_owner uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_owner is null then raise exception 'no owner'; end if;
  update public.chat_song_files f set ready = true
   where f.id = p_id and f.owner = p_owner and f.deleted_at is null;
  if not found then raise exception 'no such song'; end if;
end $$;

/* ── sending it: one message, through the one function that writes messages ──────────────── */
create function public.send_chat_song(p_id uuid)
returns table (id uuid, room_id uuid, created_at timestamptz, body text, author_name text,
               author_user_id uuid, author_username text, mine boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_me uuid := auth.uid();
  v_f public.chat_song_files;
  v_len text;
  v_m record;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if coalesce(public.is_suspended(v_me), false) then raise exception 'your account is suspended'; end if;
  /* locked, so two sends of one song cannot both find it unsent */
  select * into v_f from public.chat_song_files f where f.id = p_id for update;
  if not found or v_f.owner <> v_me or v_f.deleted_at is not null then raise exception 'no such song'; end if;
  if not v_f.ready then raise exception 'that song has not finished going up'; end if;
  if v_f.sent_at is not null then raise exception 'that song is already sent'; end if;
  if v_f.room_id is null then raise exception 'that room is gone'; end if;
  /* ⚠️ WHOLE SECONDS, ROUNDED DOWN: 59.9 is 0:59, never 1:00. The client's lengthLabel must
     agree, because the thread draws the length from the row and the list shows this text. */
  v_len := floor(v_f.seconds / 60)::int || ':' || lpad((floor(v_f.seconds)::int % 60)::text, 2, '0');
  /* a body that reads as itself wherever only the text is shown: the list, the bell, an older
     bundle. Which message carries which song is the file's record, never the text, so a body
     typed to look like one carries nothing. The message goes through send_chat_message, the one
     writer of chat_messages, so the room's checks and the Lounge's hidden authorship are its. */
  select s.* into v_m
    from public.send_chat_message(v_f.room_id, '🎵 ' || v_f.name || ' (' || v_len || ')') s;
  update public.chat_song_files f set message_id = v_m.id, sent_at = now() where f.id = p_id;
  return query select v_m.id, v_m.room_id, v_m.created_at, v_m.body, v_m.author_name,
                      v_m.author_user_id, v_m.author_username, v_m.mine;
end $$;

/* ── hearing it ───────────────────────────────────────────────────────────────────────────── */
/* ⚠️ REMOVED SONGS ARE RETURNED TOO, with `removed`, because the message stays and the thread has
   to say why it no longer plays. Sent songs only: a claim nobody sent is in no conversation. */
create function public.chat_songs_in(p_room uuid)
returns table (message_id uuid, file_id uuid, name text, seconds numeric, mime text,
               mine boolean, removed boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.chat_room_member(p_room) then raise exception 'not in this room'; end if;
  return query
  select f.message_id, f.id, f.name, f.seconds, f.mime, f.owner = auth.uid(), f.deleted_at is not null
    from public.chat_song_files f
   where f.room_id = p_room and f.message_id is not null;
end $$;

create function public.chat_song_get(p_id uuid)
returns table (key text, mime text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_f public.chat_song_files;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into v_f from public.chat_song_files f where f.id = p_id;
  /* ⚠️ ONE ANSWER for a song that does not exist, one that was removed, one never sent, and one
     in a room you are not in, so the refusal says nothing about which */
  if not found or v_f.deleted_at is not null or v_f.message_id is null or v_f.room_id is null
     or not public.chat_room_member(v_f.room_id) then
    raise exception 'no such song';
  end if;
  return query select v_f.key, v_f.mime;
end $$;

/* ── removing it: the sender only; the message stays and says it was removed ─────────────── */
create function public.chat_song_remove(p_id uuid)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_key text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  /* a suspended member may still take their own song down, like a picture: a narrowing action,
     listed with the others it is like in visibility-guards.sql block K */
  update public.chat_song_files f set deleted_at = now()
   where f.id = p_id and f.owner = auth.uid() and f.deleted_at is null
  returning f.key into v_key;
  if v_key is null then raise exception 'no such song'; end if;
  return v_key;
end $$;

/* ── tidying R2: what was let go and may still be there ──────────────────────────────────── */
/* the caller's own, oldest first, twenty at a time: the function deletes these before each upload,
   so a delete that failed once is tried again rather than forgotten */
create function public.chat_song_abandoned()
returns table (id uuid, key text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  return query
  select f.id, f.key from public.chat_song_files f
   where f.owner = auth.uid() and f.deleted_at is not null and f.object_gone_at is null
   order by f.deleted_at, f.id
   limit 20;
end $$;

/* ⚠️ SERVICE ONLY, and only for a row already deleted: a live song's object is never "gone".
   Saying so twice is harmless, because a retry after a lost answer is the ordinary case. */
create function public.chat_song_gone(p_id uuid, p_owner uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_owner is null then raise exception 'no owner'; end if;
  update public.chat_song_files f set object_gone_at = coalesce(f.object_gone_at, now())
   where f.id = p_id and f.owner = p_owner and f.deleted_at is not null;
  if not found then raise exception 'no such song'; end if;
end $$;

/* ── who may call what ────────────────────────────────────────────────────────────────────── */
revoke all on function public.chat_song_claim(uuid, text, integer, numeric, text) from public, anon;
revoke all on function public.chat_song_pending(uuid) from public, anon;
revoke all on function public.chat_song_ready(uuid, uuid) from public, anon, authenticated;
revoke all on function public.send_chat_song(uuid) from public, anon;
revoke all on function public.chat_songs_in(uuid) from public, anon;
revoke all on function public.chat_song_get(uuid) from public, anon;
revoke all on function public.chat_song_remove(uuid) from public, anon;
revoke all on function public.chat_song_abandoned() from public, anon;
revoke all on function public.chat_song_gone(uuid, uuid) from public, anon, authenticated;
grant execute on function public.chat_song_claim(uuid, text, integer, numeric, text) to authenticated;
grant execute on function public.chat_song_pending(uuid) to authenticated;
grant execute on function public.chat_song_ready(uuid, uuid) to service_role;
grant execute on function public.send_chat_song(uuid) to authenticated;
grant execute on function public.chat_songs_in(uuid) to authenticated;
grant execute on function public.chat_song_get(uuid) to authenticated;
grant execute on function public.chat_song_remove(uuid) to authenticated;
grant execute on function public.chat_song_abandoned() to authenticated;
grant execute on function public.chat_song_gone(uuid, uuid) to service_role;
