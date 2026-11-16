# 24px with a mouse too — 10 Nov 2026

Part of "an easier, cleaner UI for all the controls". On a phone, the instrument room's small
controls get touch sizes, and `mobileAudit` holds them there. With a mouse they kept whatever their
padding made them, and **WCAG 2.5.8's 24px applies to a mouse as much as to a thumb**. Every one of
these sits in a row of neighbours, so the spacing exception does not save them.

Measured at 1440, before and after:

| Control                               | Before          | After           |
| ------------------------------------- | --------------- | --------------- |
| Octave − and +                        | 25.7 × 18.6     | 25.7 × 24       |
| Snap: Off, 1/4, 1/8, 1/16             | 17–19 tall      | 24 tall         |
| Note editor lengths: Grid, 1/16 … 1   | 20 tall, "1" 20 | 24, "1" 24 × 24 |
| Layer buttons: Keep, ⏺, mute, ✕      | 23.6 tall       | 24 tall         |
| Layer "dry", Split, Clear all         | 19.6 tall       | 24 tall         |
| The tip's ✕ ("Got it — stop showing") | 15.5 × 20.3     | 24 × 24         |

## How

- **One block in `index.css`, under `@media (pointer: fine)`**, so it cannot touch a phone. Written
  unconditionally, it would be a plain min-height at the same specificity as the touch sizes, and
  could undo any of them written earlier in the file. The tip's 32px was one, caught by measuring
  at 375. That ✕'s floor went into its own base rule instead.
- Nothing shrinks: these are all `min-` sizes.

## Measured

- **1440:** every control above reads 24 or more. ▶ Play does not move, and the page grows 9px.
  `mobileAudit` finds no clipping, overflow or spills.
- **375 with touch:** octave 36 × 36, Snap 36 tall, layer buttons 24, and the tip's ✕ 32 × 32, the
  same as on main. `mobileAudit` reports zero across 158 controls, after reporting a planted
  fault first.
- **A screenshot at 1440** shows the Snap row now level with Undo and Redo beside it, and nothing
  else changed.

## Left alone, on purpose

- **The bar cells and the bar ruler: 12px wide on a desktop.** That is a recorded decision. The
  note on `.inst-bar-cell` says widening them "made the row longer and harder to take in", so they
  grow only for a coarse pointer. By 2.5.8 they fail with a mouse. **That is Evan's call.**
- **Sliders** (16px tall with a mouse) are a different question, and the keyboard slide is Evan's
  own design.
- The visualiser's **Save** (53 × 20) and **Start a call** (69 × 20) belong to other components
  that appear in other rooms too.
