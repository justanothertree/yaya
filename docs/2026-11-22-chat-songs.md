# Songs in chat: a recording sent into a chat room

Evan, 21 Nov 2026: "shared songs become a chat attachment; caps of 5 MB per file and 25 MB per
account; keep them until deleted." On 22 Nov: "migration through CI first; ask before any production
apply, storage change, or function deploy."

The plan was `docs/2026-11-17-share-a-song-in-site.md`. Its four questions are answered, and its
names changed: the table is `chat_song_files`, not `song_files`.

## What a member sees

- **In the Instrument room**, after ⬇ Export has made a recording, **💬 Send in a chat** sits
  beside Share….
  - It lists the chats you are in: the Lounge if you have joined it, your DMs, and your circuits'
    chats.
  - You pick one. It asks for a name, offering the song's kept name. Then it uploads the small
    file (M4A, WebM or Ogg; never the WAV) and sends one message.
  - It is hidden when the export has no small file (WebKit has no MediaRecorder for it).
- **In the chat**, the message reads `🎵 Name (m:ss)` everywhere only text is shown (the list,
  the 🔔, an older bundle).
  - Where the thread is drawn, it is a ▶ player. The recording is fetched only when ▶ is pressed,
    through a link that lasts an hour.
  - The sender also sees **Remove**. A removed song's message stays and says "🎵 removed by its
    sender".
- **Kept until deleted.** Nothing expires.

## The contract both halves build against

### SQL (`docs/2026-11-22-chat-songs.DRAFT.sql`, not applied)

`chat_song_files` is deny-all: RLS on, no policies, no grants. It has no foreign key to the account,
because a row outlives it so its object can still be found. Its columns:

- `id`, `owner`, `key` (`songs/<id>.<ext>`, with no owner in it), `mime`, `bytes`, `seconds`,
  `name`;
- `room_id`, `message_id`, `ready`, `sent_at`, `deleted_at`;
- **`object_gone_at`**, new since the wip draft: when the R2 object was confirmed deleted;
- `created_at`.

| function                                                      | who           | returns                                                                 |
| ------------------------------------------------------------- | ------------- | ----------------------------------------------------------------------- |
| `chat_song_claim(p_room, p_mime, p_bytes, p_seconds, p_name)` | authenticated | `table(id, key)`; refuses with a sentence                               |
| `chat_song_pending(p_id)`                                     | authenticated | `table(key, mime, bytes, ready, owner)`; empty for anything not yours   |
| `chat_song_ready(p_id, p_owner)`                              | service_role  | void                                                                    |
| `send_chat_song(p_id)`                                        | authenticated | the `Msg` columns, like `send_chat_message`                             |
| `chat_songs_in(p_room)`                                       | authenticated | `table(message_id, file_id, name, seconds, mime, mine, removed)`        |
| `chat_song_get(p_id)`                                         | authenticated | `table(key, mime)`; one answer for missing, removed and not yours       |
| `chat_song_remove(p_id)`                                      | authenticated | the key                                                                 |
| `chat_song_abandoned()`                                       | authenticated | `table(id, key)`: yours, deleted, object not yet confirmed gone, max 20 |
| `chat_song_gone(p_id, p_owner)`                               | service_role  | void: sets `object_gone_at`                                             |

- **Caps:**
  - 5,242,880 bytes a file;
  - 26,214,400 an account, counting rows with `deleted_at is null`;
  - 900 seconds;
  - a name of 1–60 characters;
  - mime exactly `audio/mp4`, `audio/webm` or `audio/ogg`.
- **An unfinished upload is let go after an hour.** The claim marks it `deleted_at`, and
  `chat_song_abandoned` then hands its key to the function to delete.
- **`chat_songs_in` returns removed songs too**, with `removed = true`, so the thread can say so.
  Sent songs only (`message_id` not null).
- **The Lounge stays pseudonymous.** Nothing returns `owner` to a member; `mine` is the only
  answer about it.

### The edge function `chat-songs` (`supabase/functions/chat-songs/`, not deployed)

Modelled on `pictures`:

- the same R2 secrets, trimmed;
- the same CORS (echo `Access-Control-Request-Headers`);
- `getUser()`, not just a header;
- RPC errors passed through as `{error: sentence}`;
- service role used only for `chat_song_ready` and `chat_song_gone`, with the owner read from
  Postgres.

| op       | body                                 | answer                       | notes                                                                                                                                                                                                                                                                           |
| -------- | ------------------------------------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `upload` | `{room, mime, bytes, seconds, name}` | `{id, put}`                  | Deletes up to 20 of the caller's abandoned objects first (`chat_song_abandoned`, DELETE, `chat_song_gone`). `put` is a signed PUT, 300 s                                                                                                                                        |
| `ready`  | `{id}`                               | `{ok: true}` or `{error}`    | HEAD gives the size and `content-type`; a ranged GET of bytes 0–63 gives the head. `verdictFor` decides. A `drop` verdict removes the row (`chat_song_remove`) and deletes the object. Otherwise `chat_song_ready` runs as the service, with the owner from `chat_song_pending` |
| `play`   | `{id}`                               | `{url}`                      | `chat_song_get`, then a signed GET, 3600 s                                                                                                                                                                                                                                      |
| `remove` | `{id}`                               | `{ok: true, orphaned: bool}` | `chat_song_remove`, DELETE (`ok` or 404 counts), then `chat_song_gone`                                                                                                                                                                                                          |

- A suspended member may only `play` and `remove`.
- **`verdict.ts` is pure, with no `src/` imports** (Deno deploys it as it is), and
  `verdict.test.ts` checks it:
  - `MAX_BYTES`;
  - `bareMime(type)`;
  - `looksLike(mime, head)`: `ftyp` at offset 4, EBML `1A 45 DF A3`, or `OggS`;
  - `verdictFor({claimedBytes, mime, seenBytes, seenType, head})`;
  - an object that is missing is not dropped;
  - over 5 MB, a different size, a different content-type, or a head that is not a recording is
    dropped.

### The client

- **`src/circuit/chatSongs.ts`:**
  - `lengthLabel(seconds)` must give the same `m:ss` as `send_chat_song` builds;
  - `sendSong(room, blob, name, seconds)`: upload, then PUT with `Content-Type` set to the bare
    mime, then ready, then `send_chat_song`, then the message goes into the thread;
  - `songsIn(room)`, `playUrl(id)`, `removeSong(id)`;
  - a server without the function or the RPCs (PGRST202, or a 404 from the function) says "Songs
    in chat aren't switched on yet."
- **`src/circuit/roomThread.ts`:**
  - `ThreadState` gains `songs: Record<messageId, ChatSong>`, loaded beside the first read;
  - it is asked again on an INSERT whose body starts with `🎵 `, a cheap filter only. Song-ness is
    never decided from the body;
  - never asked for a call's `'call'` room.
- **`src/circuit/ui/MessageLog.tsx`:** a `songs` prop. A message with a song renders a
  `ChatSongPlayer`: ▶, then an `<audio controls>` once the URL arrives; name and length from the
  row; **Remove** when `mine`. A removed song says so.
- **`src/instrument/ExportSong.tsx`:** **💬 Send in a chat** in the done row. It lists rooms from
  `list_chat_overview`, uses a picker (never `window.prompt`), names the song, and has an
  always-mounted `role="status"` line.
- **A `previewMember` stand-in**, so the pane can draw a song message and the picker.

## Checked, and left

Filled in as it is built.
