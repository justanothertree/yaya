# Lab matches by turns: live for Reversi and Chess

_15 Nov 2026. Steps 2–5 of `2026-11-14-lab-async-matches-plan.md`, released together with Evan's
approval._

## What is live

- **The SQL**, migration `20261115002456_lab_matches_and_results`. Its fingerprints and its block
  B checks are in `2026-11-14-lab-matches.checks.sql`; the apply is recorded in that draft's header.
- **The `lab-move` edge function**, version 1, deployed with `verify_jwt` on. After the deploy:
  - `get_edge_function` returned both files byte for byte as they are in git:
    - `index.ts` md5 `f312256c04a7fd9752a4fcf36f800a72`;
    - `core.bundle.js` md5 `db3ef1e2ddec1e9d6873be0f3e1363cd`.
      These are figures with a date on them; the next deploy changes them.
  - A preflight carrying a made-up header got it echoed back.
  - The publishable key as the bearer got the function's own `{"error":"not authenticated"}`,
    not the gateway's sentence.
- **The client** (`src/lab/matches/`):
  - 🎲 **Challenge a friend** in Reversi and Chess: versus, or together against the computer at a
    level you choose.
  - **Every match has its own address**, `#lab?demo=chess&match=<id>`. It opens straight into the
    match, from a bookmark, the bell or a pasted link, and only for its two players.
  - **A move is chosen, then sent.** Send and Undo sit after the board, and stay at the bottom of
    a phone's screen while the board is in view.
  - **Accept, Decline, Resign** (asked in the page), **Claim the win** after 7 days, **Rematch**,
    **Copy link**.
  - **Your games** at the top of the Lab, ones waiting on you first.
  - **The bell** names a match waiting on you; the **badge** counts it, and opening the bell does
    not clear it.
  - **An open match looks again** on focus and every 20 seconds while it waits on the other player.
    There is no realtime channel yet; that is step 11's optional nudge.

## Not yet

- **Pool (step 7)** needs its own `Rules`, a redeploy and a `lab_match_playable` replace, and the
  plan asks for the determinism and CPU measurements first. It was left out of this release rather
  than rushed into it.
- **The profile's Challenge button and the Feed event** (steps 5 and 6) are still to come.
  Challenging is from the toy for now.

## How it was checked, and how to check it again

The edge runtime image cannot be pulled through this sandbox's proxy, so the function ran under
Deno 2.9.6, which is the same runtime family on a different host. Everything else was the real
thing: Postgres 17, GoTrue, PostgREST, the dev server, and three signed-in browsers.

1. **Start the stack.** `pgrep dockerd || nohup dockerd &`, then `supabase start -x
storage-api,imgproxy,realtime,studio,edge-runtime,logflare,vector,supavisor,mailpit,postgres-meta`
   from a scratch copy of `supabase/`. Apply the catalog migration and then the matches migration
   with psql.
2. **Seed it.**
   - Give the seed's users passwords, and set their `auth.users` token columns from NULL to `''`.
     GoTrue answers "Database error querying schema" otherwise.
   - Make owner and friend accepted friends.
   - Insert `reversi` and `chess` into `lab_demos`.
3. **Run the function.** `deno run --node-modules-dir=none --no-config --allow-net --allow-env
--allow-read supabase/functions/lab-move/index.ts`, with `SUPABASE_URL`, `SUPABASE_ANON_KEY` and
   `SUPABASE_SERVICE_ROLE_KEY` from `supabase status`. `--node-modules-dir=none` matters: Deno
   otherwise finds the repo's `node_modules` and refuses the `jsr:` import.
4. **Proxy it.** A ten-line node proxy on one port sends `/functions/v1/lab-move` to Deno and
   everything else to the gateway. That way `supabase.functions.invoke` and the RPCs share the one
   `VITE_SUPABASE_URL`.
5. **Start the app** with that URL and the local anon key, on `localhost:5173`, which the function's
   origin list allows.
6. **Sign people in** by writing GoTrue's token response into `localStorage['sb-127-auth-token']`
   before the page loads.

The play-through, 29 of 29:

- **The challenge:**
  - Ann challenges Bo from Reversi.
  - Bo's bell counts it and links to the match's own address.
  - Your games marks it as his.
  - He accepts on a 390px phone.
- **The stranger:** a stranger with the link reads "There's no match here for you.", word for word
  what a made-up id gets.
- **The moves:**
  - Ann chooses by keyboard, undoes, chooses again and sends.
  - Bo taps a square on the bottom row; Send stays on screen and uncovered, and lands.
  - No sideways scroll.
- **The finish:**
  - Ann resigns through the in-page confirm.
  - Both read the right result, and Rematch is offered.
  - `lab_results` holds `lost:match@1` and `won:match@1`.
- **Together:** in together Chess, the computer's reply came back in the same move, and the turn
  passed to Bo.
- **Leaving:** "Back to playing alone" leaves the address and the match.

The tests:

- `src/lab/matches/games.test.ts` checks the browser's toy list against the server's. A changed
  default size turned it red.
- `words.test.ts` covers every state's words and the bell's entry. A bell entry for a finished
  match turned it red.
