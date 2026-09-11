-- ─────────────────────────────────────────────────────────────────────────────
-- A "Looks" profile block: publish a few saved themes so visitors can try them.
--
-- ⚠️ ONE WORD IS THE WHOLE CHANGE. save_my_profile_blocks validates block_type against a list
-- written inside the function, and it rejects the ENTIRE payload if any block is not on it —
-- so without this, adding a Looks block does not fail to save itself, it stops the whole page
-- saving, and the only thing the person is told is "invalid block". That is exactly what
-- happened when the Art block was added; see docs/2026-09-02-site-content-and-art-block.sql.
--
-- ⚠️ NOTHING ELSE NEEDS CHANGING. There is no CHECK constraint on profile_blocks.block_type
-- (verified against the live schema), config is free-form jsonb the function already stores
-- verbatim, and get_profile_blocks / get_demo_profile return every block rather than filtering
-- by type. The looks themselves ride inside config, so no new column either.
--
-- ⚠️ AND THE LENGTH CAP STILL APPLIES. config is capped at 16000 characters per block, which is
-- the only limit on how many looks somebody can publish — roughly forty of them. The client
-- counts the same way before it sends, so this limit is reached with a message rather than a
-- rejection.
--
-- Safe to run more than once.
-- ─────────────────────────────────────────────────────────────────────────────

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
            'song','visualizer','art','looks'          -- <- 'looks' is the addition
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

-- Check it took: should list 'looks' among the allowed types.
--   select pg_get_functiondef('public.save_my_profile_blocks(jsonb)'::regprocedure) like '%looks%';
