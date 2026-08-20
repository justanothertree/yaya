-- ============================================================================
-- ✅ APPLIED 2026-08-19. Migrations: lounge_authorship_leaves_the_readable_table,
-- chat_functions_resolve_lounge_authorship_indirectly,
-- send_chat_message_qualify_out_param_collisions,
-- revoke_public_execute_on_chat_author_guard.
--
-- Take the Lounge author's real account id out of the table members can read.
--
-- THE HOLE
-- chat_messages.user_id is the author's real auth.users id in EVERY room, and
-- chat_messages_select lets any room member read the table (`chat_room_member(room_id)`).
-- In the Lounge — whose entire point is that the display name is a pseudonym — that
-- defeated the alias two separate ways:
--
--   1. a plain `from('chat_messages').select('*')` in devtools, and
--   2. the postgres_changes payload, which is the RAW row (realtime has no column
--      filtering), delivered to every subscriber of the room.
--
-- Either one, joined against list_members (which returns user_id + username), unmasks
-- a pseudonymous author. Nothing in the UI read the field. It never had to.
--
-- WHY NOT JUST FIX THE TRANSPORT
-- Narrowing the RLS policy or moving live lounge updates onto a broadcast channel would
-- each have closed one door while leaving the secret sitting in a column members are
-- allowed to read, protected only by a policy expression. One future policy edit, one new
-- subscriber, and it is back. So the identity LEAVES the readable table instead.
--
-- THE SHAPE
--   * chat_messages.user_id is nullable, and null for every lounge row.
--   * lounge_message_authors holds the truth: RLS enabled, NO policies, and no grants to
--     anon or authenticated at all — so it is refused at the GRANT, before RLS is even
--     consulted. Only SECURITY DEFINER functions read it.
--   * a BEFORE INSERT OR UPDATE trigger enforces the invariant in both directions, because
--     the reason this bug existed is that a rule nobody enforces stops being true.
--
-- KNOCK-ONS THAT HAD TO MOVE WITH IT
--   * list_room_messages: `mine` cannot compare ids in the lounge (there is none), so it
--     resolves through the side table.
--   * list_chat_overview: unread counted `m.user_id <> auth.uid()`, which in the lounge is
--     now `null <> ...` = NULL = never true. The Lounge would have sat at 0 unread FOREVER.
--     Measured before fixing: old predicate 0, correct answer 5 (8 messages, 3 mine).
--   * send_chat_message: returns the same shape list_room_messages does instead of the raw
--     row. The raw row had no `mine` flag, so the sender's own message rendered as somebody
--     else's until a reload — and in the lounge the row no longer says who wrote it even to
--     the person who did.
--
-- KNOWN EDGE: a lounge message you sent shows as not-yours on a SECOND device until the
-- room is reopened — the realtime echo has no id to recognise you by, which is the point.
-- The optimistic append covers the device you sent from.
--
-- VERIFIED (simulated JWT, real data): lounge 8 rows / 0 author ids / 0 usernames with
-- `mine` still correct at 3; circuit 17 and DM 5 keep full identity; a plain table read of
-- the lounge returns 8 rows and 0 ids; the side table is permission-denied; the guard
-- rejects both a lounge row carrying an id and an ordinary row without one; anon-executable
-- audit returns none.
-- ============================================================================

alter table public.chat_messages alter column user_id drop not null;

create table if not exists public.lounge_message_authors (
  message_id uuid primary key references public.chat_messages(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade
);
create index if not exists lounge_message_authors_user_idx
  on public.lounge_message_authors (user_id);
alter table public.lounge_message_authors enable row level security;
-- no policies on purpose; a GRANT is not a REVOKE, so strip the defaults too
revoke all on table public.lounge_message_authors from anon, authenticated;

insert into public.lounge_message_authors (message_id, user_id)
select m.id, m.user_id
from public.chat_messages m
join public.chat_rooms r on r.id = m.room_id
where r.kind = 'lounge' and m.user_id is not null
on conflict (message_id) do nothing;

update public.chat_messages m
set user_id = null
from public.chat_rooms r
where r.id = m.room_id and r.kind = 'lounge' and m.user_id is not null;

create or replace function public.chat_messages_author_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_kind text;
begin
  select kind into v_kind from public.chat_rooms where id = new.room_id;
  if v_kind = 'lounge' then
    if new.user_id is not null then
      raise exception 'lounge messages must not carry an author id — see lounge_message_authors';
    end if;
  elsif new.user_id is null then
    raise exception 'user_id is required outside the lounge';
  end if;
  return new;
end;
$$;
-- a trigger function is still a function: CREATE hands PUBLIC the execute bit by default,
-- which put a SECURITY DEFINER function inside anon's reach
revoke all on function public.chat_messages_author_guard() from public, anon, authenticated;

drop trigger if exists chat_messages_author_guard on public.chat_messages;
create trigger chat_messages_author_guard
  before insert or update on public.chat_messages
  for each row execute function public.chat_messages_author_guard();

-- The three functions that touched chat_messages.user_id are recreated in the migrations
-- named at the top of this file; their current definitions are the source of truth. The
-- one trap worth repeating here: every OUT parameter of a `returns table (...)` is an
-- in-scope plpgsql variable for the whole body, so `id`, `room_id`, `body`, `author_name`
-- and `created_at` all shadow columns of the tables these functions read. An unqualified
-- `where id = p_room` is ambiguous and fails at RUN time, not at CREATE time. Qualify
-- every column reference.
