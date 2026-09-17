# One boss, two people

_17 September 2026. Follows `2026-09-16-a-place-rather-than-a-call.md`, which is why the park is a
room on the relay rather than a call._

The boss landed the day before this as a local thing: one of your own minions, stood up bigger
with a pool of health and something that actually plays behind it. Two people in the same park
each fought their own copy. That was said out loud at the time because the alternative — letting
two people wonder why their hits disagree — is worse than a missing feature.

This is the other half. **One boss in the park, and everybody in it is fighting the same one.**

## Why not lockstep, when the scrap is lockstep

A bout is two machines running the same fight from the same inputs, frame for frame, proven
bit-identical over 20,000 frames. It is the right answer there and the wrong one here, for one
reason: **lockstep makes everybody wait for the slowest person.** That is a fine bargain for two
people who have agreed to fight each other and nothing else. It is not a bargain a _place_ can
make — the park is somewhere you walk into and out of, with people arriving late, leaving mid-swing
and standing about doing nothing. A park that stalled for everyone because one person's connection
hiccuped would stop being a place.

Lockstep also needs a fixed set of participants agreed in advance. The park's whole point is that
it does not have one.

## So: whoever called it, runs it

|                                    |                                                         |
| ---------------------------------- | ------------------------------------------------------- |
| who steps the boss                 | the machine that called it out, and only that one       |
| what crosses the wire              | its drawing once, then place, facing, move slot, health |
| who decides it has been hit        | the machine running it, from the attacker's own drawing |
| who decides **you** have been hit  | you, the same as for any other person's swing           |
| how many bosses a park has         | one, arbitrated by the relay                            |
| what happens when its owner leaves | it goes with them                                       |

Three things fall out of that, and each was the reason for a choice rather than a consequence of
one.

**Nobody sends a damage number.** A remote swing is tested against the boss on the host, using the
_attacker's_ move table — which the host already has, because their creature arrived with their
look. So a friend's hit is worth exactly what their creature's move is worth and there is no
number on the wire for anyone to make up. What they pay for that is the lag before the bar moves;
what they get is one health bar both people believe. The freeze on contact still lands on their own
frame, so the swing has weight locally even though the arithmetic happens elsewhere.

**Health goes out as a fraction.** The relay forwards `h` between 0 and 1 and has no idea how much
health a boss has. `BOSS.life` can be retuned, or differ per boss later, without the relay knowing.

**The boss fights whoever is nearest.** It chased its owner in the first cut, which turns a fight
two people are in into two people taking turns being ignored. Everybody's position is already on
the host to draw them with; picking the closest is the whole cost.

## The race, and why the button does not wait for permission

Two people can press the button in the same second, and no amount of client agreement settles
that — the relay is the only thing that can say which press arrived first. But making the button
_wait_ for the answer would put a round trip in front of every boss anybody ever calls.

So: a press stands one up immediately, the relay refuses the loser, **and hands them the boss that
is actually out.** The loser's own copy stands aside for it on the next frame. Nothing to plumb,
and the common case — nobody else pressing — costs nothing.

A late arrival gets the boss in the roster, the same message that already says who is here. A
fight you have to be told about after the fact is a fight you have missed.

## Joining is a button

The park is nine screens. A boss is in one of them. A shared boss you have to _find_ is a shared
boss you mostly miss — by the time you have walked three screens it is over, which is the
difference between "we fought that together" and "you told me about it". So there is a Join
button, and it stands you at the edge of the boss's reach, worked out from the boss's own drawing
rather than a guess: a fixed distance put the joiner _inside_ the swing of a long-armed one,
measured at 0.082 against a reach of 0.098.

The boss is also on the minimap, for arriving on foot.

## Two bugs this found that were not about bosses

**The park was reconnecting every four seconds, and had been.** `GamesRoom` passed
`pets={mine.map(p => ({ name: p.name, art: p.art }))}` — a new array of new objects on every
render. The park's join effect owns the socket and depended on the object holding the drawing, so
every render of that component tore the connection down and built it again. Measured against a
live relay: one leave, one rejoin, and **zero positions sent** in four seconds. With the array
memoised and the effect depending on the drawing rather than its wrapper: no leaves, no rejoins,
58 positions in the same four seconds.

Nobody had reported it, because on its own it looks like somebody's connection being poor. It is
what made a shared boss last four seconds, which is how it got found.

**One swing was one hit forever, not one hit per swing.** `Someone.spent` is set when a peer's
blow connects and is cleared when their swing slot changes — and the clearing line was missing. A
peer landed exactly one hit for as long as they stood in the park. Found by swinging forty-seven
times at a boss and taking ten health off it.

## Measured

Against the real relay, with a local stand-in for Supabase so nobody's account was involved.

On the wire, three sockets driven through the whole life of a boss:

|                                                          |                                           |
| -------------------------------------------------------- | ----------------------------------------- |
| a called boss reaches the other person, with its drawing | yes                                       |
| its place, swing and health arrive                       | yes                                       |
| somebody who does not own it cannot step it              | yes                                       |
| a nonsense step (`x: 'nope'`, `f: 7`, `h: -5`)           | clamped into the field                    |
| a second caller                                          | refused, and handed the one that is out   |
| a late arrival                                           | told, in the roster                       |
| its owner leaves                                         | boss gone, and somebody else may call one |
| somebody else tries to put it away                       | refused                                   |

In two browsers, both in the park:

|                                                |                                              |
| ---------------------------------------------- | -------------------------------------------- |
| the joiner sees the boss and a Join button     | yes                                          |
| Join stands them at the edge of its reach      | 0.1197 against a reach of 0.098              |
| their hits move the bar on **both** screens    | 100% → 95.3846%, identical on each           |
| each hit is worth exactly one bite             | 1.1538% steps — no multiplication            |
| the boss shoves a player it does not belong to | yes, 3.3% of the park, with no input held    |
| two people grinding together                   | 100% → 15% in 28 seconds                     |
| beaten                                         | grey, "Flappy — beaten", bar gone            |
| and then away                                  | 3.3s later, on both screens, park free again |

## Still open after this

- **A boss that walks towards somebody else cannot be caught.** Everything moves at the same
  speed, so chasing never closes the gap; you have to get in front of it. Observed, not yet a
  decision.
- **87 landed swings to beat one alone** with a two-part creature, 43 each with a friend.
  `BOSS.life` is the one number, and it should be set by how a fight feels rather than by this
  note.
- **Nothing is remembered.** A boss lives in the machine that called it; there is no boss standing
  in the park when nobody is there, and no record that one was beaten.
- **A swing shorter than a packet could be missed.** The move slot goes out fifteen times a
  second; nothing in the current move tables is that short, but nothing enforces it either.
