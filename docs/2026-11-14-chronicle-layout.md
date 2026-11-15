# Chronicle: the simpler layout, built

**The layout proposed in #298, built.** No database change and no new dependency. Every function
the room had is still there, and this says where each one went.

## Evan's five questions, as applied

Evan asked for the build to use the proposal's own answers unless one lost a function. None did.

1. **Done goals fold by default.** Yes: "Done today · 4" with their titles on the row. Only goals
   already done when you open the tab fold. One you tick now stays in place, struck through, until
   you leave, as before (`arrange`).
2. **The week grid starts folded on a phone.** Yes, under 900px. It starts open from 900px, where
   there is room, and stays as you leave it for the rest of the visit.
3. **The three most recent activities on the idle Day.** Yes, by when each was last started this
   week, with the rest by name when the week is new (`recentFirst`). Nothing is pinned.
4. **Month, Year and Years behind More.** Yes when two or more of them have something in them.
   A lone Years stays a tab of its own, because a menu holding one item is a tap that buys
   nothing. The horizon you open from More becomes a tab while it is open, and the strip scrolls to
   it.
5. **One Done after Stop that saves.** Yes. It keeps the rating, any changed time or count, and words
   left in the journal box. ✕ and Escape still close without keeping anything, as before. Building
   it found that the old **Save** on that dialog did nothing: `saveEnt` returned at its first line
   unless the dialog had been opened with ✎. So a rating given after Stop had never been saved.
   Measured in the pane before the change.

## Where everything went

| Was                                                  | Now                                                                       |
| ---------------------------------------------------- | ------------------------------------------------------------------------- |
| ✎ Note, ＋ Activity and switch chips around ■ Stop   | The running bar's ⋯: Note, every activity to switch to, New activity      |
| Live / Log past pills                                | 🕘 Log a past session, in both idle sheets and on a past day              |
| Quick start row of six, the picker and its ▶ Start  | ▶ Start something: picker, every activity, and the quieter three         |
| Three most recent: nowhere                           | Three chips under ▶ Start something                                      |
| ✎ Note with nothing running                          | ✎ Write a note in the idle sheets, on screen on a first visit             |
| The rail, at the foot of the Day on a phone          | The Day's first line, folded, for the day on screen; side rail from 900px |
| Category totals and the site's minutes above the log | Inside that fold on a phone; where they were from 900px                   |
| ✎ on every sitting and every note                    | The row is the button, with a ›                                           |
| Week grid                                            | "This week" fold, carrying the grid's own figure                          |
| Planned, Routines, Activities: three folds           | One row holding all three, with the plan's figures on it                  |
| ✎ ○ ✕ on every goal                                  | One ⋯: Change, your profile (in words), Delete                            |
| Six horizons in a sideways strip                     | Today · Tomorrow · Week · More                                            |
| ＋ Add at the foot of the list                       | ＋ Add beside the window's own line; the form opens there                 |
| Search above the Journal's box                       | The box first, search behind 🔍                                           |
| Sharing settings above the Friends feed              | One row when sharing is on; the switch stays on screen when it is off     |
| Done and Save after Stop                             | Ratings and journal first, the rest behind More, one Done                 |

## Measured

The same probe as #298: every visible control in the room or its open dialog, closed folds not
counted. 375 with touch, on the dev preview's data, with a timer running.

| Screen       | Before | After | Screens tall, before | After |
| ------------ | ------ | ----- | -------------------- | ----- |
| Day          | 31     | 18    | 2.3                  | 1.05  |
| Aims → Today | 49     | 21    | 2.1                  | 0.99  |
| Journal      | 21     | 16    | 1.4                  | 1.21  |
| Friends      | 19     | 7     | 1.7                  | 0.91  |
| After ■ Stop | 20     | 10    |                      |       |

`scripts/mobile-audit.js` reports nothing on any tab, sheet or dialog at 375, with folds open and
shut. It also reports nothing at 820 with the touch rules forced on. It was made to name a planted
16px control and a spill first. At 320 the horizon strip still scrolls a little, as every strip on
it did before.

## Not checked

A real phone, Firefox and Safari. The signed-in room against production data, which only the
deployed site has.
