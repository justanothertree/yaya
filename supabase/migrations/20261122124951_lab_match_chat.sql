-- ✅ APPLIED to production 22 Nov 2026 (UTC) as migration `lab_match_chat`, version 20261122124951,
-- with Evan's approval of the Lab by-turns queue. Production recorded md5(statements[1]) =
-- 5c4323e2b3aee06193af60cfaf02cd0d over 5180 bytes, this file's body byte for byte.
-- Block A of the checks matched what was tested beside it before the apply. Block B: both
-- functions by their fingerprints (lab_match_say=b41d31fc,lab_match_lines=82511bea), callable by authenticated and not anon; the
-- table with RLS on, no policy and none of every privilege for anon or authenticated; no lines.
-- Why, and the rollback: docs/applied/2026-11-18-lab-match-chat.DRAFT.sql and
-- docs/2026-11-18-lab-match-chat.ROLLBACK.sql.

create table public.lab_match_chat (
  id bigint generated always as identity primary key,
  match_id uuid not null references public.lab_matches (id) on delete cascade,
  by_seat smallint not null check (by_seat in (0, 1)),
  body text not null check (char_length(body) between 1 and 300 and body = btrim(body)
                            and body !~ '[[:cntrl:]]'),
  at timestamptz not null default now()
);
create index lab_match_chat_match on public.lab_match_chat (match_id, id);
create index lab_match_chat_said on public.lab_match_chat (match_id, by_seat, at);

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
  said_minute bigint;
  said_day bigint;
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
  -- one writer at a time per member, then per match, so none of the counts below can be raced
  -- past: the member's lock covers their lines in every match, the match's row both seats
  perform pg_advisory_xact_lock(hashtextextended('lab_match_chat:' || me::text, 0));
  perform 1 from public.lab_matches where id = m.id for update;
  if (select count(*) from public.lab_match_chat c
       where c.match_id = m.id and c.by_seat = seat and c.at > now() - interval '1 minute') >= 20 then
    raise exception 'slow down: twenty lines a minute is the most' using errcode = '54000';
  end if;
  if (select count(*) from public.lab_match_chat c where c.match_id = m.id) >= 500 then
    raise exception 'this match''s chat is full' using errcode = '54000';
  end if;
  -- and across every match the caller plays, whatever its status, from whichever seat they have in
  -- each: a count per match, so one probe of lab_match_chat_said each and never a scan of
  -- everybody's lines (the draft's header has the measurements). The day is '24 hours' and never
  -- '1 day', which is a calendar day in the session's TimeZone: 23 or 25 hours across a change of
  -- the clocks. A minute is 60 seconds in every zone.
  select coalesce(sum(n.minute), 0), coalesce(sum(n.day), 0) into said_minute, said_day
    from public.lab_matches x
   cross join lateral (
         select count(*) filter (where c.at > now() - interval '1 minute') as minute,
                count(*) as day
           from public.lab_match_chat c
          where c.match_id = x.id and c.by_seat = case when x.player_a = me then 0 else 1 end
            and c.at > now() - interval '24 hours') n
   where me in (x.player_a, x.player_b);
  if said_minute >= 30 then
    raise exception 'slow down: thirty lines a minute across your matches is the most'
      using errcode = '54000';
  end if;
  if said_day >= 500 then
    raise exception 'five hundred lines a day across your matches is the most'
      using errcode = '54000';
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