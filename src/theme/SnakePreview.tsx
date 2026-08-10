/**
 * A little Snake board inside the palette preview.
 *
 * Evan's ask, and a fair one: the accent colour IS the snake and the second accent IS the
 * apples, so the game is the place a palette most obviously succeeds or fails — and it was the
 * one thing you couldn't see without saving, closing the dialog and going to play.
 *
 * Deliberately static and hand-placed rather than a running game: this needs to say "here is
 * what your colours look like as a board", and a moving snake in a settings dialog is a
 * distraction while you're trying to judge a colour.
 *
 * Colours come from the passed-in token map rather than from CSS, so it shows the palette being
 * *edited* rather than the one currently applied — the two differ until you hit Save.
 */
export function SnakePreview({ tokens }: { tokens: Record<string, string> }) {
  const bg = tokens['--bg']
  const snake = tokens['--accent']
  const apple = tokens['--accent-2']
  const grid = tokens['--border']

  const cell = 12
  const cols = 14
  const rows = 7
  // a plausible little run: along the third row, then a turn upward
  const body = [
    [2, 4],
    [3, 4],
    [4, 4],
    [5, 4],
    [6, 4],
    [6, 3],
    [6, 2],
    [7, 2],
  ]
  const apples = [
    [10, 2],
    [11, 5],
  ]

  return (
    <svg
      className="pal-snake"
      viewBox={`0 0 ${cols * cell} ${rows * cell}`}
      role="img"
      aria-label="Preview of the Snake board in these colours"
    >
      <rect width={cols * cell} height={rows * cell} fill={bg} />
      {/* faint grid, so the board reads as a board even when bg and snake are close */}
      {Array.from({ length: cols - 1 }, (_, i) => (
        <line
          key={'v' + i}
          x1={(i + 1) * cell}
          y1={0}
          x2={(i + 1) * cell}
          y2={rows * cell}
          stroke={grid}
          strokeWidth={1}
        />
      ))}
      {Array.from({ length: rows - 1 }, (_, i) => (
        <line
          key={'h' + i}
          x1={0}
          y1={(i + 1) * cell}
          x2={cols * cell}
          y2={(i + 1) * cell}
          stroke={grid}
          strokeWidth={1}
        />
      ))}
      {body.map(([x, y], i) => (
        <rect
          key={i}
          x={x * cell + 1}
          y={y * cell + 1}
          width={cell - 2}
          height={cell - 2}
          rx={3}
          fill={snake}
          // the head reads as the head without needing a second colour
          opacity={i === body.length - 1 ? 1 : 0.85}
        />
      ))}
      {apples.map(([x, y], i) => (
        <circle
          key={i}
          cx={x * cell + cell / 2}
          cy={y * cell + cell / 2}
          r={cell / 2 - 2}
          fill={apple}
        />
      ))}
    </svg>
  )
}
