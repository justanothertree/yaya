# Phone alerts: Web Push to a member's phone

Evan, 21 Nov 2026: "start the site-wide phone notification system: alerts when someone calls me
(ring), messages me, posts on my stuff or challenges me to a game, plus Chronicle alarms and
timers, as web push notifications to my Pixel. Write the plan doc first, then build and release it
in steps."

This is the plan. Each step below ships on its own with the standard flow.

**22 Nov:** "Phone notifications: plan, then build up to the point of needing the VAPID secret; ask
me before adding it." The plan was written on 21 Nov and parked. Its facts were re-checked on
22 Nov:

- still no service worker or push code;
- pg_cron 1.6.4, pg_net 0.19.5 and Vault;
- the same four price jobs.

Step 2 below is being built now. It stops where the secret is needed.

## What exists today (mapped 21 Nov 2026)

- **No service worker and no push code anywhere.** `public/site.webmanifest` exists, with
  `display: standalone`. GitHub Pages serves the site from the root of evancook.dev, so
  `public/sw.js` becomes `/sw.js`, whose default scope is the whole site. Pages sends
  `Cache-Control: max-age=600` and cannot set headers, which is fine: browsers re-check a worker
  script on navigation regardless of that header.
- **Every alert today is built in an open tab.** The 🔔 bell (`useNotifications`) polls four RPCs
  and listens to chat inserts. With the site closed, nothing reaches the phone.
- **The server cannot see a DM call start.** A "ring" is derived in the browser from Realtime
  presence on `vp:<room>` (App.tsx:770-820). No RPC runs when a call starts, so a phone with the
  site closed cannot be rung until something tells the server.
- **Messages, guestbook notes and challenges already pass through server functions:**
  `send_chat_message` (the only writer of `chat_messages`), `post_profile_note`, and
  `lab_match_challenge`. Workout comments and kudos are direct inserts under RLS, so only a trigger
  sees them.
- **Chronicle has no alarm or due time.** Its timer is a count-up (`chronicle_entries` with
  `ended_at` null). `Rail.tsx` says alarms would need "a new table, a new permission and a delivery
  mechanism".
- **On the server:** pg_cron 1.6.4, pg_net 0.19.5 and Vault are installed. There are four cron jobs,
  all price refreshes. No trigger calls an edge function today.
  - Those jobs call `finance.refresh_prices()`, which uses the synchronous `http` extension and
    keeps its key in Vault. The outbox trigger below uses pg_net instead. pg_net is asynchronous,
    so a chat message never waits on the network to be inserted.

## Design

### One way out: an outbox, and one function that empties it

```
event (message, note, comment, ring, challenge, alarm due)
  → a row in push_outbox, written by the SQL that saw the event, in its own transaction
  → AFTER INSERT trigger: net.http_post to /functions/v1/push {op: 'send'}
  → the push function claims unsent rows, encrypts each for each of the member's devices,
    POSTs to the push service (FCM, for Chrome on Android), marks the row sent
  + pg_cron once a minute: the same call, to sweep anything missed and anything scheduled
```

- **The SQL that sees the event decides who is told.** The function only delivers what the outbox
  holds. Each decision lives where its data does, so the Lounge rule below sits beside the Lounge
  code.
- **The trigger's call needs no secret.** `op: 'send'` delivers only rows the database queued, once
  each, to their own owners. Anybody calling it can at most make the queue empty a moment sooner.
  So pg_net calls it with the project's public anon key, which is already in every page of the
  site. Sending is idempotent: rows are claimed `for update skip locked`, so a send that overlaps
  the next can never deliver one twice.
- **Watched, not trusted.** pg_net only queues, and a 401 once hid for five days behind a cron that
  reported success. So the function writes `push_outbox.sent_at` and `last_error`, and an admin RPC
  counts unsent rows older than five minutes. A stuck queue shows up as a number, not as a quiet
  phone.

### Tables (all new; deny-all, reached only through SECURITY DEFINER functions)

- **`push_devices`**: `id`, `user_id`, `endpoint` (unique), `p256dh`, `auth`, `label` (e.g.
  "Pixel, Chrome"), `created_at`, `last_ok_at`, `gone_at`. A push service that answers 404 or 410
  marks the device `gone_at` rather than deleting the row, so nothing in this system deletes rows.
- **`push_prefs`**: `user_id` primary key, and one boolean per kind: `ring`, `message`, `post`,
  `challenge`, `chronicle`. The defaults are on, because the member opted in by turning alerts on at
  all.
- **`push_outbox`**: `id`, `user_id`, `kind`, `title`, `body`, `url`, `tag`, `not_before`,
  `created_at`, `sent_at`, `attempts`, `last_error`. `not_before` is what makes a Chronicle alarm
  the same machinery as a message.

The house rules apply to all three: `revoke all … from public, anon` (and from `authenticated`
for the tables), the standing `has_*_privilege` checks from `docs/rpc-inventory.md` run after each
migration, and each table added to `visibility-guards.sql`'s deny-all list.

### What each kind says, and to whom

| Kind      | The SQL that queues it                                                                | Who is told                                                                                                       | Click opens                         |
| --------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| ring      | new `ring(p_room)` RPC, called by the caller's browser as a DM call starts            | the other member of the DM                                                                                        | `#chat?room=`                       |
| message   | `send_chat_message` (a trigger on `chat_messages`)                                    | DMs: the other member. Circuit rooms: members who opted in to group messages (off by default). The Lounge: nobody | `#chat?room=`                       |
| post      | `post_profile_note`, and triggers on `circuit_log_comments` / `circuit_log_reactions` | the owner of the page or the workout                                                                              | `#profile?u=` / `#circuit?tab=feed` |
| challenge | `lab_match_challenge` (Lab's)                                                         | the one challenged                                                                                                | the match                           |
| chronicle | a new `push_at(...)` RPC for Chronicle to call                                        | the member themselves                                                                                             | `#chronicle`                        |

- **The Lounge stays pseudonymous.** A Lounge message is never pushed, and nothing built from
  `chat_messages` names a Lounge author.
- **No echo.** Nobody is ever told about their own message, note or call.
- **Calls are told and not recorded.** `ring` writes an outbox row for the other member and nothing
  else: no "who called whom" table. That keeps the privacy stance in `useVoicePresence.ts`. It is
  limited to one ring per room per caller per 30 seconds, and to members of that DM.
- **Kudos are deduped.** They toggle by delete and insert, so a kudos alert is collapsed by `tag`
  (one per workout per giver), and a second one inside an hour is not queued.
- **Challenges and Chronicle belong to other threads.** For Lab, the plan is one line in
  `lab_match_challenge` (or a trigger on `lab_matches` insert), agreed with the Lab thread first.
  Chronicle gets `push_at(p_when, p_title, p_body, p_url)` and `push_cancel(p_id)`, so its alarms
  and timer-done alerts are its own design; this system only delivers them on time.

### The phone

- **`public/sw.js`**: handles `push` (shows the notification with `tag` and an icon) and
  `notificationclick` (focuses an open tab on the alert's URL, or opens one). It does no fetch
  handling and no caching, so it cannot serve a stale site.
- **Turning it on**: "📱 Phone alerts" in Account. It asks permission, then
  `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`, saves the device with
  `push_device_add`, and offers a toggle per kind plus "Send a test". Turning it off unsubscribes
  and marks the device gone.
- **A ring is a ring.** It's a notification with `requireInteraction` and a short vibration pattern.
  A web page cannot ring like a phone call, and the alert should not pretend to.

### Encryption, with no new dependency

Web Push is RFC 8291 (aes128gcm payload encryption) plus RFC 8292 (VAPID: an ES256-signed JWT).
Both are done with Deno's WebCrypto (ECDH P-256, HKDF-SHA-256, AES-GCM, ECDSA). They live in a pure
module, `supabase/functions/push/webpush.ts`, tested by vitest against RFC 8291's own worked
example: its keys, salt and expected ciphertext are in the RFC. That makes it the same kind of
test as `verdict.ts`, asked without a deployment.

### Secrets: the one thing to ask for

- **The VAPID key pair.** The public half goes in the client; it is meant to be public. The private
  half becomes the edge-function secret `VAPID_PRIVATE_KEY`.
- **Per the instruction, adding it is asked first.** I will generate the pair locally and show
  Evan exactly what is being added before adding it. The VAPID subject is `https://evancook.dev`,
  not an email address.
- **The public half is a constant in the source** (`src/notify/vapid.ts`), empty until then. The
  📱 Phone alerts section stays hidden while it is empty, so everything else can ship first and
  show nothing.
- **Nothing else is new.** The function reads the project's existing `SUPABASE_*` values, and the
  trigger uses the public anon key.

## Steps, each released on its own

1. **This plan** (docs only).
2. **The plumbing.**
   - The three tables and the device and prefs RPCs (migrations).
   - `sw.js`, and "📱 Phone alerts" in Account with "Send a test".
   - The `push` function with `send` and `test`, and `webpush.ts` with its RFC tests.
   - The outbox trigger and the one-minute cron.
   - **Stops for the VAPID secret.** Everything else can be deployed first; the toggle stays hidden
     until the key exists.
3. **Messages and posts:** DMs, guestbook notes, workout comments and kudos.
4. **Rings:** the `ring` RPC, called from the voice bar as a DM call starts.
5. **Challenges:** agreed with the Lab thread, then one hook.
6. **Chronicle:** `push_at` / `push_cancel` handed to the Chronicle thread, with an example of an
   alarm.

## What can only be checked on the Pixel

Delivery itself (FCM to the phone), how a notification looks and sounds on Android, and
tap-to-open. Everything before that is checked here: the encryption against the RFC's vectors, the
RPCs against the live database in rolled-back transactions, the worker in the Chromium pane
(`showNotification` from a test push), and the queue's numbers. The first real delivery is Evan's
phone, with "Send a test".

## Step 2, as built: the server (22 Nov 2026)

Not applied and not deployed. The client half (`sw.js`, "📱 Phone alerts") is built separately.

- **`docs/2026-11-22-phone-alerts.DRAFT.sql`**: the three tables, plus `push_deliveries` and
  `push_config`, all deny-all. Member RPCs: `push_device_add`, `push_device_remove`,
  `push_devices_mine`, `push_prefs_get`, `push_prefs_set` and `push_test`. Service-role RPCs:
  `push_claim`, `push_delivery`, `push_device_gone`, `push_done` and `push_expire`. Admin RPC:
  `push_stuck`. Also the kick, its statement trigger and the one-minute `push-sweep` cron.
- **`supabase/tests/phone-alerts.sql`**, run by a new db-guards step after the draft is loaded.
  The visibility guards then run a second time, so H and K see the new functions.
- **`supabase/functions/push/`**: `webpush.ts` (pure, WebCrypto only), its test, and `index.ts`.

### Where it differs from the plan above, and why

- **`push_config`**, one row, created empty. The kick reads the URL and the anon key from it, so
  neither is in the repository.
- **`push_outbox.claimed_at`, a two-minute lease.** `for update skip locked` holds only inside
  the claiming transaction, and an RPC is its own transaction. Without the lease, two kicks a
  second apart would both deliver a row.
- **Delivery is kept per device, in `push_deliveries`.** One row per alert per device that took
  it, or refused it for good. The first version had one `sent_at` per alert, which was wrong both
  ways: a phone that showed an alert was sent it again on every retry another phone needed (and a
  ring buzzed again each time, because `sw.js` renotifies a ring), and one phone refusing for ever
  held the alert unsent until it was counted stuck. Now:
  - a retry goes only to the devices still waiting;
  - an alert is sent when every live device has taken it or refused it for good;
  - 400, 401, 403 and 413 are for good, recorded once and not retried;
  - 404 and 410 mark the device gone, as before;
  - 429, a 5xx, a timeout and anything else are retried, for that device only.
- **Five tries, then the row stays unsent** and `push_stuck` counts it.
- **A refusal for good is counted too** (`refused_day`, `last_refusal`). It finishes its row, so it is never "stuck", and a VAPID key the push services reject would refuse every device with a 401 or 403 and finish every row quietly. A broken queue must still show as a number.
- **A retry sends what is left of the TTL, and a row with none left expires.** The age is
  measured from when the row became due, on the database's clock. A ring has a minute and the
  lease is two, so a ring is never sent on a retry. `expired_at`, not `sent_at`, because nobody
  was sent it. `push_stuck` does not count it: the queue moved.
- **`tag` is still required.** A device that took an alert is not sent it again, unless the
  function was cut off between the push service's 201 and recording it. Then the retry sends it
  again, and the tag makes the second replace the first without sounding. A ring would sound, but
  a ring is never retried: its minute is gone before its lease is.
- **Endpoints must belong to a push service** (FCM, Mozilla, Apple or Windows). The function
  POSTs to whatever is stored, so an endpoint is a member choosing where the server sends a
  request. `index.ts` does not follow redirects, for the same reason.
- **Ten live devices per member, and 30 new devices a day.** Turning a device off keeps its row,
  so the live cap alone let a member grow the table without limit. The daily cap counts gone ones.
  Turning one of your own back on is not a new device.
- **`op: 'send'` tells its caller nothing.** Anybody with the public anon key can call it, so it
  answers `{"ok":true}` or a 503 `{"error":"not sent"}`. The tally and every reason go to the
  function's log, without endpoints or keys.
- **`last_error` never holds an endpoint.** It keeps a status or an error's name, and the push
  service's host: `403 from fcm.googleapis.com`. A failed fetch's own message names the URL.
- **`push_http_post`** wraps `net.http_post`. A test can replace it on a stack where pg_net
  belongs to someone else, so the kick's checks run on every stack.

### What the client can rely on

- **`push_device_add(endpoint, p256dh, auth, label)`** returns the device id. It accepts
  base64 or base64url keys.
- **`push_device_remove(endpoint)`** returns a boolean.
- **`push_devices_mine()`** returns `[{id, endpoint, label, created_at, last_ok_at}]`, never the
  keys.
- **`push_prefs_get()`** and **`push_prefs_set(p_ring, p_message, p_post, p_challenge,
p_chronicle)`** return the five booleans. A null argument leaves that kind as it was.
- **`push_test()`** returns how many devices the test is going to.
- **Refusals:**
  - `28000`: signed out.
  - `42501`: suspended.
  - `22023`: not a push service, bad keys, or ten devices already.
  - `P0002`: no device.
  - `PT429`: one test a minute, or 30 new devices in a day; PostgREST answers HTTP 429.
- **What the phone receives** is JSON `{kind, title, body, url, tag}`. If it is too big, the body
  is shortened first.

### What was checked

- **`webpush.test.ts`, 30 tests.**
  - Every intermediate value in RFC 8291 Appendix A, and the exact body in §5. The values were
    re-read from rfc-editor.org on 22 Nov.
  - A body the RFC's own browser key opens, with record size 4096 and the 0x02 delimiter.
  - The 4096-octet limit, with one octet over refused.
  - A VAPID JWT that verifies with its `k=`, for the service's origin, under a day, from
    `https://evancook.dev`.
  - The status rule: 201 and 202 delivered, 404 and 410 gone, 400, 401, 403 and 413 final,
    everything else retried.
  - The TTL that is left: a ring is never sent a minute after it was due, or on a retry.
  - What is kept about a failure: the status or error name and the host, never the endpoint, even
    when the error's message carries it. The log line has the endpoint and token-shaped runs taken
    out first.
- **21 bugs were put back one at a time.** 20 turned it red. The one that stayed green was a
  signature check that always passes, because Node refuses a mismatched key pair at import before
  the signature is ever asked (measured). That half is unexercised until it runs on Deno.
- **12 more for the review fixes** (22 Nov), all red: the final statuses, the TTL (whole, unguarded,
  stretched, rounded), the error name, and four ways of leaving a token in the log line.
- **`index.ts` typechecked** with strict settings and a stand-in for `Deno`. Nothing here can run
  it.
- **The SQL runs only in CI.** There is no Postgres on this machine. The first version held 99
  checks there after one fix. The review fixes (per-device delivery, expiry, the daily cap) were
  checked by reading them against the 4 Nov baseline and the seed. Their first run is CI's.
- **A test that reads with a STABLE function must not write in the same expression.** The STABLE
  read sees the snapshot from before the write. The "null label keeps the label" check did exactly
  that, so it could not fail; it is two statements now, and so is every other such check.

### What waits for the secret, and for Evan's yes

1. **Apply the draft as a migration** (ask first). Decide whether to trim `cron.job_run_details`
   at the same time. The sweep adds 1,440 rows a day, an estimated ~80 MB a year (not measured).
   Trimming means a DELETE, so it is Evan's call. `push_outbox` and `push_deliveries` also keep
   every row, at roughly one outbox row per alert and one delivery row per alert per phone. That is
   small for eight people; it is worth a look when the alerts of steps 3 to 6 are flowing.
2. **Deploy `push`**, then diff `get_edge_function` against both files. Before the secret exists,
   POST `{op: 'send'}` must answer the function's own 503 `{"error":"not sent"}`, the log must say
   "phone alerts are not configured", and it must claim nothing.
3. **Generate the VAPID pair locally and show Evan.** Then set the secrets `VAPID_PUBLIC_KEY` and
   `VAPID_PRIVATE_KEY`, and put the public half in `src/notify/vapid.ts`.
4. **Fill `push_config`** with the function's URL and the anon key, as one UPDATE in the
   database. Then read the first kick back from `net._http_response`. It must be the function's
   answer, not the gateway's: the gateway refused the legacy anon JWT on 21 Aug. If it still
   does, deploy `push` with verify_jwt off. That costs nothing, because the key is public.
5. **"Send a test" from the Pixel**, then check that `push_stuck` reads 0 stuck and 0 refused.
