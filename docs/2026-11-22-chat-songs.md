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
- **Your songs in chat** lists every song of yours that counts toward the 25 MB, each with
  **Remove**. It needs no room, so it still works after you leave a circuit, or while you are
  suspended and out of the Lounge.
- **Kept until deleted.** Nothing expires. A song whose message goes with its room (a circuit
  deleted) stops counting.

## The contract both halves build against

### SQL (`supabase/migrations/20261122221602_chat_songs.sql`, applied 22 Nov 2026)

`chat_song_files` is deny-all: RLS on, no policies, no grants. It has no foreign key to the account,
because a row outlives it so its object can still be found. Its columns:

- `id`, `owner`, `key` (`songs/<id>.<ext>`, with no owner in it), `mime`, `bytes`, `seconds`,
  `name`;
- `room_id`, `message_id`, `ready`, `sent_at`, `deleted_at`;
- **`object_gone_at`**, new since the wip draft: when the R2 object was confirmed deleted;
- `created_at`.

| function                                                      | who           | returns                                                                                  |
| ------------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------- |
| `chat_song_claim(p_room, p_mime, p_bytes, p_seconds, p_name)` | authenticated | `table(id, key)`; refuses with a sentence                                                |
| `chat_song_ready(p_id, p_owner)`                              | service_role  | void                                                                                     |
| `send_chat_song(p_id)`                                        | authenticated | the `Msg` columns, like `send_chat_message`                                              |
| `chat_songs_in(p_room)`                                       | authenticated | `table(message_id, file_id, name, seconds, mime, mine, removed)`                         |
| `chat_songs_mine()`                                           | authenticated | `table(file_id, name, seconds, bytes, sent, room_kind)`: yours, not let go, newest first |
| `chat_song_get(p_id)`                                         | authenticated | `table(key, mime)`; one answer for missing, removed and not yours                        |
| `chat_song_remove(p_id)`                                      | authenticated | the key                                                                                  |
| `chat_song_abandoned()`                                       | authenticated | `table(id, key)`: yours, deleted, object not yet confirmed gone, max 20                  |
| `chat_song_gone(p_id, p_owner)`                               | service_role  | void: sets `object_gone_at`                                                              |

`chat_song_pending`, the first draft's way to finish an upload, is gone with the signed PUT.

- **Caps:**
  - 5,242,880 bytes a file;
  - 26,214,400 an account, counting rows with `deleted_at is null`;
  - 900 seconds;
  - a name of 1–60 characters;
  - mime exactly `audio/mp4`, `audio/webm` or `audio/ogg`.
- **An unfinished upload is let go after an hour.** The claim marks it `deleted_at`, and
  `chat_song_abandoned` then hands its key to the function to delete. An unready row exists only
  while an upload request is running, or after one died midway; a ready, unsent one only when the
  send after it failed.
- **A sent song whose message goes is removed.** Nothing a member calls deletes a message, but
  `delete_circuit` takes a circuit's room and messages, and deleting an account takes its DM and
  circuit messages. The foreign key sets `message_id` null; the BEFORE UPDATE trigger
  `chat_song_files_message_gone` then sets `deleted_at`, so the song stops counting, leaves
  `chat_songs_mine`, and is handed back by `chat_song_abandoned`. A song never sent is left alone
  when its room goes: it stays listed (`room_kind` null) until it is removed or the hour lets it go.
- **`chat_songs_in` returns removed songs too**, with `removed = true`, so the thread can say so.
  Sent songs only (`message_id` not null).
- **`chat_songs_mine` has no room check.** It lists exactly what the 25 MB counts, so a member who
  has lost the room (left a circuit; suspended, so out of the Lounge) can still free it.
- **The Lounge stays pseudonymous.** Nothing returns `owner` to a member; `mine` is the only
  answer about it, and `chat_songs_mine` answers only about the caller.

### The edge function `chat-songs` (`supabase/functions/chat-songs/`, not deployed)

Modelled on `pictures`:

- the same R2 secrets, trimmed;
- the same CORS (echo `Access-Control-Request-Headers`);
- `getUser()`, not just a header;
- RPC errors passed through as `{error: sentence}`;
- service role used only for `chat_song_ready` and `chat_song_gone`, with the owner from
  `getUser()`, which both check against the row.

**The browser never writes to R2.** The first draft signed a PUT for it and checked the object
afterwards, but a signed PUT stays good after the check, so a sender could swap any file in, and a
PUT nobody finished left an object no row was completed for. Now the recording is the request:

```ts
supabase.functions.invoke('chat-songs', {
  body: blob, // the recording itself
  headers: {
    'x-song-op': 'upload',
    'x-song-room': roomId, // uuid
    'x-song-mime': mime, // bare: audio/mp4, audio/webm or audio/ogg
    'x-song-seconds': String(wholeSeconds),
    'x-song-name': encodeURIComponent(name),
  },
})
```

| op                            | body                      | answer                       | notes                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------- | ------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `upload` (`x-song-op` header) | the recording, `x-song-*` | `{id}` or `{error}`          | Tidies first (below). Reads the body until it passes 5 MB, then cancels the rest and answers 413; it never holds more than 5 MB (the chunk that passes it is dropped, not kept). Then `chat_song_claim` with the length it holds; `verdictFor` on the bytes in hand; a PUT to R2 signed in the headers, `Content-Type` = the mime; `chat_song_ready(id, caller)` as the service. Any failure after the claim lets it go (below) |
| `play`                        | `{op, id}`                | `{url}`                      | `chat_song_get`, then a signed GET, 3600 s                                                                                                                                                                                                                                                                                                                                                                                      |
| `remove`                      | `{op, id}`                | `{ok: true, orphaned: bool}` | Tidies first. `chat_song_remove`, DELETE (`ok` or 404 counts), then `chat_song_gone`                                                                                                                                                                                                                                                                                                                                            |

- **Tidying**, at the start of every upload and every remove: up to 20 of the caller's
  `chat_song_abandoned`, each DELETEd and then marked `chat_song_gone`. Best effort; nothing is
  refused because it failed.
- **Letting an upload go** after its claim: `chat_song_remove` as the caller, a DELETE of the
  claim's key (asked even when the PUT failed, since a failed PUT may still have landed), then
  `chat_song_gone`. The answer is `{error: sentence}` with a 4xx or 5xx.
- A part of an upload that cannot be read (a room that is not a uuid, a length that is not plain
  digits, a name that does not decode) reaches the claim as null and is refused in the claim's
  words.
- A suspended member may only `play` and `remove`.
- **`verdict.ts` is pure, with no `src/` imports** (Deno deploys it as it is), and
  `verdict.test.ts` checks it:
  - `MAX_BYTES` and `KINDS`;
  - `readAtMost(stream, max)`: the bytes, or `over` as soon as more than `max` arrive, with the
    rest cancelled unread;
  - `uploadFrom(headers)`: the `x-song-*` headers, each null when unreadable;
  - `looksLike(mime, head)`: `ftyp` at offset 4, EBML `1A 45 DF A3`, or `OggS`;
  - `verdictFor(mime, bytes)`: nothing, over 5 MB, a mime that is not exactly one of the three, or
    a head that is not a recording is refused, in the claim's words where the claim has them;
  - `songId(x)`: an op's id, checked before Postgres sees it.

### The client

- **`src/circuit/chatSongs.ts`:**
  - `lengthLabel(seconds)` must give the same `m:ss` as `send_chat_song` builds;
  - `sendSong(room, blob, name, seconds)`: the `upload` invoke above (the blob as the body, the
    bare mime in `x-song-mime`), then `send_chat_song` with the `id` it answers, then the message
    goes into the thread;
  - `songsIn(room)`, `playUrl(id)`, `removeSong(id)`;
  - a list from `chat_songs_mine()`, each with Remove (the `remove` op), for "Your songs in chat";
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

### The server half (SQL, its test, the guards, the function)

**Decided while building, so the client agrees:**

- **The length is whole seconds, rounded down.** 59.999 s reads `0:59` and 125.7 s reads `2:05`.
  `lengthLabel` must floor, never round; the SQL test pins both of those.
- **A name is trimmed, put on one line, and cut to 60 characters**, never refused for being long.
  Only a blank one is refused. It counts characters, not bytes: sixty `é` is a name of sixty.
- **"Unfinished" means not sent.** The hour's sweep also lets go of a song that went up and was
  never sent. Otherwise it would sit in no chat and count toward 25 MB until its owner happened to
  find it in their own list.
- **The claim's refusals, word for word:**
  - `not in this room`
  - `that is not a kind of recording this keeps`
  - `that recording came to nothing`
  - `that one is over 5 MB`
  - `that recording has no length`
  - `that one is over 15 minutes`
  - `needs a name`
  - `your songs in chat come to 25 MB — remove one first`
  - `your account is suspended`
- **A missing RPC comes back from the function as a 404** with "Songs in chat aren't switched on
  yet." (PostgREST's PGRST202), so a function deployed before the migration reads the same as no
  function.
- **The upload is checked on the bytes in hand, and written by the function** (review findings
  #1 and #16). The stored `content-type` is the claimed mime because the function sets it, so
  there is no later measurement to disagree with; `ready`, its HEAD and ranged GET, and
  `chat_song_pending` are gone. The mime must already be bare: `audio/webm;codecs=opus` is refused,
  never rewritten, because it is the row's `mime` and the object's type at once.
- **The claim comes before the verdict**, as the contract orders it: its refusals are the ones a
  member meets, and it takes the account's lock. So a verdict refusal makes and lets go of a row;
  the DELETE that follows answers 404, which counts, and the row is marked gone at once.
- **`chat_song_ready` and `chat_song_gone` take the caller's id from `getUser()`.** No member call
  returns an owner, and every row they reach came from the caller's own claim, remove or
  abandoned list. Both check it against the row, so a wrong one marks nothing.
- **A message going is a removal** (#15), by trigger rather than in each writer, because the
  writers are foreign keys: there is no function to edit. Only not-null to null counts, so a song
  never sent survives its room going and is still the member's to remove.
- **`chat_songs_mine` returns no owner and takes no argument** (#17): the shape itself says it
  answers only about the caller. It is read-only, so block K does not ask it about suspension.
- **Two backstops beyond the contract:**
  - a CHECK that every key is `songs/<uuid>.(m4a|webm|ogg)`, because the function DELETEs
    whatever key a row names;
  - an advisory lock per account in the claim, because the 25 MB sums other rows and two claims
    at once would both read it before either inserted.

**Verified here:**

- `verdict.test.ts` (22 Nov, after the upload moved into the function): 21 tests, every header
  set to something unlike a default and each dropped in turn. Eighteen perturbations of
  `verdict.ts`, each from a scratch copy, each turned the intended test red: 5 MB itself refused,
  the whole body read before deciding, the rest never cancelled, chunks out of order, no body read
  as over, nothing not refused, no ceiling, a 5,000,000 ceiling, a fourth kind, the mime bared and
  lowered, no first-bytes check, MP4 read at offset 0, any room passed on, `Number()` lengths, a
  bad name throwing, the name never decoded, the mime cut at its parameters, any string taken as
  an id. The file was restored byte for byte (md5 compared).
- `index.ts` is outside `npm run typecheck` (it imports `jsr:` and `npm:` and uses `Deno`), so it
  was checked with `tsc --strict` against a scratch shim of those three; the same check on a copy
  with the service-key guard removed fails with "'service' is possibly 'null'".
- `npm run typecheck`, `npm run lint` and the vitest run are green.

**Only CI can check, and nothing here has run the SQL.** There is no Postgres on this machine, so
the draft and `supabase/tests/chat-songs.sql` were reasoned against the baseline's definitions of
`send_chat_message`, `chat_room_member`, `is_suspended`, `leave_circuit`, `delete_circuit` and the
chat tables' foreign keys, not executed. The new section 10 asks the trigger through the claim's
own count: with the account full, each way a message goes must free exactly that song's bytes and
no more. Without the trigger its probes are refused; with a trigger on the room instead, the
never-sent songs come free too and "one byte more" is let through. That is reasoning, not a run.
db-guards.yml loads the draft after putting production's default grants back, runs the test, then
runs the standing guards again with the draft in place: that second run is the only one in which
blocks H and K see these functions.

**Left:**

- `chat_song_files` is not in `visibility-guards.sql` block B, and applying it did not change
  that. CI's guards run on the 4 Nov schema dump before any later migration loads, and
  `has_table_privilege` on a table that does not exist there raises. The chat-songs test asks the
  same question per privilege, `TRUNCATE` included, and checks RLS and that no policy exists.
- Applying the migration and deploying `chat-songs` both wait for Evan's yes. After the deploy:
  diff `get_edge_function` against disk (both files); send a preflight carrying
  `Access-Control-Request-Headers` with the upload's own list (`authorization, apikey,
x-client-info, content-type, x-song-op, x-song-room, x-song-mime, x-song-seconds, x-song-name`);
  and ask the deployed function to refuse an anon-key call with its own
  `{"error":"not authenticated"}` (CLAUDE.md §2).
- **The recorders' first bytes are assumed, not measured.** `ftyp` at offset 4 (Safari), EBML
  (Chrome) and `OggS` (Firefox) are what those containers start with, but no real export from each
  browser has been put through `looksLike`. Do that with one file from each before trusting the
  refusal.
- **Abandoned objects are deleted only when their owner next uploads or removes** (#18, #2).
  Nothing runs on a timer, so an account that never does either again keeps whatever it let go in
  the bucket: a removed song, an upload let go after the hour, a song whose message went. Their
  rows say exactly which keys, so nothing is lost track of, but the bytes stay billed. A deleted
  account is the extreme case: its messages cascade, the trigger marks its sent songs removed, and
  `chat_song_abandoned` is never asked by anybody again. **A periodic sweep closes it**: the
  service, on a schedule, reading every owner's rows with `deleted_at` set and `object_gone_at`
  null, deleting each object and marking it gone. Not built: it needs a cron and a function that
  answers to nobody, which is a decision for Evan.
- **The platform's request size — answered, 22 Nov 2026: it takes 5 MB.** Sent through the gateway
  to `push`, which reads its whole body before answering, a 1 MB body was answered in 0.7 s and a
  5 MB one in 1.4 s (with its own "that was not json", so the bytes reached the function).
- **⚠️ BUT AN UPLOAD REFUSED BEFORE ITS BODY WAS READ WAS NEVER ANSWERED.** The same measurement on
  `chat-songs` v1, as an anonymous caller (refused by `getUser`, before `readAtMost`): 1 KB came
  back in 0.5 s with the function's own 401; 1 MB, 2, 3, 4 and 5 MB uploaded in full and then got
  nothing for 60–90 s, until the client gave up. So a member whose session had gone stale, or a
  suspended one, watched "Sending…" that never ended — and `functions.invoke` has no timeout. The
  fix is `drain` in `verdict.ts`, called by every refusal that can come before `readAtMost`: the
  body is read off and thrown away, unlooked-at, then the answer goes. Its four tests were each
  made to fail by a broken drain. **It needs a redeploy of `chat-songs` to take effect**, and
  after it the same anonymous 1 MB and 5 MB probes must come back with the function's own 401.
  Not covered: a body OVER 5 MB is still cut off at `readAtMost` and may hang the same way; only a
  client ignoring its own 5 MB check sends one.
