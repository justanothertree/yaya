-- Archive: RPC dropped on 2026-08-18 as dead surface.
--
-- Same convention as removed-rpcs-2026-07-30.sql: confirmed unreferenced by a search across the
-- repo (two prose mentions in comments, no callers), kept here so it can be restored by pasting
-- the block back.
--
-- Why it went:
--   get_lounge_names   answered "who has ever opted into the Lounge", which the UI was rendering
--                      under a "N here" label that means "who is here right now" -- that mismatch
--                      is why the Lounge once claimed 5 people were in an empty room. Replaced by
--                      real presence (src/voice/useRoomPresence.ts + the room:<uuid> topic), which
--                      answers the question the label actually asks. Left behind as a privileged
--                      SECURITY DEFINER function that could enumerate every opted-in member's
--                      name with no caller, so it went.
--
-- NOTE: its name-resolution order (lounge_display_name -> first_name -> username) was the CORRECT
-- behaviour and outlived the function -- that precedence now lives in send_chat_message() and
-- my_lounge_display_name(). Don't restore this expecting it to be the only place that knows it.

create or replace function public.get_lounge_names()
returns table(user_id uuid, name text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select p.user_id, coalesce(p.lounge_display_name, p.first_name, p.username::text)
  from public.profiles p
  where coalesce(p.lounge_opt_in, false) = true
    and coalesce(p.suspended, false) = false;
$function$;
