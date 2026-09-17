# The park needed a place, not a call — 2026-09-16

The first persistent shared room on the site. This is the transport decision and what the first
slice deliberately leaves out, because everything else in the park idea is built on top of it.

## What was already there, and why it was not enough

Drawing together and calling already work, and they work well: `party/` carries pointers at 15Hz
with per-person colour and clock sync, and `PartyCursors` already moves peers in an animation
frame rather than a render. That is the exact shape a multiplayer game needs.

It is **call-scoped**. `party/transport.ts` sends through `voiceSession`, a WebRTC data channel
between people already in a call — right for "come and do this with me", and structurally unable
to be somewhere you walk into and find somebody. A call is something you are invited to. A park is
already there whether you are or not.

## Why the relay, and not Supabase Realtime

Supabase is already in the project and its Realtime product would need no server code at all,
which made it the obvious first answer. It is the wrong one here:

- **Hosted realtime is billed per message, and a position channel is a firehose.** Fifteen
  packets a second per person, fanned out to everyone else, is the one traffic shape that makes a
  metered product expensive fastest. The relay is a process that is already running; its marginal
  cost per message is zero.
- **The relay already knows who people are.** `auth` verifies a Supabase token server-side and
  never trusts a client-supplied id — that rule took a real bug to get right (see the note on it
  in `ws-server.js`), and it comes free.
- **It already has the parts a public room needs**: rooms, connection rate limiting per address
  and globally, a 32KB message cap, `MAX_ROOMS`, and a ping/pong heartbeat so a half-open socket
  cannot pin a room open.
- CLAUDE.md §5: prefer an existing capability over a new service. One home per thing.

The cost is that the park now shares a process with `/ice`, which every voice call depends on.
That is why every park message has a ceiling on it rather than only a validator.

## What the relay learned

Two messages, and both are refused outside a room whose id is `park` or `park:…`:

- `look` — a name and a packed drawing, stored once per person and handed to whoever arrives next
- `walk` — x, y, facing, moving, about fifteen times a second

Three ceilings, because this room is meant to sit there rather than exist around a round:

|                    |                                                                      |
| ------------------ | -------------------------------------------------------------------- |
| `MAX_LOOK_BYTES`   | 12,000 — the only thing a park stores per person                     |
| `MAX_PARK_CLIENTS` | 24 — so a roster broadcast cannot grow without limit                 |
| `WALK_BURST`       | 45 per second — the client sends 15; a console can send ten thousand |

**The relay never looks inside a drawing.** A look is stored and forwarded as an opaque blob with
a size limit, exactly as a chat line is forwarded as text. `readDrawing` on the client is the
security boundary for what a stroke list may contain — the same door a backup file and a
stranger's gallery file come through. A relay that parsed pictures would be a second, worse copy
of that check, running somewhere it cannot be fixed.

Departures needed no new message: the relay already tells a room when somebody leaves it.

## Measured against the running relay

Eight checks, against a real server rather than a mock:

|                                                           |                                      |
| --------------------------------------------------------- | ------------------------------------ |
| a roster reaches somebody who arrives later, with the art | yes                                  |
| a look reaches people already standing there              | yes                                  |
| `x: 'abc'`, `y: Infinity`, `f: 99`, `x: -5`, `y: 1e30`    | clamped to the field, nothing thrown |
| a 400-stroke creature                                     | refused, `look-too-big`              |
| 400 positions in a burst                                  | 42 relayed                           |
| `look` / `walk` in a Snake room                           | ignored                              |
| somebody leaving                                          | seen by the room                     |
| the relay after all of the above                          | still up                             |

And end to end in two browsers: two people in one park, each seeing the other's creature, a walk
on one screen landing at the same coordinate on the other, depth sorted by who is nearer the
camera, and a departure clearing the one who left.

## The bug that only a second browser could find

The look was sent from `NetClient`'s `onOpen` — which fires **before** the class sends its own
hello. So it reached the relay while the socket had joined no room, and the relay drops everything
that is not a hello until one arrives. The first person into the park was visible to herself and
to nobody else, and the roster handed to the second arrival was empty. It goes out on `welcome`
now, which is the relay confirming the join and the first moment a look can land anywhere. That is
also the right moment after a reconnect.

Nothing about this is visible with one client open, which is the whole argument for testing a
networked feature with two.

## What this slice leaves out, on purpose

No tiles, no props, no hats, no collectables, no collision, one field. The riskiest unknown in the
whole idea was several hand-drawn creatures moving around a persistent shared space over a
network — not the art, and not the editors, which are the parts already known to work. Everything
else is additive and each piece is small.

## Still open

- **The relay has to be redeployed** for any of this to exist outside a laptop. The client is
  harmless against an old relay: `look` and `walk` are ignored, and the park is an empty field.
- **Nobody is checked at the door.** The socket is unauthenticated and accepts any origin, which
  was true before the park and matters more now that a room is persistent and public — anybody who
  can reach the relay can stand in the park under any name. The relay can already verify a
  Supabase token (`auth`); requiring it, or marking vouched-for names, is a decision about who the
  park is for.
- **Names are not moderated here.** Snake's handle rules and profanity list sit in the game
  module; the park reads the same stored handle and does not re-check it.
- Nothing is persisted. An empty park is deleted like any other room, so the world has no memory
  yet — which is fine while there is nothing in it to remember.
