# Sharing an exported song with a friend on the site: a plan, not built

> **Since built, as songs in chat** — `docs/2026-11-22-chat-songs.md`, PR #453, not yet live
> (the SQL waits to be applied and the function to be deployed). The four questions below were
> answered by Evan on 21 Nov 2026, and the names changed on the way: the table is
> `chat_song_files`. What follows is the plan as it was written on 17 Nov.

Evan, 17 Nov 2026: make "Share…" also offer sharing to a friend inside evancook.dev **if a simple
path already exists** (e.g. attaching it to a post or message). If it would need new tables,
production SQL or storage changes, don't build it: write a short plan and stop.

**It needs all three, so this is the plan and nothing is built.** "Share…" still hands the file to the
phone's share sheet (another app), as it did.

## What exists, and why none of it carries the file

An export is an M4A or WebM of about 0.2 MB for 10 seconds (roughly 3 MB for three minutes), or a
WAV ten times that. Every way one member reaches another is refused by the server for it:

| Path            | What it carries             | Why not                                                                                             |
| --------------- | --------------------------- | --------------------------------------------------------------------------------------------------- |
| Chat and DMs    | text                        | `send_chat_message`: `length(p_body) > 2000` raises, and a CHECK on the table says the same         |
| Pictures (R2)   | images                      | `picture_claim` maps only webp/jpeg/png/avif and raises for anything else; 2 MB a file              |
| Your library    | songs as notes, art, looks… | `library_put` takes six kinds and 128 KB; every read is `where user_id = auth.uid()`, so yours only |
| Profile blocks  | JSON config                 | 64,000 characters a block; no audio block type                                                      |
| Guestbook       | text                        | 500 characters                                                                                      |
| A jam's ▶ Open | the song's notes, live      | Realtime broadcast to whoever is in the call; read back through `readSong`, notes only              |

**The nearest thing that exists** is a profile song block. In the profile editor you pick a kept song
and its notes are copied into the block, which visitors play with the synth. It needs nothing new, but
it carries the notes and none of the export: no recording is in it, because a recording is a sound
and not notes. A "Put it on my profile" button beside Share… could open that editor. That's a
different feature from sharing the file, so it's question 1 below rather than something built here.

## The plan, if wanted

The house pattern throughout (CLAUDE.md §3): RLS on, no policies, no grants, reached only through
`SECURITY DEFINER` functions that check `auth.uid()`, revoked `from public, anon`.

1. **Storage: R2, beside the pictures.** CLAUDE.md §5 already says R2 earns its place "when real
   media arrives (rendered audio …)". The small file only, never the WAV.
2. **A table, `song_files`:** owner, R2 key, MIME, bytes, seconds, created, ready. CHECKs:
   - MIME is `audio/mp4`, `audio/webm` or `audio/ogg`;
   - at most 5 MB a file (a 5-minute M4A at 128 kbps is 4.8 MB);
   - a total per account (say 25 MB), enforced in the claim function the way `picture_claim` does.
3. **Functions:** a claim / ready pair that copies `picture_claim` and `picture_ready`, and a
   `song_file_url(id)` that signs a short-lived GET only for somebody allowed to hear it (below).
4. **The edge function:** either a new op in `pictures`, or a small `songs` function. Either way it
   needs the same exact-size check as `verdict.ts` (a HEAD after the PUT, dropped unless the sizes
   match). It should also check the file's first bytes: `ftyp` for M4A, the EBML header for WebM,
   `OggS` for Ogg. The browser can't re-encode audio the way it re-encodes a picture to WebP, so this
   is what stops the bucket hosting any file somebody labels "audio".
5. **Where it shows: a chat message.** A message gains an optional `song_file` reference. Who can
   hear it is the room's members (`chat_room_member`), the rule chat already has, so there's no
   second visibility rule. The message renders as a ▶ player plus the song's name and length.
   **Share… → "Send in a chat"** picks the Lounge or a DM, uploads the small file and sends the
   message.
6. **Deleting:** deleting the message, or the owner deleting the file, removes the R2 object. A
   failed upload's row is swept after an hour, as pictures are.
7. **Cost, worst case:** 8 members × 25 MB is 200 MB of R2 (its free tier is 10 GB, and egress is
   free). The table rows are a few hundred bytes. Around fifty members is the point to revisit the
   per-account cap, as the library's note says.

Each of steps 2–5 is production SQL or an edge-function deploy, so each would come to Evan first, with
the `has_function_privilege('anon', …)` check from `docs/rpc-inventory.md` run after.

## Questions for Evan

1. Want "Put it on my profile" (notes only, nothing new on the server) beside Share… now, while the
   rest waits?
2. Chat attachment (above), or a profile post? Chat reuses a visibility rule that already exists; a
   post would need a new block type and its tiers.
3. Caps: 5 MB a file and 25 MB an account?
4. Keep shared songs until deleted, or let them expire (say 30 days)?
