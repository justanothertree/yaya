-- 2026-09-16 — a pet block on a profile
--
-- ⏳ NOT YET APPLIED. The Supabase connector was erroring when this was written, so this one is
--    for you to run. Everything on the client side is already live and degrades honestly: 'pet'
--    is in NEEDS_SERVER_SUPPORT, so until this runs, adding a Pet block and saving says
--    "the 🐾 Pet block needs a one-time database change that hasn't been applied yet" and offers
--    "Take the 🐾 Pet block out and save the rest". Nothing is lost either way.
--
--    Mark it ✅ APPLIED once it is in.
--
--
-- WHAT THIS IS FOR
--
-- One word in one allowlist. save_my_profile_blocks keeps its own list of block types and rejects
-- the WHOLE payload if any block is not on it — so an unknown type does not fail to save itself,
-- it stops the page saving at all. That is why the client carries NEEDS_SERVER_SUPPORT: to turn
-- "invalid block" into a sentence somebody can act on.
--
-- ⚠️ THE CONFIG IS NOTHING NEW. A pet block holds packed drawings under `pets`, the same shape the
-- art block already holds under `art`, read back through the same validator and drawn by the
-- visitor's own browser. No table, no storage, no new column — see
-- docs/2026-09-15-pets-are-drawings.sql for why a pet is a drawing with a name.
--
-- ⚠️ NOTHING ELSE IN THE FUNCTION CHANGES, including the 20-block cap, the size and visibility
-- checks, and the delete-then-reinsert that gives a save its ordering. The only difference from
-- what is live today is the two lines marked below.

create or replace function public.save_my_profile_blocks(p_blocks jsonb)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_me uuid := auth.uid();
  v_count int;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if jsonb_typeof(p_blocks) <> 'array' then raise exception 'p_blocks must be an array'; end if;

  -- ⚠️ ASSIGNED, not `select count(*) into v_count`. The two are identical in plpgsql, but the
  -- SQL editor lints the body as top-level SQL, where `select … into name` is the archaic
  -- spelling of CREATE TABLE AS — so it reports "creates a table without RLS: v_count" every
  -- time this file is opened. It never created a table; a warning you have to dismiss to
  -- proceed is a warning you stop reading, and that habit is worth more than one line of style.
  v_count := (select count(*) from jsonb_array_elements(p_blocks));
  if v_count > 20 then raise exception 'too many blocks (max 20)'; end if;

  if exists (
    select 1 from jsonb_array_elements(p_blocks) e
    where (e->>'block_type') not in (
            'bio','banner','stats','activity','guestbook','status','trophies',
            'song','visualizer','art','looks',
            -- text at any size, face and alignment, or no text at all and just a shape
            'free',
            -- ⚠️ THE ADDITION. Holds packed drawings, the same shape 'art' holds, checked by the
            -- same 16000-character cap below and by readPet on the way out.
            'pet'
          )
       or (e->>'size') not in ('small','medium','large')
       or coalesce(e->>'visibility','members') not in ('public','friends','members','private')
       or length(e->>'config') > 16000
  ) then
    raise exception 'invalid block';
  end if;

  delete from public.profile_blocks where user_id = v_me;

  insert into public.profile_blocks (user_id, block_type, position, size, config, visibility)
  select v_me,
         e->>'block_type',
         (row_number() over ())::int,
         e->>'size',
         coalesce(e->'config','{}'::jsonb),
         coalesce(e->>'visibility','members')::public.visibility_tier
  from jsonb_array_elements(p_blocks) e;
end;
$function$;


-- ── HOW TO CHECK IT ─────────────────────────────────────────────────────────────────────────
-- That the function now knows the word — expect true:
--
--   select position('''pet''' in pg_get_functiondef(p.oid)) > 0 as has_pet
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'save_my_profile_blocks';
--
-- And who has one:
--
--   select p.username, b.size, b.visibility, jsonb_array_length(b.config->'pets') as pets
--     from public.profile_blocks b join public.profiles p on p.user_id = b.user_id
--    where b.block_type = 'pet';
--
-- The honest test is the editor: add a 🐾 Pet block and save. Before this runs it refuses with a
-- sentence; after, it saves.
