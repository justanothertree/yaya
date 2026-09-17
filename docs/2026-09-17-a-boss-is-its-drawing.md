# A boss is its drawing

_17 September 2026. Follows `2026-09-17-one-boss-two-people.md`, which is how one boss came to be
shared, and `boss.ts`, which is why "boss" is a role rather than a kind._

The drawing already decided what a boss looks like and what it can throw. It did not decide how it
**moves** or how it **picks its fights** — and those are most of what makes an opponent memorable.
Every boss on the site walked at the same speed, re-decided on the same 0.625-second tick, backed
off on every fifth beat and carried the same 520 health, whether it was a winged darter or a thing
made of one enormous jaw. Two completely different pictures fought identically, which quietly said
the drawing was decoration.

Asked for directly: unique in how they move and attack, but still a challenge.

## Dials, not personalities

The obvious version is a list — wings mean the darter, horns mean the charger. A list has to be
extended for every new combination, silently does nothing for a creature that is two of them at
once, and has a right answer at the top. This repository has been bitten by exactly that shape
before: the nav-key guard was a list of games rather than a rule, and the arrow keys walked the
site out from under a fight.

So the parts turn a handful of continuous dials, one brain reads the dials, and a creature with
wings **and** a horn is genuinely between the two rather than whichever the list checked first.

| dial     | what it decides                           | what turns it                         |
| -------- | ----------------------------------------- | ------------------------------------- |
| `scale`  | how tall it stands                        | how compact the drawing is            |
| `life`   | what it starts with                       | everything below — see the budget     |
| `pace`   | how fast it walks                         | legs, wings, wheels; fire slows it    |
| `range`  | where it wants to stand, in its own reach | how far its own longest move reaches  |
| `beat`   | how long it commits to a decision         | how long its quickest move ties it up |
| `nerve`  | whether it gives ground                   | horns and fire hold, wings dart       |
| `charge` | whether it runs at you in a straight line | horns, wheels, jaws                   |

`range` is the one that changes a fight most. A creature made of one long tail hovers at the end of
it; one made of a jaw has to be in your face and now behaves like it knows that.

It costs the wire nothing. Every dial is a pure function of the drawing, and everybody in the park
already has the drawing — so both ends reach the same temper from the same picture with nothing
sent about it. A boss whose character travelled as numbers would be a boss whose character could
disagree between two screens. (Which matters concretely: `scale` multiplies reach, so an echo sized
at a constant would have had a hitbox that disagreed with the one hitting you.)

## The budget, and what measuring it actually showed

The intent was **difficulty is a budget; the drawing decides how it is spent, not how much there
is.** Three things came out of measuring rather than assuming, and two of them were corrections.

**Fights were not unequal in length to begin with.** Twelve very different drawings, health held
flat at 520, one scripted player policy: 49 to 78 seconds. So the budget is not fixing an
unfairness. What was flat was the **shape** — every boss took about a minute and none of them was
either a sprint or a siege. Health now divides by what a boss can throw, which makes glass cannons
and walls out of what somebody drew.

**The range term was the wrong way round.** Reach looks like the frightening stat, so far-reaching
bosses were scored as the dangerous ones and given less health. Measured, the damage a boss
actually landed ran almost perfectly _inverse_ to how far away it wanted to stand:

| wants to stand at | hurt the player |
| ----------------- | --------------- |
| 0.68 of its reach | 500             |
| 0.73              | 300             |
| 0.86              | 291             |
| 0.92              | 138             |

A boss in your face shoves you, and a shoved creature cannot swing — so being crowded costs you
the fight twice over. The worst case of having it backwards was a body-only slab handed 510 health
for being "harmless", which then stagger-locked the scripted player for **109 seconds**.

**Terms that did not survive.** Size and charge were in the same figure and moved the answer by a
few percent each across a sample of twelve. That is not a finding, it is a formula nobody can
reason about later. Both were cut.

`beat` had the same disease in miniature: it averaged all six moves, which include the heavies at a
fixed multiple of the lights, so every creature landed between 0.56 and 1.25 and the dial spent its
life clamped at the slow end of its own band. It now reads the move a creature throws without
thinking.

## Still a challenge

Variety without a band is a random stat generator, and the failure is not that some bosses are
weak — it is that some are impossible and nobody can tell which from looking. Every dial is
clamped. Same twelve drawings, health now derived:

|                         |                               |
| ----------------------- | ----------------------------- |
| all twelve beatable     | yes                           |
| time to beat one, alone | 29 – 75 seconds (2.6× spread) |
| with a friend           | roughly half that             |
| damage they dealt       | 142 – 345                     |
| health they were given  | 220 – 470                     |

Two of the owner's own minions, in the browser, side by side: **Flappy** — _a quick boss that keeps
you at arm's length; it keeps swinging and darts away, 250 health_ — stood 154px and covered 37% of
a screen in 1.2 seconds. **Ratty** — _a steady boss that fights at the end of its reach; it keeps
swinging and never gives ground, 360 health_ — stood 178px and moved 2.8% in the same time.

## The room says what it read

Half the point of a boss made out of your own picture is noticing that the picture is **why** it
fights like that, and nobody notices a number they were never shown. So the park prints a sentence
under the bar: what the selected minion would be as a boss, and once one is out, what the one in
the field is — including somebody else's, because the answer to "why is this thing so fast" belongs
on the screen it is fast on.

The sentence is built from the dials, never from the layer names, so it can never describe a boss
that is not the one you are about to fight. Its thresholds are set against the measured spread
rather than the width of the band: picked by eye first, eight of twelve creatures came back
"keeps swinging and circles", and a readout that agrees with itself about everything teaches
nobody anything.

## Still open after this

- **A drawing with no named layers makes the dullest and longest boss** — 74.5 seconds, the worst
  of the twelve, because a body with no recognised parts falls back to one move and throws it
  relentlessly at point-blank range. Arguably fair (name your layers and your boss gets
  interesting) and arguably just the least-tested corner.
- **A charging boss moves at 1.5× its own pace**, which at the top of the band is nearly twice a
  player's. It did not read as oppressive in twelve scripted fights, but no person has felt one yet.
- **The player's own creature still dominates how long a fight takes** — a weak quick attack turns
  every boss into a slog, and nothing on the boss side can see that.
- **Nothing here has been near Firefox or Safari.**
