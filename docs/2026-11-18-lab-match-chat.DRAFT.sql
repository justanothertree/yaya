-- ⛔ DRAFT — NOT APPLIED. Chat for a match by turns: one conversation per match, kept with it,
-- that only the match's two players can read or write.
--
-- WHAT: a table, lab_match_chat, in the house pattern for member data (CLAUDE.md §3): RLS on, zero
-- policies, no grants, reached only through two SECURITY DEFINER functions that ask the same
-- question every match function asks, lab_match_mine: are you one of this match's two players, and
-- are you two still friends? Anybody else, a guest included, gets the answer a stranger gets.
--
--   lab_match_say(p_match, p_body)    one line, from your seat: 1–300 characters, one line, no
--                                     control characters; twenty a minute, five hundred a match
--   lab_match_lines(p_match, p_after) the lines after id p_after, oldest first, the last 100 at most
--
-- A LIVE GAME IN A CALL has no chat of its own and none of this: it uses the call's chat
-- (src/voice/CallChat.tsx in the call dock; the table's "Call chat" opens it), which everybody in
-- the call reads and which a DM or circuit call keeps in that conversation. This is only for the
-- matches by turns, where the two players are rarely on the page at once, so a line has to wait.
--
-- ⚠️ THE TABLE'S GRANTS ARE REVOKED, NOT LEFT OFF: the schema's default ACL hands anon and
-- authenticated every privilege on every new table (CLAUDE.md §3), and RLS does not cover TRUNCATE.
-- And `revoke … from public` does not reach anon in this project, so every revoke names it.
--
-- ⚠️ A DECLINED MATCH TAKES NO MORE LINES, and every other status does: a challenge is a fair place
-- to say "your move whenever", and a finished game is where "good game" goes. Unfriending closes it
-- both ways, as it closes the match itself.
--
-- ROLLBACK: docs/2026-11-18-lab-match-chat.ROLLBACK.sql. CHECKS: …checks.sql beside it.
-- TESTED: on the local stack only, by supabase/tests/lab-match-chat.sql and two browsers.

create table public.lab_match_chat (
  id bigint generated always as identity primary key,
  match_id uuid not null references public.lab_matches (id) on delete cascade,
  by_seat smallint not null check (by_seat in (0, 1)),
  body text not null check (char_length(body) between 1 and 300 and body = btrim(body)
                            and body !~ '[[:cntrl:]]'),
  at timestamptz not null default now()
);
create index lab_match_chat_match on public.lab_match_chat (match_id, id);

alter table public.lab_match_chat enable row level security;
revoke all on table public.lab_match_chat from public, anon, authenticated;
revoke all on sequence public.lab_match_chat_id_seq from public, anon, authenticated;

-- One line, from the caller's own seat.
create or replace function public.lab_match_say(p_match uuid, p_body text)
returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  m public.lab_matches := public.lab_match_mine(p_match);
  seat smallint;
  body text := btrim(coalesce(p_body, ''));
  line public.lab_match_chat;
begin
  if public.is_suspended(me) then
    raise exception 'this account cannot chat' using errcode = '42501';
  end if;
  if m.status = 'declined' then
    raise exception 'this challenge was declined' using errcode = '22023';
  end if;
  if body = '' or char_length(body) > 300 or body ~ '[[:cntrl:]]' then
    raise exception 'a line is one line of 1 to 300 characters' using errcode = '22023';
  end if;
  seat := case when me = m.player_a then 0 else 1 end;
  -- one writer at a time per match, so the counts below cannot be raced past
  perform 1 from public.lab_matches where id = m.id for update;
  if (select count(*) from public.lab_match_chat c
       where c.match_id = m.id and c.by_seat = seat and c.at > now() - interval '1 minute') >= 20 then
    raise exception 'slow down: twenty lines a minute is the most' using errcode = '54000';
  end if;
  if (select count(*) from public.lab_match_chat c where c.match_id = m.id) >= 500 then
    raise exception 'this match''s chat is full' using errcode = '54000';
  end if;
  insert into public.lab_match_chat (match_id, by_seat, body)
  values (m.id, seat, body)
  returning * into line;
  return jsonb_build_object('id', line.id, 'seat', line.by_seat, 'body', line.body,
                            'at', line.at, 'mine', true);
end;
$$;

-- The lines after p_after, oldest first: the last hundred of them at most.
create or replace function public.lab_match_lines(p_match uuid, p_after bigint default 0)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  m public.lab_matches := public.lab_match_mine(p_match);
  seat smallint := case when me = m.player_a then 0 else 1 end;
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', l.id, 'seat', l.by_seat, 'body', l.body,
                                        'at', l.at, 'mine', l.by_seat = seat) order by l.id)
      from (select * from public.lab_match_chat c
             where c.match_id = m.id and c.id > coalesce(p_after, 0)
             order by c.id desc limit 100) l
  ), '[]'::jsonb);
end;
$$;

-- a grant is not a revoke: a new function is executable by PUBLIC, and anon holds execute here
revoke all on function public.lab_match_say(uuid, text) from public, anon;
revoke all on function public.lab_match_lines(uuid, bigint) from public, anon;
grant execute on function public.lab_match_say(uuid, text) to authenticated;
grant execute on function public.lab_match_lines(uuid, bigint) to authenticated;
