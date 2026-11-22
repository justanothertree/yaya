-- ROLLBACK for docs/2026-11-22-chat-songs.DRAFT.sql: every object it created, gone.
--
-- ⚠️ THIS DROPS A TABLE, SO IT DELETES ITS ROWS, and is run only with Evan's yes. Before it runs on
-- production, every object those rows name must be deleted from R2 first (their keys:
-- `select key from public.chat_song_files where object_gone_at is null`), or the bucket keeps
-- recordings nothing can find any more. The messages the songs were sent in are ordinary chat
-- messages and stay; they read as `🎵 Name (m:ss)` text, which is what an older bundle shows anyway.
--
-- db-guards' perturbation runs use it between variants, so it is run on a throwaway stack on every
-- such run, against the draft it undoes.

drop trigger if exists chat_song_files_message_gone on public.chat_song_files;
drop function if exists public.chat_song_claim(uuid, text, integer, numeric, text);
drop function if exists public.chat_song_ready(uuid, uuid);
drop function if exists public.send_chat_song(uuid);
drop function if exists public.chat_songs_in(uuid);
drop function if exists public.chat_song_get(uuid);
drop function if exists public.chat_song_remove(uuid);
drop function if exists public.chat_song_abandoned();
drop function if exists public.chat_song_gone(uuid, uuid);
drop function if exists public.chat_songs_mine();
drop function if exists public.chat_song_files_message_gone();
drop table if exists public.chat_song_files;
