# The pet course, checked end to end

A tick spent adding nothing. Six of the last seven added something and three of those
broke what the one before them built, so this one drove the course instead.

The physics in `src/pets/play.ts` is pure on purpose — `requestAnimationFrame` never fires in
the browser pane, so a loop that owns its own maths is a loop nobody can check. That pays off
here: the whole level can be played without a browser, and these are the results rather than
opinions about them.

## How to run any of this again

The dev server serves the module, so in the browser pane's console on any page of the site:

```js
const P = await import('/src/pets/play.ts?t=' + Date.now())
```

Everything below is `P.stepBody`, `P.followInput`, `P.touching` and `P.collect` called directly.
A `Part` for `traitsOf` only needs its `kind` field for these purposes.

## Is every treat reachable?

Brute force over run-up position (26 starts), jump timing (80 frames) and direction, from a
sensible standing place for each. A plain creature — no wings, no legs, no float:

| treat | where              | plain creature reaches it |
| ----- | ------------------ | ------------------------- |
| 0     | floor, left        | yes                       |
| 1     | floor, right       | yes                       |
| 2     | on ledge 0         | yes                       |
| 3     | on ledge 1         | yes                       |
| 4     | high right         | yes                       |
| 5     | far shelf          | yes                       |
| 6     | **across the gap** | **no**                    |
| 7     | last ledge         | yes                       |
| 8     | far floor          | yes                       |

Treat 6 is the gate and it holds: a plain creature cannot reach it by any run-up or timing, with
or without holding jump, while four legs, a float or two wings all cross. That is the one place
in the room where which pet you are decides what you can have.

Nothing is a trap. The floor runs the full width of the world underneath everything, so there is
no ledge you can reach and not leave.

## What a naive player gets

A driver that always heads for the nearest uncollected treat, steered by the same `followInput`
the followers use, collects **3 of 9** — and the same 3 whichever creature it drives.

That is the driver, not the level: it has no route planning, so it walks to a spot under a treat
two shelves up and stays there. A person can see the shelves and route around them. But it is
worth knowing that the greedy path stalls, because it says the way up is not signposted — the
treats mark where to go, and nothing marks how to get there.

## What is NOT true

Nothing is collected that was not touched. At the starting position no treat is within reach and
`collect` returns nothing on the first frame; an earlier playthrough script appeared to show a
treat taken at t=0 and that was the script's own bookkeeping, not the game.

## The thing this could not check

Feel. Everything above says the course is completable and fair; none of it says whether it is
fun to move around, whether the camera lags in a way that reads as weight or as lateness, or
whether the gap is satisfying or annoying to clear. Those need hands on it.

## A decision that is not mine

These measurements get re-derived by hand every time the physics is touched, which is the exact
shape of thing a test file exists for — the module is pure, dependency-free and needs no DOM, so
it would test cleanly. The repository has no test runner and adding one is a change to the
project's toolchain rather than a change to a feature, so it is left as a question: worth adding
`vitest` for this, or is `docs/` the right home for it?
