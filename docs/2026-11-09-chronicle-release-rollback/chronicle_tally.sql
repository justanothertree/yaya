CREATE OR REPLACE FUNCTION public.chronicle_tally(p_asks jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare out_j jsonb := '{}'::jsonb;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_asks is null or jsonb_typeof(p_asks) <> 'array' then return out_j; end if;
  -- ⚠️ raised from 200: thirty windows for each of a few goals is a bigger list than one window
  -- each, and a streak is the whole reason the batch exists. Still bounded.
  if jsonb_array_length(p_asks) > 1200 then raise exception 'too many at once'; end if;

  with ask as (
    select coalesce(x->>'key', x->>'id') as k,
           (x->>'id')::uuid as gid,
           (x->>'from')::timestamptz as f,
           (x->>'to')::timestamptz as t
      from jsonb_array_elements(p_asks) x
  ),
  -- ⚠️ WHAT TO COUNT COMES OFF THE GOAL'S OWN ROW, never off the ask. A caller that could name an
  -- activity could name somebody else's. A goal with neither source is not answered at all, which
  -- is a different claim from answering 0 about it.
  g as (
    select gl.id, gl.counts, gl.activity, gl.cat
      from public.chronicle_goals gl
     where gl.owner = auth.uid()
       and gl.id in (select gid from ask)
       and (gl.activity is not null or gl.cat is not null)
  ),
  /**
   * ⚠️ ONE PASS PER GOAL INSTEAD OF ONE PER WINDOW, and the lower bound is the whole point.
   *
   * The previous shape joined the entries to every ask, and its only lower bound was the ask's own
   * `coalesce(ended_at, now) > from` — which no index can serve. So each of the ~190 windows a
   * streak asks for considered EVERY entry the person had ever made: the cost grew with the
   * product of how long they have used the site and how far back a streak looks. Measured over a
   * synthetic three years (3,293 entries, 192 asks): 656ms, against 14.8ms for this.
   *
   * Every window a goal is asked about sits inside [min(from), max(to)) across its own asks, so
   * bounding the candidates by that span once is lossless — and `started_at < t1` can use
   * chronicle_entries_owner_started. MATERIALIZED is load-bearing: inlined, the planner is free to
   * push the per-ask join back down and re-derive this for each window, which is the cost being
   * removed.
   *
   * ⚠️ AND THE LOWER BOUND ASKS WHETHER THE ENTRY HAD ENDED, NOT WHERE IT STARTED. A sitting that
   * began before the span and ended inside it belongs to it. Asking `started_at >= f0` instead is
   * wrong by whole hours, and a differential sweep of eight random rounds did not notice — because
   * it hung a life-scope window on every goal, which drags min(from) back to the epoch and makes
   * any lower bound a no-op. The honest version gives the life window a goal of its own, and then
   * the mistake is 3,068–4,106 minutes across ~22 keys. See docs/2026-10-13-chronicle-tally-span.sql
   */
  span as (select gid, min(f) as f0, max(t) as t1 from ask group by gid),
  ent as materialized (
    select s.gid, e.id, e.started_at, e.ended_at, e.amount
      from span s
      join g on g.id = s.gid
      join public.chronicle_entries e
        on e.owner = auth.uid()
       and e.started_at < s.t1
       and coalesce(e.ended_at, clock_timestamp()) > s.f0
       and (g.activity is null or e.activity = g.activity)
       -- ⚠️ EXISTS rather than a join, so a category covering five activities cannot multiply the
       -- entry rows it matches — which is exactly how the first attempt went 80x wrong
       and (g.cat is null or exists (
             select 1 from public.chronicle_activities ac
              where ac.id = e.activity and ac.owner = auth.uid() and ac.cat = g.cat))
  )
  select coalesce(jsonb_object_agg(z.k, z.total), '{}'::jsonb) into out_j from (
    select a.k,
           coalesce(sum(
             -- ⚠️ FIRST, AND NOT A TIDY-UP: greatest/least IGNORE NULLs, so a no-match row would
             -- otherwise compute a whole window — 1440 minutes where the answer is 0
             case when en.id is null then 0
                  when g.counts = 'amount'
                  -- the quantity belongs to the session, by where it began
                  then case when en.started_at >= a.f and en.started_at < a.t
                            then coalesce(en.amount, 0) else 0 end
                  else greatest(0, extract(epoch from (
                         least(coalesce(en.ended_at, clock_timestamp()), a.t)
                         - greatest(en.started_at, a.f)))) / 60.0
             end), 0) as total
      from ask a
      join g on g.id = a.gid
      left join ent en
        on en.gid = a.gid
       and en.started_at < a.t
       and coalesce(en.ended_at, clock_timestamp()) > a.f
     group by a.k
  ) z;
  return out_j;
end $function$
