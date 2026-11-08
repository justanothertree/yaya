# The jam stops echoing — 8 Nov 2026

Found by #35's two-room test (`src/party/jam.test.ts`) and named there rather than fixed, because
#35 was about saving and this changes what a live jam sends. **Stacked on #35**, which holds the
test and `JAM_CEILINGS`.

## The bug, on main today

A layer you make goes to everyone in the jam. Two paths sent it straight back to you, and you
applied your own layer **as somebody else had read it**:

1. **Receiving it.** The receiver's echo guard (`sentLayers.set`) was written after
   `putSharedLayer`. The looper notifies synchronously, so the jam's own diff ran _inside_
   `putSharedLayer`, before the guard existed, saw a layer it had never sent, and sent it.
2. **Somebody joining.** A newcomer's `jam:want` made every machine clear every record and re-send
   every layer it held — partners' included, each as that machine had read it.

What you heard: one wasted round trip per edit and a `releaseLayer` on your own take that cut its
sounding notes; and, because a partner reads a layer at the jam's ceilings, **a fader above 1.5
dropped to 1.5 at home** the moment anybody joined — two people or three.

## The fix

1. The guard is recorded **before** the layer lands, and put back as it was if the desk turns out
   to be full (nothing landed, so nothing ran).
2. A newcomer's request re-sends **only your own layers**. Every layer's author is in the room —
   an author leaving takes their layers with them — and the author's copy already holds any edit
   somebody else made, so the newcomer gets everything, once, from the machine that owns it.

**Not changed:** the jam's ceilings. A partner's layer above 1.5 still plays at 1.5 on your
machine, and an edit somebody makes to your layer still comes back read at 1.5 — that is the sound
policy waiting for Evan's decision, and it now reaches home only through an actual edit.

## Checked

Two and three real rooms in node (fresh module instances of `jam.ts` and `looper.ts`, a stand-in
party channel and nothing else):

- a partner receiving your 1.8 layer: yours stays **1.8**, **the same object** (nothing released),
  and the partner sends **zero** layer messages
- a third person joining: still 1.8
- a newcomer still gets every layer, **with another player's edit to it** (A's layer arrives muted
  because B muted it) and B's own layer at its own gain
- a partner muting your layer: it comes home muted and at 1.5 — the policy, pinned on its own now
  that the echo no longer pinned it by accident
- three sabotages, each caught: the guard moved back after the put (2 red), the newcomer request
  clearing every record (1 red), clearing none (2 red)

`npm run typecheck`, `eslint . --max-warnings 0`, tests and build — see the PR.

## Not verified

Two real browsers on a relay. CLAUDE.md's stub relay (`scripts/park-stub-relay.mjs`) is the park's
and the jam travels over the voice session's party channel, which these tests stand in for. Nothing
has been listened to.
