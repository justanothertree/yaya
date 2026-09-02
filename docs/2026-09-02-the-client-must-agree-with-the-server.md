# The client must agree with the server, exactly — 2026-09-02

Five bugs in one afternoon, all the same shape. Worth writing down once so the next one is
found by looking rather than by someone hitting it.

## The shape

A Postgres function validates its input. The client has its own idea of the same rule. The two
disagree, and the client is the more generous of the pair — so it lets you build something the
server will refuse, and you find out afterwards, from a message written for the server's benefit
rather than yours.

It goes wrong in four distinct ways, and all four turned up:

1. **The client does not know the rule at all.** The contact form set no length limits, while
   `submit_contact_message` caps name at 200, email at 320 and the message at 5000. You could
   write a long message and only discover the cap on Send, from "that is longer than this form
   accepts" — which does not say which field.

2. **The client knows a rule but measures it differently.** Both profile block pickers reported
   the size of their own field — the song, or the chosen drawings — while
   `save_my_profile_blocks` measures `length(config)`, the whole object. A block could read
   "62% of the room a block has" while what it would send was over the cap. The home editor had
   the same fault against `save_site_content`, for a subtler reason: it counted with
   `JSON.stringify` while Postgres counts `p_doc::text`, and jsonb renders a space after every
   colon and comma. Measured on a representative document, **Postgres counts 312 where the
   browser counts 287 — about 9% more.**

   That 9% is prose, and prose is the friendly case. The profile block picker had the same fault
   against a packed drawing, which is thousands of comma-separated numbers — very nearly one
   extra character each. **Measured on a twelve-stroke drawing: 25.6%.** A config the meter
   showed as 15,999 of 16,000 arrived as about 20,100 and was refused. The fix is not a safety
   margin but the actual number: `JSON.stringify(v).length` plus one per structural separator,
   counted by walking the value so a comma inside a string is not mistaken for one. Verified
   exact against Postgres on a sample containing both.

3. **The client validates leniently and then emits what it was given.** `parseHex` accepts
   `#abc` and a bare `aabbcc`; `loadPalette` checked with it and returned the original string,
   which `set_my_profile_look` then refused for not matching `^#[0-9a-fA-F]{6}$`.

4. **The server's rule is LOOSER than the client's type — and the client believes the type.**
   The first three are about writing. This one is about reading, and it is the dangerous one,
   because the value arrives already wearing a type nobody checked.

   `set_my_profile_look` validates a flair by shape — a lowercase word of 40 characters or fewer
   — and against no list, because a list on the server would need editing every time an effect is
   added. Perfectly reasonable. But `Profile.tsx` then did `theirFlair as FxStyle`, and
   `clickFx.ts` did `BUILDERS[style](...)`, so a string chosen by somebody else was called as a
   function. An id this build has not got is `undefined`, called inside a capture-phase
   `pointerdown` listener, in a file with no `try`/`catch` — every click on that page, for every
   visitor.

   Nobody has to be hostile for this to fire. **A visitor whose tab was opened before a deploy,
   meeting a flair added in it, is exactly this case** — so shipping new effects is itself what
   triggers it. That the same file's backdrop was already checked with `isBackdropId`, three
   lines below, is the whole lesson: one of the two was written carefully and the other was
   written quickly, and nothing in the types could tell them apart.

   The rule that follows: **a cast is not a check, and anything crossing the network is
   untyped no matter what the signature says.** Validate at the boundary, against the structure
   that will actually be indexed — `BUILDERS`, not the picker's list, so the two cannot drift —
   and make the lookup itself fall back, so being wrong costs a default instead of an exception.
   Use `hasOwnProperty`, not `in`: `constructor` is a lowercase word too.

## Why it hurts more than it looks

Two of these functions **reject the entire payload** when any one part of it is wrong.

`save_my_profile_blocks` deletes and rewrites every block in one call, so an Art block — a type
missing from the server's allowlist — did not fail to save itself. It stopped the page saving at
all, and every later edit was silently lost. The only explanation offered was `invalid block`,
which is a statement about the _shape_ of the data for a problem that was really "this type is
not enabled yet" or "this one is too long".

So a mismatch is rarely confined to the thing that mismatched.

## What to do about it

- **Be liberal in what you accept, strict in what you emit.** `loadPalette` still accepts the
  short forms; it now returns the canonical one.
- **Measure what the other end measures.** Not a part of it, and not in a different encoding. If
  the two cannot be identical, the client's budget must be the _smaller_ one — the home editor
  spends 36000 against the server's 40000.
- **Catch it before the request.** An over-long block is now named locally, which is faster,
  spares a round trip that cannot succeed, and can say which block rather than which payload.
- **When the server refuses anyway, name the part.** The Art block failure now says what it is
  and offers to take that block out so the rest saves.
- **Clear the warning when the cause goes.** Removing the offending block returns the page to
  exactly its last-saved state, so no save runs — and the old failure message sat there accusing
  a page that was by then perfectly fine.

## Where the contracts are

Everything below has a rule on the server that the client has to keep in step with. Checked on
2026-09-02; the ones marked ✔ agree.

| Function                 | Server's rule                                                               | Client                                                                                                                                      |
| ------------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `save_my_profile_blocks` | block type allowlist, size, visibility, `length(config) > 16000`, 20 blocks | ✔ after today: the client now adds the jsonb separators Postgres will (see below). `art` still pending the migration, and fails gracefully |
| `save_site_content`      | admin, id, object, `length(p_doc::text) > 40000`                            | ✔ client stops at 36000                                                                                                                    |
| `set_my_profile_look`    | theme in 3, flair/backdrop `^[a-z][a-z0-9_-]*$` ≤ 40, palette 6-digit hex   | ✔ writing: all 33 flair and 19 backdrop ids pass the regex. Reading is case 4 — checked with `isFxStyle` / `isBackdropId` after today      |
| `submit_contact_message` | 200 / 320 / 5000, email pattern, rate limit                                 | ✔ after today                                                                                                                              |

`submit_score` is deliberately excluded: its bounds exist to refuse impossible scores, so the
client agreeing with them is not the point — the server disagreeing is.
