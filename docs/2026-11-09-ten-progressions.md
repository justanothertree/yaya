# Ten progressions — 9 Nov 2026

Evan's answer to a question queued with the integration build: _add more chord progressions,
around ten common ones — I'll judge by ear._ There were five against thirty drum patterns. No
database change, and no new mechanism: each is one line in `CHORD_PATTERNS`.

## The five added

The five already there are mostly one set of four chords turned round. The new five were chosen
for being common and for not sounding like those:

| Button     | Degrees              | In C major        | Lead back adds                |
| ---------- | -------------------- | ----------------- | ----------------------------- |
| Canon      | I V vi iii IV I IV V | C G Am Em F C F G | nothing — already ends on V   |
| Rising     | IV V iii vi          | F G Em Am         | I                             |
| Spanish    | vi V IV iii          | Am G F Em         | nothing — already ends on iii |
| Circle     | vi ii V I            | Am Dm G C         | iii                           |
| Two chords | I IV I IV            | C F C F           | V                             |

- Each is written in major degrees, like the existing five. A minor room plays the minor version:
  Spanish in A minor is F, E minor, D minor, C.
- Rising is the "royal road" of Japanese pop. Spanish is the Andalusian cadence.
- **Not the twelve-bar blues**, the obvious sixth. Its twelve chords take a bar each by definition,
  and a progression here divides the loop between its chords, so in the default two bars it would
  change chord six times a bar. It needs a loop that knows its own length first.
- An older bundle (for example a jam partner who hasn't reloaded) reads a new id as an unknown
  progression: its button stays unpressed and the notes still play.

## Verified

- `chordPatterns.test.ts`:
  - each new progression is checked by chord name in C major, and Spanish in A minor
  - the lead-back table covers all ten, and `null` for Canon and Spanish
  - the existing sweeps now cover ten: well formed, nameable on every seven-note scale, inside
    every scale, no two alike
  - three perturbations made it fail once each: Canon misspelt, Two chords made a copy of Four
    chords, Spanish off by one
- In the room on the dev server (G major), through the keyboard's _… underneath_ hint:
  - Canon: G D Em Bm C G C D
  - Rising: C D Bm Em
  - Spanish: Em D C Bm
  - Circle: Em Am D G
  - Two chords: G C
- Layout:
  - At 1440 the row wraps to two lines, the way every row in this panel does when it fills.
  - At 375 with touch, all ten buttons are 38 px tall and inside the edge. `mobileAudit` read 0
    sideways, off-edge, clipped, spilling and undersized across 160 controls, after a planted
    fault was reported and removed.

**Not verified:** by ear, which is the point of the draft.
