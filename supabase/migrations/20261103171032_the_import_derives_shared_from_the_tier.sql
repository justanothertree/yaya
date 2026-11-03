-- ✅ APPLIED 3 Nov 2026 as `the_import_derives_shared_from_the_tier`.
--
-- ⚠️ A FILE SAYING `private` RESTORED AS SHARED-WITH-FRIENDS. `chronicle_import`
-- passed the file's RAW boolean as `shared` and the helper's clamped tier as `visibility`, and
-- the lockstep trigger's INSERT rule hands the decision to the boolean whenever the tier is
-- `private` -- the one ambiguity written down in that trigger's own header, met by a real
-- caller. So a file carrying visibility `private` with shared `true` came back **friends/true**:
-- a privacy regression that only shows up on restore, which is exactly when nobody is looking.
--
-- `shared` is now derived from the helper's RESULT, so the two can no longer disagree.
--
-- Measured before and after, on six shapes of file:
--
--   file said                              before          after
--   visibility private, shared true        friends/true    private/false   <- the bug
--   visibility friends                     friends/true    friends/true
--   old file, boolean only, true           friends/true    friends/true    <- still restores
--   old file, boolean only, false          private/false   private/false
--   visibility certain, shared true        certain/false   certain/false
--   visibility public (above the cap)      friends/true    friends/true    <- still capped
--
-- ⚠️ THE MIGRATION IS A SUBSTITUTION, NOT A REWRITTEN FUNCTION, and the reason is in
-- the body. Fifteen thousand bytes retyped to change two expressions is the transcription risk
-- CLAUDE.md records as having put the literal string PLACEHOLDER into a live edge function.
-- Rewriting from `pg_get_functiondef` means every byte that is not the change comes from the
-- database. The assertions -- exactly two occurrences, and the result must differ -- make it
-- safe to do without reading 15kB of diff.

do $mig$
declare
  v_src  text;
  v_out  text;
  v_hits int;
  v_old  constant text := 'coalesce((x->>''shared'')::boolean, false)';
  v_new  constant text := '(public.chronicle_tier_from_file(x->>''visibility'', (x->>''shared'')::boolean, me) in (''friends'',''members'',''public''))';
begin
  /* A SURGICAL SUBSTITUTION RATHER THAN A RETYPED FUNCTION, ON PURPOSE.
     `chronicle_import` is 15,297 bytes and the change is two expressions. Reproducing the whole
     body to alter forty characters is the transcription risk CLAUDE.md records as having put the
     literal string PLACEHOLDER into a live edge function -- and there is no diff to look at on
     the way in. Rewriting it from `pg_get_functiondef` means every byte that is not the change
     comes from the database itself and cannot be mistyped.

     The assertions are what make it safe to do this blind: the fragment must appear EXACTLY
     twice, and the result must differ. Verified before writing this that both occurrences are
     the `shared` column's value -- one in the activities insert after `(x->>'session_mins')::int`
     and one in the goals insert -- and that no third use exists. */
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f' and p.proname = 'chronicle_import';
  if v_src is null then raise exception 'chronicle_import not found'; end if;

  v_hits := (length(v_src) - length(replace(v_src, v_old, ''))) / length(v_old);
  if v_hits <> 2 then
    raise exception 'expected the raw boolean exactly twice, found % -- refusing to guess', v_hits;
  end if;

  v_out := replace(v_src, v_old, v_new);
  if v_out = v_src then raise exception 'substitution did not apply'; end if;

  execute v_out;
end
$mig$;
