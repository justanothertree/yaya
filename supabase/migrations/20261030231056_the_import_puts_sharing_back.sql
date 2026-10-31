-- ✅ APPLIED 30 Oct 2026 as `the_import_puts_sharing_back`.
--
-- Phase 5 opens with the live half of Phase 4's leftovers: a restore now puts sharing back.
--
-- ⚠️ THE GOALS HALF WAS A LIVE BUG AND HAD BEEN SINCE EXPORTS EXISTED. `chronicle_import` never
-- wrote `shared` for a goal, and until the previous migration the export never carried it
-- either — so a goal somebody had put on their profile came back from every restore unshared.
-- Fail-closed, so nothing ever leaked; a setting silently lost, which is §8 read backwards: the
-- caller forgot a column and the restore erased it.
--
-- The activities half was not reachable — nothing can set `certain` yet — but it is fixed in the
-- same pass because the two inserts have the same shape and splitting them would leave one of
-- them wrong for no reason.
--
-- ⚠️ BOTH COLUMNS ARE PASSED AND THE TRIGGER RECONCILES THEM, which is what makes this work for
-- old files and new ones at once. A file written before the tier existed carries only `shared`,
-- so `chronicle_tier_from_file` derives the tier from it; a file written after carries
-- `visibility`, so the tier decides and the trigger rewrites `shared` to match. Passing one and
-- not the other would make the restored value depend on which vintage of file you happened to
-- have.
--
-- ⚠️ AND THE NEW HELPER CLAMPS TWICE, DELIBERATELY. Once by the owner's ceiling, because a file
-- is a write path and a restore is exactly how a level chosen under an older, wider ceiling
-- would otherwise come back; and once at `friends`, because the chronicle tables cap there.
-- Without the second clamp a file saying `members` would be refused by the CHECK and the whole
-- row lost — with it, the row comes back at the widest level it is allowed to have.
--
-- An unrecognised value falls back to the boolean rather than refusing the row, which is this
-- function's convention everywhere else: correct what can be corrected, refuse only what cannot
-- be put back at all.
--
-- ⚠️ THIS FILE STILL CONTAINS THE PLANS BUG. The plans insert below lists seven columns and
-- supplies eight values — a `picture` subquery copy-pasted from the entries loop, for a column
-- `chronicle_plans` does not have. It was already there and is reproduced faithfully; the very
-- next migration (`plans_can_be_put_back_at_all`) removes it, after the round-trip test caught
-- it. Recorded as applied rather than quietly corrected here, because that is what ran.

create or replace function public.chronicle_tier_from_file(p_vis text, p_shared boolean, p_owner uuid)
returns public.visibility_tier
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  /* What a restored row's tier should be, from whatever the file happens to carry.

     ⚠️ TOLERANT OF AN OLD FILE AND OF A FUTURE ONE. A file written before the tier existed has
     only `shared`, so the boolean decides; one written after has `visibility`, so the tier does.
     A value this database does not recognise -- a level added later, a typo, a hand-edited file --
     falls back to the boolean rather than refusing the row, which is this function's own
     convention everywhere else: correct what can be corrected, refuse only what cannot be put
     back at all.

     ⚠️ CLAMPED TWICE, DELIBERATELY. Once by the owner's ceiling, because a file is a write path
     and every write path has to respect it -- a restore is exactly how a level chosen under an
     older, wider ceiling would otherwise come back. And once at `friends`, because a
     sitting-by-sitting timeline is friends-only and the chronicle tables cap there. Without the
     second clamp a file saying `members` would be refused by the CHECK and the whole row lost;
     with it the row comes back at the widest level it is allowed to have. */
  select least(
    public.clamp_visibility(
      p_owner,
      case when p_vis in ('private','certain','friends','members','public')
           then p_vis::public.visibility_tier
           else (case when coalesce(p_shared, false) then 'friends' else 'private' end)::public.visibility_tier
      end),
    'friends'::public.visibility_tier);
$function$;

revoke all on function public.chronicle_tier_from_file(text, boolean, uuid) from public, anon, authenticated;

create or replace function public.chronicle_import(p_doc jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  me uuid := auth.uid();
  x jsonb;
  n_act int := 0; n_ent int := 0; n_goal int := 0; n_rout int := 0; n_plan int := 0;
  refused int := 0;
  total int;
  /* the two ceilings that live in a FUNCTION rather than in a constraint — see the header */
  v_acts int; v_goals int;
begin
  if me is null then raise exception 'not authenticated'; end if;
  if p_doc is null or jsonb_typeof(p_doc) <> 'object' then raise exception 'not a chronicle file'; end if;
  /* ⚠️ the same question `countBackup` asks of the other backup: is this one of ours at all. A
     file that is not gets a refusal, never a silent import of nothing. */
  if p_doc->>'kind' is distinct from 'chronicle' then raise exception 'not a chronicle file'; end if;
  if coalesce((p_doc->>'version')::int, 0) > 1 then raise exception 'that file is from a newer version'; end if;

  total := coalesce(jsonb_array_length(p_doc->'activities'), 0)
         + coalesce(jsonb_array_length(p_doc->'entries'), 0)
         + coalesce(jsonb_array_length(p_doc->'goals'), 0)
         + coalesce(jsonb_array_length(p_doc->'routines'), 0)
         + coalesce(jsonb_array_length(p_doc->'plans'), 0);
  /* three years of three sittings a day is ~3,300 rows; this is an outer wall, not a target */
  if total > 50000 then raise exception 'that file is too big to put back in one go'; end if;

  /**
   * ⚠️ ADDS, NEVER REPLACES, and `on conflict (id) do nothing` is doing two jobs at once.
   *
   * The first is the promise the Account page already makes about the other backup: putting one
   * back adds what is missing and leaves everything you already have alone. Restoring onto a
   * machine that has been used since must not overwrite the newer thing with the older one.
   *
   * The second is a door. The ids in the file are the ids the rows had, and a file can be edited
   * by anybody — so an import naming a row id that belongs to SOMEBODY ELSE must not write to it.
   * `do nothing` on the primary key means it cannot: the row exists, so the insert is skipped,
   * and the owner of that row is never consulted or changed. There is no code path here that
   * updates an existing row, which is why there is no code path that can update a stranger's.
   *
   * ⚠️ AND `owner` COMES FROM auth.uid(), NEVER FROM THE FILE. The export deliberately leaves it
   * out; this would ignore it if it were there.
   */

  /**
   * ⚠️ ROW BY ROW, INSIDE ITS OWN EXCEPTION BLOCK, which is slower than a set-based insert and is
   * the only honest way to do it. Every one of these tables carries check constraints — a goal's
   * unit must accompany its target, an entry must end after it starts, a category must be one of
   * three words — and a single set-based statement fails ENTIRELY on the first row that breaks
   * one. The alternative is restating those constraints as WHERE clauses up here, which is a
   * second copy of the rules that drifts from the table the moment either changes. So the table
   * stays the one authority, a row it refuses is counted, and the rest still go in.
   */
  select count(*) into v_acts from public.chronicle_activities where owner = me;
  select count(*) into v_goals from public.chronicle_goals where owner = me;

  for x in select * from jsonb_array_elements(coalesce(p_doc->'activities', '[]'::jsonb)) loop
    begin
      /**
       * ⚠️ THE CEILING chronicle_activity_save KEEPS, kept here too. It is not a CHECK — it
       * counts other rows, which a constraint cannot do — so it was enforced on exactly one way
       * in, and a file was the other. Counted once before the loop and carried, rather than a
       * count(*) per row, which would be quadratic on a large file.
       *
       * ⚠️ REFUSED PER ROW, NOT PER FILE, which is this function's own convention: the rest of
       * the restore still goes in and the refusal is reported back. Failing the whole file would
       * throw away the entries and goals that were never the problem.
       */
      if v_acts >= 200 then refused := refused + 1; continue; end if;
      insert into public.chronicle_activities
        (id, owner, name, cat, colour, archived_at, created_at, auto, metric, session_mins, shared,
         visibility)
      values (
        (x->>'id')::uuid, me, x->>'name', x->>'cat', x->>'colour',
        (x->>'archived_at')::timestamptz,
        coalesce((x->>'created_at')::timestamptz, now()),
        coalesce((x->>'auto')::boolean, false),
        x->>'metric', (x->>'session_mins')::int, coalesce((x->>'shared')::boolean, false),
        /* ⚠️ BOTH ARE PASSED AND THE TRIGGER RECONCILES THEM. An old file carries only `shared`,
           so chronicle_tier_from_file derives the tier from it; a new file carries `visibility`,
           so the tier decides and the trigger rewrites `shared` to match. Passing one and not
           the other would make the answer depend on which file you happened to restore. */
        public.chronicle_tier_from_file(x->>'visibility', (x->>'shared')::boolean, me))
      on conflict (id) do nothing;
      if found then n_act := n_act + 1; v_acts := v_acts + 1; else refused := refused + 1; end if;
    exception when others then refused := refused + 1;
    end;
  end loop;

  for x in select * from jsonb_array_elements(coalesce(p_doc->'routines', '[]'::jsonb)) loop
    begin
      insert into public.chronicle_routines (id, owner, name, steps, created_at, updated_at)
      values ((x->>'id')::uuid, me, x->>'name', coalesce(x->'steps', '[]'::jsonb),
              coalesce((x->>'created_at')::timestamptz, now()),
              coalesce((x->>'updated_at')::timestamptz, now()))
      on conflict (id) do nothing;
      if found then n_rout := n_rout + 1; else refused := refused + 1; end if;
    exception when others then refused := refused + 1;
    end;
  end loop;

  /**
   * ⚠️ EVERYTHING BELOW POINTS AT AN ACTIVITY, and one that is not yours is not a row to import —
   * it is a row to drop. Without this check the foreign key raises, which the block would catch
   * and count, so the difference is only in what the person is told; with it, "skipped" means a
   * row that genuinely could not be put back rather than one naming an activity that was about to
   * be inserted by the loop above. The activities go in FIRST for that reason.
   */
  for x in select * from jsonb_array_elements(coalesce(p_doc->'entries', '[]'::jsonb)) loop
    begin
      /**
       * ⚠️ THE TWO SPAN RULES THE TABLE CANNOT HOLD, restated here and nowhere else.
       *
       * The note above says restating the table's constraints as WHERE clauses up here is a
       * second copy that drifts, and it is right: "an entry must end after it starts" is
       * chronicle_entry_span's job and this loop lets the table refuse it. But a sitting no
       * longer than a day, and one that has not happened yet, are NOT table constraints — they
       * live in chronicle_entry_add and chronicle_entry_edit, and a file was the third write path
       * that kept neither. "You cannot have spent time on a day you have not lived" held
       * everywhere except through ⬆ Put one back.
       *
       * ⚠️ AND NEITHER CAN BECOME A CONSTRAINT. The future one is not immutable, so Postgres will
       * not have it. The 24-hour one could be — and must not be: chronicle_start and
       * chronicle_stop close a forgotten timer with `ended_at = clock_timestamp()`, so a timer
       * left running over a weekend would fail that constraint and lock somebody out of starting
       * anything at all. The loop is the only place either can live.
       *
       * ⚠️ A RUNNING ENTRY HAS NO END, so the duration test is NULL for one and `or` leaves the
       * decision to the other two — which is right, an open sitting has no length yet.
       *
       * Counted as refused like every other row this cannot put back, so the tally the person is
       * shown stays true.
       */
      if not exists (select 1 from public.chronicle_activities a
                      where a.id = (x->>'activity')::uuid and a.owner = me)
         or (x->>'ended_at')::timestamptz - (x->>'started_at')::timestamptz > interval '24 hours'
         or (x->>'started_at')::timestamptz > clock_timestamp() then
        refused := refused + 1;
      else
        insert into public.chronicle_entries
          (id, owner, activity, started_at, ended_at, amount, quality, created_at, picture)
        values (
          (x->>'id')::uuid, me, (x->>'activity')::uuid,
          (x->>'started_at')::timestamptz, (x->>'ended_at')::timestamptz,
          (x->>'amount')::numeric, (x->>'quality')::smallint,
          coalesce((x->>'created_at')::timestamptz, now()),
          (select m.id from public.member_pictures m
            where m.id = nullif(btrim(coalesce(x->>'picture','')),'')::uuid and m.owner = me))
        on conflict (id) do nothing;
        if found then
          n_ent := n_ent + 1;
          /* ⚠️ ONLY FOR A ROW THAT ACTUALLY WENT IN. `found` is false for an entry this file
             re-offers that the account already holds, and hanging its notes on an id that was
             skipped would attach them to the copy already there — doubling a journal on every
             put-back, which is the one thing an import that "adds what is missing" must not do. */
          if nullif(btrim(coalesce(x->>'note','')),'') is not null then
            insert into public.chronicle_notes (owner, entry, at, body)
            values (me, (x->>'id')::uuid,
                    coalesce((x->>'ended_at')::timestamptz, (x->>'started_at')::timestamptz, now()),
                    left(btrim(x->>'note'), 4000));
          end if;
          insert into public.chronicle_notes (owner, entry, at, body)
          select me, (x->>'id')::uuid,
                 coalesce((nt->>'at')::timestamptz, now()),
                 btrim(nt->>'body')
            from jsonb_array_elements(coalesce(x->'notes', '[]'::jsonb)) nt
           where btrim(coalesce(nt->>'body','')) <> ''
             and length(btrim(nt->>'body')) <= 4000;
        else refused := refused + 1; end if;
      end if;
    exception when others then refused := refused + 1;
    end;
  end loop;

  for x in select * from jsonb_array_elements(coalesce(p_doc->'goals', '[]'::jsonb)) loop
    begin
      /* ⚠️ the same ceiling story as the activities above — chronicle_goal_save raises at 500 */
      if v_goals >= 500 then refused := refused + 1; continue; end if;
      if x->>'activity' is not null
         and not exists (select 1 from public.chronicle_activities a
                          where a.id = (x->>'activity')::uuid and a.owner = me) then
        refused := refused + 1;
      else
        insert into public.chronicle_goals
          (id, owner, title, scope, anchor, repeat_every, target, unit, progress, done_at,
           note, sort, activity, cat, counts, est_mins, priority, created_at, updated_at,
           shared, visibility)
        values (
          (x->>'id')::uuid, me, x->>'title', x->>'scope', (x->>'anchor')::date,
          (x->>'repeat_every')::int, (x->>'target')::numeric, x->>'unit',
          coalesce((x->>'progress')::numeric, 0), (x->>'done_at')::timestamptz,
          x->>'note', coalesce((x->>'sort')::int, 0), (x->>'activity')::uuid, x->>'cat',
          /**
           * ⚠️ AN AMOUNT NEEDS AN ACTIVITY THAT COUNTS ONE, and the table only knows half of it.
           * `chronicle_goal_amount_needs_one_activity` says counts='amount' needs AN activity;
           * it cannot say that activity must name a metric, and that half lives in
           * chronicle_goal_save. A file was the second way in and kept only the table's half, so
           * ⬆ Put one back could restore a goal counting a quantity its source never records —
           * one that reads 0 for ever with the minutes sitting in the totals above it.
           *
           * ⚠️ CORRECTED, NOT REFUSED, which is what chronicle_goal_save does with the same
           * pairing: the goal is still a goal somebody wrote down, it just measures time instead.
           * Refusing would drop the row out of the file and count it as skipped.
           */
          case when coalesce(x->>'counts', 'minutes') = 'amount'
                    and exists (select 1 from public.chronicle_activities a
                                 where a.id = (x->>'activity')::uuid and a.owner = me
                                   and nullif(btrim(coalesce(a.metric, '')), '') is not null)
               then 'amount' else 'minutes' end, (x->>'est_mins')::int,
          coalesce((x->>'priority')::smallint, 0),
          coalesce((x->>'created_at')::timestamptz, now()),
          coalesce((x->>'updated_at')::timestamptz, now()),
          /* ⚠️ NEITHER OF THESE WAS HERE AND `shared` NEVER HAS BEEN. A goal somebody put on
             their profile came back from every restore unshared, since exports existed. It was
             fail-closed, so nothing leaked; it was a setting silently lost, which is the §8
             shape read backwards — the caller forgot a column and the restore erased it. */
          coalesce((x->>'shared')::boolean, false),
          public.chronicle_tier_from_file(x->>'visibility', (x->>'shared')::boolean, me))
        on conflict (id) do nothing;
        if found then n_goal := n_goal + 1; v_goals := v_goals + 1; else refused := refused + 1; end if;
      end if;
    exception when others then refused := refused + 1;
    end;
  end loop;

  for x in select * from jsonb_array_elements(coalesce(p_doc->'plans', '[]'::jsonb)) loop
    begin
      if not exists (select 1 from public.chronicle_activities a
                      where a.id = (x->>'activity')::uuid and a.owner = me) then
        refused := refused + 1;
      else
        insert into public.chronicle_plans
          (id, owner, activity, starts_at, ends_at, note, created_at)
        values (
          (x->>'id')::uuid, me, (x->>'activity')::uuid,
          (x->>'starts_at')::timestamptz, (x->>'ends_at')::timestamptz, x->>'note',
          coalesce((x->>'created_at')::timestamptz, now()),
          (select m.id from public.member_pictures m
            where m.id = nullif(btrim(coalesce(x->>'picture','')),'')::uuid and m.owner = me))
        on conflict (id) do nothing;
        if found then n_plan := n_plan + 1; else refused := refused + 1; end if;
      end if;
    exception when others then refused := refused + 1;
    end;
  end loop;

  return jsonb_build_object(
    'activities', n_act, 'entries', n_ent, 'goals', n_goal,
    'routines', n_rout, 'plans', n_plan, 'skipped', refused);
end $function$;
