-- ✅ APPLIED to production 9 Nov 2026 (stamped 20261110025520 in UTC) as migration `chronicle_day_notes`,
-- step 6 of the Chronicle release, docs/2026-11-09-chronicle-release-plan.md. Production
-- recorded md5(statements[1]) = 6ff0be4698dd786f220f0b033a6cbcdb, this file's body byte for byte
-- (supabase/migrations/applied.md5).
--
-- 18a: a note with no session. The body is docs/2026-11-08-chronicle-day-notes.DRAFT.sql after its
-- leading comment block, which holds the reasoning, the tests and the rollback. Before step 1,
-- check A held: the six functions the release patches were byte for byte what run C7 tested.
-- After this step, check C (all 26 functions as C7 left them) and check D (nothing open) held.

alter table public.chronicle_notes alter column entry drop not null;
alter table public.chronicle_notes add column if not exists on_day date;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chronicle_note_placed') then
    alter table public.chronicle_notes add constraint chronicle_note_placed
      check ((entry is not null and on_day is null) or (entry is null and on_day is not null));
  end if;
end $$;
create index if not exists chronicle_notes_by_day
  on public.chronicle_notes (owner, on_day) where entry is null;

-- ── THE WRITER ──────────────────────────────────────────────────────────────────────────────
-- Edit and delete need nothing new: `chronicle_note_edit` and `chronicle_note_drop` already work
-- by id and owner, and an emptied note is deleted — the rule that is right for a journal.

create or replace function public.chronicle_day_note_add(p_day date, p_body text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_id uuid; v_body text := btrim(coalesce(p_body, '')); v_n int;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  if v_body = '' then raise exception 'nothing to write down'; end if;
  if length(v_body) > 4000 then raise exception 'that is longer than a note — 4000 characters'; end if;
  -- ⚠️ NOT A DAY NOBODY HAS HAD — UTC's date plus one, because the member's zone is not known here
  if p_day is null or p_day > (now() at time zone 'utc')::date + 1 then
    raise exception 'that day has not come yet';
  end if;
  -- the same ceiling a sitting has, for the same reason every list here has one
  select count(*) into v_n from public.chronicle_notes
   where owner = auth.uid() and entry is null and on_day = p_day;
  if v_n >= 50 then raise exception 'that is 50 notes on one day'; end if;
  insert into public.chronicle_notes (owner, entry, on_day, body)
  values (auth.uid(), null, p_day, v_body) returning id into v_id;
  return v_id;
end $$;

revoke all on function public.chronicle_day_note_add(date, text) from public, anon;
grant execute on function public.chronicle_day_note_add(date, text) to authenticated;

-- ── THE READER ──────────────────────────────────────────────────────────────────────────────

create or replace function public.chronicle_day_notes_between(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  -- the same two refusals, in the same words, as chronicle_entries_between
  if p_from is null or p_to is null or p_to <= p_from then
    raise exception 'that range ends before it starts';
  end if;
  if p_to - p_from > 400 then raise exception 'that is too long a range'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', n.id, 'on', to_char(n.on_day, 'YYYY-MM-DD'), 'at', n.at, 'body', n.body)
           order by n.on_day desc, n.at desc, n.id)
      from public.chronicle_notes n
     where n.owner = auth.uid() and n.entry is null
       and n.on_day >= p_from and n.on_day < p_to
  ), '[]'::jsonb);
end $$;

revoke all on function public.chronicle_day_notes_between(date, date) from public, anon;
grant execute on function public.chronicle_day_notes_between(date, date) to authenticated;

-- ── THE EXPORT AND THE IMPORT ───────────────────────────────────────────────────────────────
-- Patched in place, each substitution asserted to match exactly once — see the marks draft.
--
-- ⚠️ NO ID IN THE FILE, like a sitting's notes: an id is this account's and a file is not. A day
-- note has no sitting to be skipped along with, so the import's add-never-replace is on the note
-- itself — the same day, moment and words already here means it is skipped, and putting one file
-- back twice does not write a journal twice.

do $mig$
declare
  r record;
  v_src text;
  v_hits int;
  v_done int := 0;
begin
  for r in
    select * from (values
      ('chronicle_export',
       E'''plans'', coalesce((',
       E'''day_notes'', coalesce((\n'
       || E'      select jsonb_agg(jsonb_build_object(\n'
       || E'               ''on_day'', dn.on_day, ''at'', dn.at, ''body'', dn.body)\n'
       || E'             order by dn.on_day, dn.at, dn.id)\n'
       || E'        from public.chronicle_notes dn where dn.owner = me and dn.entry is null), ''[]''::jsonb),\n'
       || E'    ''plans'', coalesce(('),
      ('chronicle_import',
       E'refused int := 0;',
       E'refused int := 0; n_note int := 0;'),
      ('chronicle_import',
       E'+ coalesce(jsonb_array_length(p_doc->''routines''), 0)',
       E'+ coalesce(jsonb_array_length(p_doc->''routines''), 0)\n'
       || E'         + coalesce(jsonb_array_length(p_doc->''day_notes''), 0)'),
      ('chronicle_import',
       E'  for x in select * from jsonb_array_elements(coalesce(p_doc->''plans'', ''[]''::jsonb)) loop',
       E'  /* ⚠️ A NOTE WITH NO SITTING keeps the writer''s rules here too — a day that has come, and\n'
       || E'     fifty to a day — and is skipped when the same day, moment and words are already here */\n'
       || E'  for x in select * from jsonb_array_elements(coalesce(p_doc->''day_notes'', ''[]''::jsonb)) loop\n'
       || E'    begin\n'
       || E'      if (x->>''on_day'')::date > (now() at time zone ''utc'')::date + 1\n'
       || E'         or (select count(*) from public.chronicle_notes dn\n'
       || E'              where dn.owner = me and dn.entry is null\n'
       || E'                and dn.on_day = (x->>''on_day'')::date) >= 50\n'
       || E'         or exists (select 1 from public.chronicle_notes dn\n'
       || E'                     where dn.owner = me and dn.entry is null\n'
       || E'                       and dn.on_day = (x->>''on_day'')::date\n'
       || E'                       and dn.at = (x->>''at'')::timestamptz\n'
       || E'                       and dn.body = btrim(x->>''body'')) then\n'
       || E'        refused := refused + 1;\n'
       || E'      else\n'
       || E'        insert into public.chronicle_notes (owner, entry, on_day, at, body)\n'
       || E'        values (me, null, (x->>''on_day'')::date,\n'
       || E'                coalesce((x->>''at'')::timestamptz, now()), btrim(x->>''body''));\n'
       || E'        n_note := n_note + 1;\n'
       || E'      end if;\n'
       || E'    exception when others then refused := refused + 1;\n'
       || E'    end;\n'
       || E'  end loop;\n\n'
       || E'  for x in select * from jsonb_array_elements(coalesce(p_doc->''plans'', ''[]''::jsonb)) loop'),
      ('chronicle_import',
       E'''skipped'', refused);',
       E'''notes'', n_note, ''skipped'', refused);')
    ) as v(fn, old, new)
  loop
    select pg_get_functiondef(p.oid) into v_src
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f' and p.proname = r.fn;
    if v_src is null then raise exception 'function % not found', r.fn; end if;

    v_hits := (length(v_src) - length(replace(v_src, r.old, ''))) / length(r.old);
    if v_hits <> 1 then
      raise exception 'expected 1 of [%] in %, found %', r.old, r.fn, v_hits;
    end if;

    execute replace(v_src, r.old, r.new);
    v_done := v_done + 1;
  end loop;
  if v_done <> 5 then raise exception 'expected 5 substitutions, made %', v_done; end if;
end $mig$;

-- ⚠️ THE OTHER ORDER. Applied BEFORE the marks draft, this changes one line that draft keys on —
-- the import's result line, where `'notes', n_note,` now sits before `'skipped'`. Found by writing
-- this note, not by running it: the marks draft's fifth substitution keyed on the whole line, and
-- was changed (on `chronicle/marks-wired`) to key on `'plans', n_plan, ` alone, which neither
-- draft moves. Both orders are run in the scratch harness.
