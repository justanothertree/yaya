# The call is the party

Co-presence — seeing each other's pointers, and playing the same instrument together — with no
new realtime topic, no new gate, and no migration.

## The decision that made everything else small

Every version of this feature I sketched first invented a "party" or "session" object: an id, a
membership table, a way to invite people into it, a `party:<id>` realtime topic, and an RLS
policy deciding who may join that topic. That is a second membership system living alongside the
one that already exists, and two systems that answer "who is allowed to hear this?" will
eventually disagree. When they do, the failure is not a broken feature — it is a stranger
watching your cursor.

So there is no party object. **The call is the party.** Co-presence messages ride the existing
`voice:<roomId>` channel as a second broadcast event, which means:

- The audience for your pointer is, by construction, exactly the audience that can already hear
  your voice. Not "the same as" — the same set, from the same gate.
- `voice_topic_member()` was already written, already reviewed, and already refuses anyone who is
  not in the room. Somebody who cannot join the call cannot receive a single one of these
  messages, whatever client they are running.
- There is no new SQL. Nothing to review, nothing to keep in step, nothing to drift.

Sharing the channel costs nothing in contention either: Supabase realtime multiplexes every
channel over one websocket, so a separate channel would have queued behind the same socket.

The one thing this rules out is co-presence without a call, and that is a fair trade. "Who can see
my cursor" is a question with a hard answer this way, and a soft one every other way.

## Pointers

`src/party/party.ts`. Five rules, all of them load-bearing:

**Off by default, and not persisted.** Every other preference on this site is remembered; this
one is deliberately forgotten on every page load. The others are about how the site looks to you.
This one is about what you emit to other people, and the failure of forgetting is one-directional
— nobody has ever been harmed by their trail colour resetting, and a toggle you flipped in March
must not still be broadcasting in July.

**Reciprocal, and not negotiable.** Not sharing means not receiving: `peers` stays empty and
nothing renders, enforced on the receive path as well as the send path. There is no
watch-without-being-watched mode, because that is the mode an observer would want and nobody else
would.

**Private pages are never shared.** `PRIVATE_ROUTES` covers account settings, sign-in,
investments, admin, invites, chat and contact. On those you disappear from everyone's screen
rather than merely stopping — a cursor that freezes reads as "still here, gone quiet", and the
difference matters when the reason you stopped is that you opened your bank page. Checked by
prefix, so `investments?tab=tax` cannot slip past.

It is a deny list rather than an allow list, which is the less safe choice in principle. In
practice an allow list means every page added next year is silently unshared, the feature looks
broken on it, and the fix is to add it to a list — the deny list again, with a worse failure in
between.

**Visible tabs only.** A backgrounded tab that kept transmitting would report your idle time to
the room.

**No screen coordinates ever leave.** What goes out is a fraction across the content column and
an offset down the document. Raw client coordinates carry your viewport size, and with it your
monitor and window setup — a fingerprint given away for nothing, since it is not even what the
receiver needs. Measuring against the content column rather than the window also means a fraction
lands on roughly the same word for two people on different sized screens.

Rate: 15/s, movement-gated, coalesced through one rAF. Everything arriving off the wire is
validated and clamped before it reaches a style property.

## Jamming

`src/party/jam.ts`. **Notes travel, not audio** — about forty bytes for "C#4 down, marimba",
synthesised locally in everyone's browser. That matters for more than bandwidth: the call's echo
cancellation is very good at removing steady non-speech sound from a microphone, so a piano
played into a call is treated as noise and gated away. Sending notes sidesteps the entire problem,
and everyone hears every part at full quality with their own choice of instrument.

The cost is honest and unfixable: you hear a friend's note when the _message_ arrives, 40–150ms
after their finger moved. Good for chords, pads and trading phrases; not tight enough for two
people to hold a fast groove in lockstep. There is deliberately no attempt to hide it by delaying
your own notes to match — that trades everyone's feel for a shared illusion, and an instrument
that responds late to your own hands feels broken in a way that a late friend does not.

### What a hostile peer can do

Every message becomes an oscillator on your machine, which makes this the one part of co-presence
with a resource cost attached. Per-person rate limit (24 notes/s) and per-person polyphony ceiling
(12), oldest stolen first.

The synth already caps voices globally, so the per-person cap needs justifying: a global cap
bounds the damage to your CPU but says nothing about _whose_ notes survive. One peer spraying
note-ons would sit at the front of that single shared queue and evict everyone else's held notes
as fast as they played them — the room stays within budget and is unplayable. Per-person ceilings
mean a flood costs the flooder their own polyphony and nobody else's.

Note-ons are namespaced by peer, because two people playing middle C is the normal case and a
shared voice id would collapse the chord to one voice and then to none.

## Verified

- Route deny list, including query-string forms (`investments?tab=tax` → private).
- Sharing defaults to off; peers default empty.
- Colour is stable per user id and differs between users.
- Jam controls are absent entirely when you are not in a call.
- Build, typecheck, lint clean; no console errors beyond the pre-existing localhost analytics CORS.

**Not verified:** the two-peer path. It needs two signed-in accounts in one call, which is not
something this environment can produce. Everything peer-to-peer here — cursors actually appearing,
notes actually sounding, leave/rejoin, the hostile-peer caps under real traffic — is untested and
wants a two-browser session.

## Not built yet

Shared _windows_ — the model the rest of this is heading toward is that each window you have open
is either your private copy or the party's copy, and "join the same snake game / visualiser /
music player" is just opening the shared instance of it. The instrument is the first one, and it
took a broadcast and a validator; the visualiser wants its dials synced, and snake already has an
authoritative relay to hang it off. The transport and the permission story are now the same for
all of them.
