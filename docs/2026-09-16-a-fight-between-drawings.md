# A fight between drawings

Evan asked for "my own super smash bros where i can fight my friends with my monsters and draw
their attacks (these would work in the other game too)". This is what got built, why the two
halves are two files, and the numbers behind every tuning decision — which were all settled
before the room that shows them existed.

## Why attacks are in their own file

`attack.ts` knows nothing about fighting. An attack there is **a shape and a clock**: how far it
reaches, how long the swing lasts, and which slice of that swing is dangerous. `fight.ts` is the
only file in the project that has ever heard of damage, launches or stocks.

That split is the whole of "these would work in the other game too". The park can import the same
swipe and decide it knocks fruit out of a tree; neither game has to know the other exists. Put
damage in the attack and the park inherits a fighting game it never asked for.

## Nobody picks moves from a list

The rig's bet is that a drawing's layer names are its skeleton. This is the same bet a third time:
the names decide what you can hit with. A tail gives a sweep, wings give an upward buffet, a mouth
gives the hardest single hit in the game, and a creature with no recognised parts gets the pounce —
which already existed as the thing a pet DOES rather than IS.

Templates are tuned against each other rather than in isolation: reach and damage are always paid
for in commitment. A swipe is 0.26s and does 4; a scorch is 0.46s, does 12, and leaves you standing
there for another 0.46s afterwards.

## Two bugs in reading the drawing

**Reach came from the wrong measurement.** The first version scored a part by how far out from the
middle it sat, against the creature's own box. Every tail scored exactly 1 — the creature's extent
is _set_ by its outermost part, so a tail is at the edge of the animal by definition. Two test
creatures identical but for a tail six times longer both got a reach of 1.625. It now measures the
part's own length against the creature's, and the same two come out 0.303 and 0.429 world units
apart — 42% more reach for the longer tail.

**And reach was in the wrong unit.** Pet-widths, originally. Every creature is drawn the same
height and whatever width its drawing implies, so width is the one measurement that varies wildly:
the long-tailed test creature is 0.46 of the stage wide against 0.24 for a compact one. In widths,
being drawn wide was a straight upgrade — and a sweep came out at 0.98 of the screen, which is the
whole stage. Reach is in pet-heights; how wide you are to _hit_ is still your drawing's business,
because a long low thing honestly is easier to catch.

## What the fight adds, and what it reuses

`stepBody` is called, not re-implemented. `play.ts` grew one options argument:

- `bounds` — a stage with edges, where the platformer has a floor running the full width on purpose
- `grip` — how hard the ground takes speed back off a body nobody is steering

Everything else is the platformer: gravity, acceleration, one-way ledges, the coyote rule. A
fighting game whose jump felt different from the playground's jump would be two games about the
same creature.

## Four things that were measured, not guessed

**Knockback did not work at all.** Drag applies whenever no direction is held, which is exactly the
state a stunned fighter is in. At full grip the hardest attack in the game threw a 200%-damaged
fighter from the middle of the stage to x=1.315, against a boundary at 1.34 — a round could
essentially never be won. `grip: 0.12` during stun puts the first ring-outs around 80–120%.

**Falling off was death at 0%.** `stepBody` only lets you jump from the ground or inside the coyote
window — right for a world whose floor has no edges, fatal on a stage that does. Fighters get two
air jumps (three if they glide, because wings mean "stays up" everywhere else in this module), and
a hit gives one back so a second hit in the air is still answerable.

**The opponent walked underneath the stage and died there.** Its recovery steered straight for the
middle of the stage from wherever it was — which off the left edge means walking _horizontally
under the platform_, and every ledge here is one-way, so from below there is nothing to land on for
the whole width of the stage. Traced: knocked off at x=0.087, it crossed the platform's level twice
while still outside it, drifted in underneath, and fell into the pit at x=0.493 with 35% damage.
Three of four ring-outs in that round were that same death. It now climbs before it comes in.

**A fighter knocked backwards faced the wrong way for ever.** `stepBody` takes facing from the way
a body is _moving_, which is right for walking and exactly wrong for being hit: knocked left, a
fighter came to rest facing left, away from whoever hit it, and if it then stood still nothing ever
turned it back. Watched in a mirror match — they traded one hit each, ended up 0.59 apart facing
opposite ways, and swung at empty air for the remaining fifty seconds. Facing is frozen while
stunned now, the same as it already was mid-swing.

**And the spawns were inside one hit of the edge.** A kick at 0% — the weakest exchange in the game
— carries 0.16 of the stage, which was exactly the distance from a spawn point to the drop. Watched
in a real round: a player who had done nothing at all was over the side on the first thing that
touched them and lost three lives in ten seconds at 7%. Damage decides when you die; a spawn point
should not.

## The round robin

Every pairing of six synthetic creatures — a blob with no recognised parts, a short tail, a long
tail, a winged one, a flame, and one with five different parts — driven by the built-in opponent on
both sides, 150 seconds each:

|                      |          |
| -------------------- | -------- |
| rounds               | 36       |
| finished inside 150s | 31       |
| ring-outs            | 146      |
| KO damage, median    | 63%      |
| KO damage, range     | 7–120%   |
| KOs under 20%        | 6 of 146 |
| median round length  | 58s      |

The five unfinished rounds are two evenly matched bots, still landing 18–47 hits each; they are
stalemates between weak opponents rather than rounds where nothing happens. The opponent is
deliberately not good — it closes, it swings in range, and it tries to get home. It does not read
your recovery, bait, or edge-guard.

Winged creatures produce KOs off the _top_ of the stage, which nothing was written to make happen:
the buffet's high lift and the damage curve do it on their own.

## How to run any of this again

The dev server serves the modules, so in the browser pane's console on any page:

```js
const A = await import('/src/pets/attack.ts?t=' + Date.now())
const F = await import('/src/pets/fight.ts?t=' + Date.now())
```

Everything above is `F.stepFighter`, `F.trade`, `F.respawn`, `F.foeInput` and `A.attacksOf` called
directly, with no browser involved.

⚠️ **`trade` takes `Attack[][]`, one list per fighter.** Passing one fighter's `Attack[]` makes
every hitbox read as empty and the whole game look silently broken — it cost a false bug report
here before the real facing bug was found underneath it.

⚠️ **The pane never fires `requestAnimationFrame`**, so the room itself is frozen there. To watch a
real round, stand in for it before the component mounts:

```js
window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16)
```

then leave the room and come back, so the loop starts against the replacement. That is how the
spawn-point problem and the human controls were checked.

## What this could not check

**Feel.** Whether the commitment on a heavy attack reads as weight or as lag, whether 63% is where
a KO should land, and whether two people on one keyboard actually enjoy it. Every number above says
the game is playable and fair; none of them says it is fun.

**Firefox and Safari.** The pane is Chromium. Nothing here touches audio or recent CSS syntax, but
it has not been seen in either.
