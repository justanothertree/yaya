// Goal progress bar, ported from the standalone the_circuit.html.
// Fills toward the day's goal in the person/accent color (green once hit). Once you
// pass the goal, an "over" bar sweeps across in a new color for each extra lap of the
// goal — gold → orange → red → purple for the 1st/2nd/3rd/4th+ hundred. So going over
// 100 / 200 / 300 paints a distinct color over the first 100, just like the HTML.
const LAP_OVER_COLORS = ['#f5c060', '#fb923c', '#f46b6b', '#c084fc'] // gold, orange, red, purple

/** Layout numbers for a goal bar: base fill %, whether the goal is hit, and the
 *  current over-lap (color + width) when the total exceeds the goal. */
function goalBarParts(total: number, goal: number) {
  const g = goal > 0 ? goal : 100
  const pct = Math.min(100, (total / g) * 100)
  const hit = total >= g
  let over: { width: number; color: string; laps: number } | null = null
  if (total > g) {
    const laps = Math.floor(total / g) // 1 = past 100, 2 = past 200, …
    const remainder = total % g
    over = {
      laps,
      width: remainder === 0 ? 100 : (remainder / g) * 100,
      color: LAP_OVER_COLORS[Math.min(laps - 1, LAP_OVER_COLORS.length - 1)],
    }
  }
  return { pct, hit, over }
}

export function GoalBar({
  total,
  goal,
  color,
  height = 12,
  radius = 6,
}: {
  total: number
  goal: number
  color: string // base fill color when the goal isn't hit yet
  height?: number
  radius?: number
}) {
  const g = goal > 0 ? goal : 100
  const { pct, hit, over } = goalBarParts(total, g)
  return (
    <div
      style={{
        position: 'relative',
        height,
        borderRadius: radius,
        background: 'var(--b1, rgba(127,127,127,0.18))',
        overflow: 'hidden',
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          height: '100%',
          width: `${pct}%`,
          background: hit ? '#22cc78' : color,
          borderRadius: radius,
          transition: 'width .3s, background .3s',
          zIndex: 1,
        }}
      />
      {over && (
        <span
          title={`${Math.round(total)} pts · ×${over.laps} over goal`}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            height: '100%',
            width: `${over.width}%`,
            background: over.color,
            borderRadius: radius,
            transition: 'width .35s, background .2s',
            zIndex: 2,
          }}
        />
      )}
    </div>
  )
}
