# Pictures: the bytes in R2, the decisions in Postgres

✅ APPLIED — migrations `member_pictures_table_and_claim` and `picture_rpcs`; edge function
`pictures` deployed (v1, `verify_jwt: true`).

⚠️ **Not reachable until the R2 bucket and its four secrets exist.** Until then the function
answers `503 R2 is not configured on this project yet`, deliberately, rather than a stack trace.

## Why R2 and not Supabase Storage

The first recommendation here was Supabase Storage, on the grounds that it is the one actually
integrated and §5 says one home per thing. That was right for eight people and wrong for a
hundred, which is the number this is now being built for.

**Egress decides it.** Supabase's free plan meters bytes out at the **organisation** level across
database, Storage, Auth, Realtime and Edge Functions together, and exceeding it **restricts the
project** rather than billing it — reports describe a grace period and then HTTP 402 until the
cycle resets. So a busy month of people looking at pictures would take the chronicle, the chat and
sign-in down with it. That is a worse failure than an invoice.

At 100 users viewing ~300 images a month at ~200 KB, that is **6 GB/month** against a 5 GB
allowance shared with everything else. R2 charges nothing for egress at any volume, which is the
single property it exists for.

|                       | R2 free              | Supabase free   |
| --------------------- | -------------------- | --------------- |
| storage               | 10 GB                | ~1 GB           |
| egress                | **free, any volume** | 5 GB/mo, shared |
| knows who a member is | no                   | yes             |

**And "one home per thing" was the wrong citation.** That rule is about the same _content_ living
in two stores that can disagree — the song-plays-but-the-editor-is-empty bug. A picture in R2 with
a row in Postgres pointing at it is a thing and a pointer.

## The shape

```
browser                 pictures (edge fn)            Postgres                R2
  │  squeeze + thumb
  │─ op:'upload' ──────▶│
  │                     │─ picture_claim (as caller) ▶│  ceilings, keys
  │                     │◀── {id, key, thumb_key} ────│
  │◀── 2 presigned PUTs │
  │──────────────────── PUT both, straight to R2 ─────────────────────────────▶│
  │─ picture_ready ────────────────────────────────▶│  row becomes visible
```

**The edge function calls the RPCs as the caller, not as the service role.** Its Supabase client is
built with the caller's own `Authorization` header, so `auth.uid()` inside `picture_claim`,
`pictures_mine` and `picture_drop` is the person at the browser, and every ceiling and ownership
check they already carry applies unchanged. A service-role client would have made that file a
second place where "what may be read" is decided — the thing §3's house pattern exists to prevent.
`refresh-prices` uses the service role because it answers to a cron and belongs to nobody.

**Nothing but small JSON crosses Supabase.** The images go browser↔R2 directly.

## What the database holds

`member_pictures`, in the house pattern: RLS on, **zero policies, no grants**.

> ⚠️ The revoke is the point, and it is why this is in the same migration as the table.
> `public`'s default ACL hands `anon` **and** `authenticated` `arwdDxtm` on every new table, from
> both `postgres` and `supabase_admin` — which is exactly how `profile_blocks` and `profile_notes`
> came to carry 13 grants each while CLAUDE.md said they were deny-all. A new table inherits that
> unless it is taken away.

Verified after: `rls_on=true, policies=0, acl={postgres, service_role}`, and all five functions
`anon=false, authenticated=true, security definer=true`.

**Constraints where a constraint can hold the rule** — 2 MB a picture, 256 KB a thumbnail,
dimensions, a known mime, 300 characters of alt text. These are facts about _this row_. The
per-person ceilings count _other_ rows and cannot be CHECKs, so they live in `picture_claim`,
which is the only path that inserts — stated there, because a second one would have to keep them.

**`alt` has its own writer.** `picture_alt` touches one column, which makes it immune by
construction to §8's erasure: alt is exactly the shape that gets forgotten — optional, written
once, and drawn nowhere a loss would show.

## The ceilings, and the worst case

|          | per person | at 100 people          |
| -------- | ---------- | ---------------------- |
| pictures | 500        | —                      |
| bytes    | 50 MB      | **5 GB of R2's 10 GB** |

Half the free tier at the full hundred, every one of them full. §5 asks for the worst case rather
than the normal one, and this is it.

## What was checked

Fifteen cases in a rolled-back transaction with a simulated session, including the three that
matter most — `picture_ready`, `picture_alt` and `picture_drop` on **another member's** picture all
answer `no such picture`, the same words whether it does not exist or is not yours (§3: never leak
whether a thing exists).

The two per-person ceilings, with controls, because a ceiling that refuses too much is worse than
one that refuses too little:

```
CONTROL · 24 went in, bytes used     50331672 of 52428800
bytes ceiling refuses the 25th       your pictures come to 50 MB — delete one first
CONTROL · a small one still fits     allowed, as it must be
CONTROL · 500 claimed                500
count ceiling refuses the 501st      that is 500 pictures — delete one first
stale claims swept, room again       allowed; rows now 1
```

> The first run of that fixture was wrong, not the function: 25 × 2 MB is exactly 50 MB, and each
> also carried a 1-byte thumbnail — which `picture_claim` counts, correctly, because a thumbnail is
> real storage. The fixture had forgotten the thing the function was built to remember.

The function itself: no `Authorization` → **401** from the platform's own gate; preflight from
`https://evancook.dev` → **204** with that exact origin echoed, which also confirms CORS works
_despite_ `verify_jwt` being on.

## The client

`shrink.ts` is pure and tested — 13 cases — because it has units in it. `fitWithin` never enlarges,
never rounds an edge to zero, and keeps the shape; `nextQuality` walks the quality down to a byte
budget and has to terminate, since each round is a real encode on a phone.

> ⚠️ **A flat ratio tolerance was wrong and the sweep said so.** The shape test first asserted the
> ratio held to within 2% and failed at **5720×9 → 1600×3**: exact is 1600 × 2.52, so rounding to 3
> is 16.1% off. The code is right — whole pixels cannot preserve a ratio better than half a pixel on
> the short side, and on a 3px edge one pixel _is_ 33%. The bound is now `1 / shortEdge`, the
> physical limit, which on an ordinary 1600×1200 is 1/1200.

> ⚠️ **And the panorama fixture never reached zero.** It used 8000×20, which scales to 0.8 and
> rounds to 1 _without any floor_ — so it passed with the floor removed while being named after it.
> 8000×10 scales to 0.4, which is the side of the rounding that produces a zero, and a canvas of
> height 0 throws. Found by perturbing; five perturbations now go red.

`cloud.ts` holds the three hops. Two details worth keeping:

- **The thumbnail is made from the original, not from the squeezed copy.** Encoding an encode
  stacks WebP's artefacts on themselves, and 320px is where that shows first — it is the picture
  most people see most often.
- **A function's refusal is in its body, not in `error.message`.** supabase-js reports a non-2xx
  from `functions.invoke` as "Edge Function returned a non-2xx status code", so every ceiling
  written to be read by a person would arrive as that one useless sentence unless the body is read.

## Still to build

- The room: a file picker, the quality dial with live byte count, a grid of thumbnails.
- A `previewMember` stand-in, or the room renders empty in the workbench and an audit of nothing
  passes — §2 is explicit about this.
- Attaching a picture to a chronicle sitting, a circuit review, or a rating. `member_pictures` is
  deliberately not chronicle-shaped: the picture owns itself and the thing that uses it points at
  it, so one picture can hang off any of them without a polymorphic column.
- Viewing somebody _else's_ picture. `pictures_mine` is yours only; a friend's needs a
  `can_see()`-aware RPC, and that is the same visibility-tier decision still open for chronicles.
