/**
 * Snap — one control, in both the rooms that have it.
 *
 * ⚠️ IT WAS TWO DIFFERENT CONTROLS FOR ONE SETTING. The instrument room's toolbar had a
 * dropdown with an Off option; the note editor had none, and the row of buttons it DOES have is
 * Length — so opening the editor appeared to change snap from a dropdown into buttons that then
 * did not do what snap does. Two shapes for one setting is a thing to keep in step by hand, and
 * this is what that costs.
 *
 * So there is one component and both places render it. Same values, same order, same look, and
 * no way for them to drift again.
 *
 * ⚠️ OFF IS A VALUE, NOT A MISSING ONE. It sits first because it is the state the loop starts
 * in now, and because "what is snap set to" should be answerable by looking rather than by
 * noticing that nothing is lit.
 */
const SNAPS: Array<[number, string]> = [
  [0, 'Off'],
  [4, '1/4'],
  [8, '1/8'],
  [16, '1/16'],
]

export function SnapPicker({
  value,
  onPick,
  applyTo,
}: {
  value: number
  onPick: (q: number) => void
  /**
   * ⚠️ WITH NOTES PICKED, THESE MEAN "MOVE THESE ONTO THAT GRID".
   *
   * Exactly the trade the Length buttons already make in the editor: while several notes are lit,
   * a button that could plainly act on them should. Snap is otherwise a setting about the FUTURE
   * — what happens to the next thing you record — and there was no way at all to tidy a part you
   * had already played, which is when you actually want it.
   *
   * Left undefined by the room's toolbar, where there is no selection to act on.
   */
  applyTo?: { count: number; onApply: (q: number) => void }
}) {
  const acting = (applyTo?.count ?? 0) > 0
  return (
    <span className="snap-pick" role="group" aria-label="Snap">
      <span className="muted">Snap</span>
      {SNAPS.map(([q, label]) => (
        <button
          key={q}
          className={'btn' + (!acting && value === q ? ' is-on' : ' btn-ghost')}
          aria-pressed={!acting && value === q}
          onClick={() => {
            if (acting && applyTo) applyTo.onApply(q)
            else onPick(q)
          }}
          title={
            acting
              ? q === 0
                ? 'Leave the picked notes exactly where they are'
                : `Move the ${applyTo?.count} picked note${applyTo?.count === 1 ? '' : 's'} onto the ${label} grid`
              : q === 0
                ? 'Keep what you play exactly as you played it'
                : `Snap what you play to ${label}`
          }
        >
          {label}
        </button>
      ))}
    </span>
  )
}
