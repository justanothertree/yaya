-- ✅ APPLIED 3 Nov 2026 as `small_fixes_remove_quietly_page_backwards_and_pin_search_path`.
--
-- Three small things from the 3 Nov list.
--
-- 1. `can_see` and `finalize_round_rpc` set `search_path` to 'public' alone where every other
--    SECURITY DEFINER function here names 'pg_temp' too. Postgres puts pg_temp FIRST when it is
--    not named, so a caller who can create a temporary object can shadow an unqualified name.
--    Both qualify their references, so this is belt rather than a live hole.
--
-- 2. ⚠️ TAKING SOMEBODY OUT OF A CIRCLE ARGUED BACK. `visibility_circle_set_member`
--    raised "that is not one of your friends" when the username resolved to nobody or to
--    yourself -- right when adding, wrong when removing, and those two cases are exactly what a
--    tidy-up runs into: a member since deleted, and a stale row for yourself. There is nothing
--    to remove and nothing to say, so it returns.
--
-- 3. ⚠️ THE FEED COULD NOT LOOK BACKWARDS. `feed_recent` asked for the newest
--    `p_per_member` events and filtered to the window afterwards. For the default window -- the
--    last fortnight, ending now -- those are the same thing. For a window ending in the PAST
--    they are not: the newest 40 are all newer than `p_to`, the filter drops every one, and the
--    feed comes back empty instead of old.
--
--    Measured, asking today for a fortnight in September: the old way 7 events, the new way 19.
--    For the default window the content is identical -- compared as a SET over 4 viewers x 14
--    owners, 0 events lost and 0 gained -- and only the order among equal timestamps shifts,
--    because the inner block now sorts explicitly.

/* ── pg_temp on two stragglers ───────────────────────────────────────────────────────────────
   Every other SECURITY DEFINER function here sets `search_path` to 'public', 'pg_temp'. These
   two set only 'public'. Postgres puts pg_temp FIRST when it is not named explicitly, so a
   caller who can create a temporary object can shadow an unqualified name the function resolves.
   Both of these qualify their references, so this is belt rather than a live hole -- but the
   whole point of a standing convention is that nobody has to re-derive that per function. */
alter function public.can_see(uuid, public.visibility_tier) set search_path to 'public', 'pg_temp';
alter function public.finalize_round_rpc(text, text, text, jsonb, jsonb)
  set search_path to 'public', 'pg_temp';

do $mig$
declare
  v_src text;
  v_out text;
begin
  /* ── taking somebody out of a circle should not argue ──────────────────────────────────────
     `visibility_circle_set_member` answers "that is not one of your friends" when the username
     resolves to nobody OR to yourself -- which is right when ADDING, and wrong when removing.
     Removal is how an owner tidies up, and the two cases where it fired are exactly the ones a
     tidy-up runs into: a member who has since been deleted, and a stale row for yourself. There
     is nothing to remove and nothing to tell anybody, so it returns. */
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f' and p.proname = 'visibility_circle_set_member';
  if v_src is null then raise exception 'visibility_circle_set_member not found'; end if;

  v_out := replace(v_src,
    'if v_them is null or v_them = v_me then
    raise exception ''that is not one of your friends'';
  end if;',
    'if v_them is null or v_them = v_me then
    /* nothing to take out, and nothing worth saying about it -- see the migration header */
    if not coalesce(p_in, false) then return; end if;
    raise exception ''that is not one of your friends'';
  end if;');
  if v_out = v_src then raise exception 'the circle refusal block was not found'; end if;
  execute v_out;

  /* ── the feed could not look backwards ─────────────────────────────────────────────────────
     `feed_recent` asked `get_member_activity` for the newest `p_per_member` events and THEN
     filtered them to the window. For the default window -- the last fortnight, ending now --
     that is the same thing. For any window ending in the PAST it is not: the newest 40 events
     are all newer than `p_to`, the filter drops every one, and the feed comes back empty rather
     than old. Nothing in the client pages backwards yet, which is why it has never been seen.

     Fetching a wider slice and capping AFTER the filter costs nothing in the common case (a
     member with fewer than 200 events returns the same rows) and makes the window mean what it
     says. The cap still applies, so the output size is unchanged. */
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f' and p.proname = 'feed_recent';
  if v_src is null then raise exception 'feed_recent not found'; end if;

  v_out := replace(v_src,
    'select jsonb_agg(e || jsonb_build_object(''who'', r.who, ''name'', r.name,
                                               ''mine'', r.user_id = v_me))
        from jsonb_array_elements(public.get_member_activity(r.who, p_per_member)) e
       where e ? ''at''
         and (e->>''at'')::timestamptz >= v_from
         and (e->>''at'')::timestamptz <  v_to',
    'select jsonb_agg(q.e || jsonb_build_object(''who'', r.who, ''name'', r.name,
                                                 ''mine'', r.user_id = v_me))
        from (
          select e
            from jsonb_array_elements(
                   public.get_member_activity(r.who, greatest(p_per_member, 200))) e
           where e ? ''at''
             and (e->>''at'')::timestamptz >= v_from
             and (e->>''at'')::timestamptz <  v_to
           order by (e->>''at'')::timestamptz desc
           limit p_per_member
        ) q(e)');
  if v_out = v_src then raise exception 'the feed per-member block was not found'; end if;
  execute v_out;
end
$mig$;
