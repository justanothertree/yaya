-- Songs in chat: a recording of a song, sent into a chat room and heard by that room's members.
-- Evan, 21 Nov 2026: "shared songs become a chat attachment; caps of 5 MB per file and 25 MB per
-- account; keep them until deleted." The plan is docs/2026-11-17-share-a-song-in-site.md.
--
-- The bytes live in R2 under songs/<id>.<ext>, beside the pictures and signed by the
-- `chat-songs` edge function, which reads the same project secrets the `pictures` function does.
-- What may be heard by whom is decided here.
--
-- ⚠️ NOTHING HERE DELETES A ROW. A file somebody removes, and an upload abandoned before it was
-- finished, is marked (`deleted_at`) and its object is deleted from R2 by the function; the row
-- stays, so an object whose delete failed can still be found from it.
--
-- ⚠️ NO OWNER ON ANYTHING A ROOM CAN SEE. The Lounge is pseudonymous: its messages carry no user
-- id and their authors live in a table members cannot read. So the owner of a song is kept only
-- here, in a deny-all table, the object key carries no owner, and nothing a member can call
-- returns it — only whether the song is the caller's own.

create table public.chat_song_files (
  id uuid primary key default gen_random_uuid(),
  /* no foreign key: a row outlives its account so its object can still be found and deleted */
  owner uuid not null,
  key text not null unique,
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
  created_at timestamptz not null default now()
);
create index chat_song_files_owner on public.chat_song_files (owner) where deleted_at is null;
create index chat_song_files_room on public.chat_song_files (room_id) where sent_at is not null;

alter table public.chat_song_files enable row level security;
revoke all on public.chat_song_files from public, anon, authenticated;

/* ── starting an upload ───────────────────────────────────────────────────────────────────── */
create or replace function public.chat_song_claim(
  p_room uuid, p_mime text, p_bytes integer, p_seconds numeric, p_name text
) returns table (id uuid, key text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_me uuid := auth.uid();
  v_id uuid := gen_random_uuid();
  v_ext text;
  v_name text := left(btrim(coalesce(p_name, '')), 60);
  v_held bigint;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if coalesce(public.is_suspended(v_me), false) then raise exception 'your account is suspended'; end if;
  if not public.chat_room_member(p_room) then raise exception 'not in this room'; end if;
  v_ext := case p_mime when 'audio/mp4' then 'm4a' when 'audio/webm' then 'webm'
                       when 'audio/ogg' then 'ogg' end;
  if v_ext is null then raise exception 'that is not a kind of recording this keeps'; end if;
  if p_bytes is null or p_bytes < 1 then raise exception 'that recording came to nothing'; end if;
  if p_bytes > 5242880 then raise exception 'that one is over 5 MB'; end if;
  if p_seconds is null or p_seconds <= 0 or p_seconds > 900 then raise exception 'that is not a song''s length'; end if;
  if v_name = '' then raise exception 'needs a name'; end if;
  /* an upload left unfinished for an hour is let go, so it stops counting */
  update public.chat_song_files f set deleted_at = now()
   where f.owner = v_me and not f.ready and f.deleted_at is null
     and f.created_at < now() - interval '1 hour';
  select coalesce(sum(f.bytes), 0) into v_held from public.chat_song_files f
   where f.owner = v_me and f.deleted_at is null;
  if v_held + p_bytes > 26214400 then
    raise exception 'your songs in chat hold 25 MB already — remove one to send this';
  end if;
  insert into public.chat_song_files (id, owner, key, mime, bytes, seconds, name, room_id)
  values (v_id, v_me, 'songs/' || v_id || '.' || v_ext, p_mime, p_bytes, p_seconds, v_name, p_room);
  return query select v_id, 'songs/' || v_id || '.' || v_ext;
end $$;

/* ── finishing it: the function checks the object, then marks it ready as the service ───────── */
create or replace function public.chat_song_pending(p_id uuid)
returns table (key text, mime text, bytes integer, ready boolean, owner uuid)
language sql stable security definer set search_path = public, pg_temp as $$
  select f.key, f.mime, f.bytes, f.ready, f.owner from public.chat_song_files f
   where f.id = p_id and f.owner = auth.uid() and f.deleted_at is null;
$$;

create or replace function public.chat_song_ready(p_id uuid, p_owner uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_owner is null then raise exception 'no owner'; end if;
  update public.chat_song_files f set ready = true
   where f.id = p_id and f.owner = p_owner and f.deleted_at is null;
  if not found then raise exception 'no such song'; end if;
end $$;

/* ── sending it: one message, through the one function that writes messages ──────────────── */
create or replace function public.send_chat_song(p_id uuid)
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
  select * into v_f from public.chat_song_files f where f.id = p_id for update;
  if not found or v_f.owner <> v_me or v_f.deleted_at is not null then raise exception 'no such song'; end if;
  if not v_f.ready then raise exception 'that song has not finished going up'; end if;
  if v_f.sent_at is not null then raise exception 'that song is already sent'; end if;
  if v_f.room_id is null then raise exception 'that room is gone'; end if;
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
create or replace function public.chat_songs_in(p_room uuid)
returns table (message_id uuid, file_id uuid, name text, seconds numeric, mime text, mine boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.chat_room_member(p_room) then raise exception 'not in this room'; end if;
  return query
  select f.message_id, f.id, f.name, f.seconds, f.mime, f.owner = auth.uid()
    from public.chat_song_files f
   where f.room_id = p_room and f.sent_at is not null and f.deleted_at is null
     and f.message_id is not null;
end $$;

create or replace function public.chat_song_get(p_id uuid)
returns table (key text, mime text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_f public.chat_song_files;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into v_f from public.chat_song_files f where f.id = p_id;
  /* the same answer for a song that does not exist and one you may not hear */
  if not found or v_f.deleted_at is not null or v_f.sent_at is null or v_f.room_id is null
     or not public.chat_room_member(v_f.room_id) then
    raise exception 'no such song';
  end if;
  return query select v_f.key, v_f.mime;
end $$;

/* ── removing it: the sender only; the message stays and says it was removed ─────────────── */
create or replace function public.chat_song_remove(p_id uuid)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_key text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  /* a suspended member may still take their own song down, like a picture: a narrowing action,
     listed with the others it is like in visibility-guards.sql */
  update public.chat_song_files f set deleted_at = now()
   where f.id = p_id and f.owner = auth.uid() and f.deleted_at is null
  returning f.key into v_key;
  if v_key is null then raise exception 'no such song'; end if;
  return v_key;
end $$;

/* ── who may call what ────────────────────────────────────────────────────────────────────── */
revoke all on function public.chat_song_claim(uuid, text, integer, numeric, text) from public, anon;
revoke all on function public.chat_song_pending(uuid) from public, anon;
revoke all on function public.chat_song_ready(uuid, uuid) from public, anon, authenticated;
revoke all on function public.send_chat_song(uuid) from public, anon;
revoke all on function public.chat_songs_in(uuid) from public, anon;
revoke all on function public.chat_song_get(uuid) from public, anon;
revoke all on function public.chat_song_remove(uuid) from public, anon;
grant execute on function public.chat_song_claim(uuid, text, integer, numeric, text) to authenticated;
grant execute on function public.chat_song_pending(uuid) to authenticated;
grant execute on function public.chat_song_ready(uuid, uuid) to service_role;
grant execute on function public.send_chat_song(uuid) to authenticated;
grant execute on function public.chat_songs_in(uuid) to authenticated;
grant execute on function public.chat_song_get(uuid) to authenticated;
grant execute on function public.chat_song_remove(uuid) to authenticated;
