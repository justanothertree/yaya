-- ✅ APPLIED to production 17 Nov 2026 (UTC) as migration `lab_match_nudge`, version 20261117003350, with Evan's
-- approval of the Lab by-turns queue. Production recorded md5(statements[1]) =
-- 3a800bb1841dd09037c43545fc817bd8 over 1,274 bytes, this file's body byte for byte. Block A of the
-- checks matched what was tested beside it before the apply. Block B: the nine realtime.messages policies in place, lab_match_topic_member callable by
-- authenticated and not anon, and the five spot checks t, f, f, f, f.
-- Why, and the rollback: docs/2026-11-16-lab-match-nudge.DRAFT.sql and the files beside it.

create or replace function public.lab_match_topic_member(p_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  raw text;
begin
  raw := substring(
    p_topic
    from '^labmatch:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$'
  );
  if raw is null or auth.uid() is null then
    return false;
  end if;
  return exists (
    select 1
    from public.lab_matches m
    where m.id = raw::uuid
      and auth.uid() in (m.player_a, m.player_b)
  );
end;
$$;

-- a grant is not a revoke: a new function is executable by PUBLIC, and anon holds execute here
revoke all on function public.lab_match_topic_member(text) from public, anon;
grant execute on function public.lab_match_topic_member(text) to authenticated;

create policy "lab matches: players can listen"
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension in ('broadcast', 'presence')
  and public.lab_match_topic_member((select realtime.topic()))
);

create policy "lab matches: players can nudge"
on realtime.messages
for insert
to authenticated
with check (
  realtime.messages.extension in ('broadcast', 'presence')
  and public.lab_match_topic_member((select realtime.topic()))
);