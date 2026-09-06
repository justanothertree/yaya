-- 2026-09-06 — People can show who is waiting on you
--
-- WHY: the People page lists everyone and shows a live dot beside each of them, and the
-- "💬 Message" button looks exactly the same whether you have never spoken to somebody or they
-- messaged you an hour ago and are still waiting. So the page reads as inert next to Chat, and
-- the obvious cure — folding Chat into People — is the wrong one: a directory sorts by
-- relationship and an inbox sorts by recency, and merging them forces one of those to lose.
-- What People is actually missing is not the conversation. It is the fact that there is one.
--
--
-- ⚠️ ONE DEFINITION OF "UNREAD", WHICH IS WHY THIS TOUCHES AN EXISTING FUNCTION.
--
-- The easy version was a second function that counts unread DMs per person, and it would have
-- been additive and risk-free and wrong: the count of unread messages would then exist in two
-- places, computed by two copies of a subtle predicate (messages not written by you, not
-- authored under a lounge pseudonym of yours, created after your last read). Those two copies
-- disagree the first time either is touched, and the bell and the People page start quietly
-- telling you different numbers. So `list_chat_overview` gains the one column People was
-- missing, and both screens keep reading the same arithmetic.
--
-- ⚠️ The column is the PEER'S USER ID, not their name. `name` already carries
-- coalesce(first_name, username) for a DM, and matching People rows against that would work
-- until two friends share a first name — which is the kind of bug that waits for exactly the
-- wrong moment. Measured now: 10 profiles, 10 distinct first names, so it would work today and
-- break on the eleventh person.
--
-- ⚠️ drop-then-create, because `create or replace` cannot change a function's return type. The
-- body is otherwise untouched, and the only caller of the old shape is the notification bell,
-- which reads columns by name and ignores one it does not know about — so a browser tab left
-- open on the old build keeps working.

begin;

drop function if exists public.list_chat_overview();

create function public.list_chat_overview()
returns table(
  id uuid,
  kind text,
  name text,
  last_body text,
  last_author text,
  last_at timestamp with time zone,
  unread integer,
  peer_user_id uuid
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select r.id, r.kind,
         case r.kind
           when 'lounge' then 'The Lounge'
           when 'dm' then coalesce((
             select coalesce(p.first_name, p.username::text)
             from public.chat_room_members m
             join public.profiles p on p.user_id = m.user_id
             where m.room_id = r.id and m.user_id <> auth.uid()
             limit 1), 'DM')
           else coalesce(g.name, 'Chat')
         end as name,
         lm.body, lm.author_name, lm.created_at,
         coalesce(u.n, 0)::int as unread,
         -- the new column: who the other person in a DM actually IS. Null for every other kind
         -- of room, because "the peer" is not a thing a group chat has.
         case when r.kind = 'dm' then (
           select m.user_id
           from public.chat_room_members m
           where m.room_id = r.id and m.user_id <> auth.uid()
           limit 1
         ) end as peer_user_id
  from public.chat_rooms r
  left join public.circuit_groups g on g.id = r.group_id
  left join lateral (
    select m.body, m.author_name, m.created_at
    from public.chat_messages m
    where m.room_id = r.id
    order by m.created_at desc
    limit 1
  ) lm on true
  left join lateral (
    select count(*) as n
    from public.chat_messages m
    where m.room_id = r.id
      -- `is distinct from` rather than <>: a message whose author deleted their account has no
      -- id on either side, and that is somebody else's message, not nobody's.
      and m.user_id is distinct from auth.uid()
      and not exists (select 1 from public.lounge_message_authors a
                      where a.message_id = m.id and a.user_id = auth.uid())
      and m.created_at > coalesce(
        (select cr.last_read_at from public.chat_reads cr
         where cr.room_id = r.id and cr.user_id = auth.uid()),
        '-infinity'::timestamptz)
  ) u on true
  where public.chat_room_member(r.id)
  order by lm.created_at desc nulls last, r.kind, 3;
$function$;

-- dropping a function drops its grants with it; this restores exactly what it had
revoke all on function public.list_chat_overview() from public, anon;
grant execute on function public.list_chat_overview() to authenticated;

commit;

-- ── HOW TO CHECK IT WORKED ──────────────────────────────────────────────────────────────────
--   select kind, name, unread, peer_user_id from public.list_chat_overview();
-- Six DM rooms exist, so six rows should come back with a peer_user_id and every other row
-- with null. The bell should be unchanged — same unread numbers, because it is the same
-- arithmetic and nothing about the count was touched.
--
-- ── ROLLBACK ────────────────────────────────────────────────────────────────────────────────
-- Recreate it without the last column and its case expression, then re-grant to authenticated.
-- The People page reads peer_user_id defensively, so it degrades to no badges rather than
-- breaking if the column is missing.
