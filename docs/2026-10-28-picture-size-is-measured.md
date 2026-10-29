# Every picture ceiling was applied to a number the browser chose

✅ APPLIED — migration `picture_pending_for_size_check`, and `pictures` edge function **v13**.
28 Oct 2026. Part A8 of Yaxa's review.

## What was wrong

`picture_claim` enforces four limits — 2 MB a picture, 256 KB a thumbnail, 500 pictures, 50 MB an
account — against `p_bytes` and `p_thumb_bytes`, which arrive from the page as `full.blob.size`
and `thumb.blob.size`.

It then hands back two presigned PUT URLs from `signFor`, which signs with `signQuery`. That binds
the **method**, the **key** and an **expiry**. It does not bind a content length, so R2 accepts an
object of any size at that key.

`picture_ready(p_id)` then sets `ready = true`. It asks the store nothing.

So the three numbers that decide what an account costs — `bytes`, `thumb_bytes`, and the total the
ceiling sums — were all whatever the browser said they were.

## Measured, not reasoned

On the live database, inside a rolled-back transaction, as a real member:

```
a claim of 1 byte + 1 byte is accepted         e7f2eec5-…/e4e6c281-….webp
picture_ready(id) returned without asking R2   ready = true
what the row now holds                         bytes=1 thumb_bytes=1 ready=t
so the 50 MB ceiling is counting               2 bytes for this picture
```

Five hundred of those is an account at its row limit holding whatever it liked. R2 charges nothing
for egress, which is why it was chosen — it does charge for storage.

Scale at the time: **9 pictures, 1 owner, 3,729,424 bytes claimed, 14 members.** The feature was
two days old, which is why the transition below is cheap.

## What changed

**`picture_pending(p_id uuid)`** — new, read-only, `SECURITY DEFINER`, owner-scoped. Returns the
keys and the claimed sizes for a row the caller owns. `pictures_mine` could not answer this: it
returns READY rows only, and the window that matters is before a row is ready.

It answers **"no such picture"** both for a row somebody else owns and for a row that was never
minted — the same property `get_public_profile` and `sendPasswordReset` are built around, verified
in the same transaction. `anon` and `PUBLIC` have no execute; `authenticated` and `service_role` do.

**`ready` op on the `pictures` edge function** — HEADs both objects, compares `content-length`
against the claim, then either calls `picture_ready` or drops the row **and deletes the objects**.
Deleting the row alone would free the quota while leaving the bytes in the bucket, which is the
half Cloudflare bills for.

**`verdict.ts`** — the decision, in its own file, because an edge function needs a deployed
runtime, a member's JWT and R2 credentials before a line of it runs. 9 tests, 6 perturbations, all
red. One of them caught a bug in the first draft: `Number('')` is `0`, so an empty `content-length`
read as a zero-byte object that exists — a mismatch, which deletes the picture.

The comparison is **exact**, not "within the ceiling": claiming one byte and storing two megabytes
is under every ceiling and nineteen times what the account was charged for. The browser PUTs the
very blob it measured, so there is no honest reason for a tolerance, and a tolerance is a size
somebody can hide inside.

A missing object is refused **without** deleting anything — that is the ordinary shape of an upload
that failed partway, and `picture_claim` already sweeps unready rows after an hour. Deleting there
would turn a flaky connection into lost work on the retry.

**`keepPicture`** now calls the op instead of the RPC, with no fallback. A fallback would quietly
re-enable the thing it replaces and the first anyone would know is a storage bill.

## ~~What is NOT closed~~ ✅ CLOSED 29 Oct 2026

**This section described the state for one day. It is kept because the reasoning in it is why the
close took two migrations rather than one, but what it says is no longer true.**

It said: `picture_ready(uuid)` is still granted to `authenticated`, so a bundle from before this —
or anyone writing RPC calls by hand — can still finish a picture without being measured; the hole
is closed for the site and open to a deliberate caller. And that closing it could not be done alone,
because the edge function calls `picture_ready` with the **caller's** JWT, so the revoke would break
the new path too; it needed the function to make that one call as `service_role`, which needs
`SUPABASE_SERVICE_ROLE_KEY` set on the project — a secret that session could not read or verify.

All of that held. What changed is that the secret turned out to be establishable **from its
effect** rather than by reading it: `refresh-prices` builds its only client from that key and
writes through `upsert_prices`, and `finance.price_cache` held 179 rows updated inside 48 hours.
supabase-js throws on an undefined key and the RPC 401s on a bad one, so that freshness is proof.

It is now closed, in two migrations so there was never a window where uploads were broken:
`20261029090000_picture_ready_as_service.sql` (additive — v13 kept working) and
`20261029091000_picture_ready_revoke.sql`. `pictures` is at **v14**, calling a 2-arg
`picture_ready(uuid, uuid)` as `service_role` with the owner Postgres returned; the 1-arg version is
revoked from `authenticated` and a direct call as a member now answers `42501 permission denied for
function picture_ready`. See `docs/2026-10-29-the-four-drafts-applied.md`.

## Verified here

- The hole, as the transcript above — on the live database, rolled back.
- `picture_pending`: own row returned, another member's row and a non-existent row refused with the
  same sentence, no row changed by asking, `anon`/`PUBLIC` cannot execute.
- Edge function v13 boots and serves: a preflight carrying
  `Access-Control-Request-Headers: x-yaya-ready-probe-1793235153-7c1f` came back **204** with that
  exact string echoed, which is something only this file's `corsFor` invents.
- The deployed source was read back with `get_edge_function` and carries both files.
- `verdict.ts`: 9 tests, 6 perturbations red.
- typecheck, eslint (0 errors), 1,253 tests, build.

## Needs Evan on the live site

**A real upload cannot be exercised from here.** It needs a member session — `previewMember` makes
none, and the pictures room falls back to `pvKeep`, which touches neither Supabase nor R2 — and the
HEAD half needs R2 credentials. So:

1. Keep a picture on evancook.dev and check it appears.
2. Check the gallery's usage figure still reads correctly.
3. If an upload fails at the last step, the message comes from the `ready` op; reverting is one
   commit on `keepPicture` plus nothing on the server, since `picture_ready` is untouched.
