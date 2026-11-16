/**
 * The chess pieces, drawn here rather than taken from a font. The Unicode chess glyphs differ
 * from one device to the next: in one common font the black king's white inner lines make it
 * read as the white king at board size, and some phones draw the black pawn as an emoji. These
 * six silhouettes are this site's own and look the same everywhere.
 */
const BASE =
  'M10 37.5a1.5 1.5 0 0 1 1.5-1.5h22a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5h-22a1.5 1.5 0 0 1-1.5-1.5z'
const SHAPES: Record<string, string> = {
  p: 'M22.5 7a6.5 6.5 0 1 1 0 13a6.5 6.5 0 1 1 0-13zM15.5 35c0-7.5 3-12 7-15c4 3 7 7.5 7 15z',
  r: 'M12 11h4v3h3v-3h7v3h3v-3h4v8l-3 2.5v10l3 2.5v1H12v-1l3-2.5v-10l-3-2.5z',
  n: 'M14 35c0-7 4-10 6-13c-3 0-7 1-9-1c0-4 5-9 9-11l1-3.5l2 3c7 1 10 8 9 15c-1 5-2 7-2 10.5z',
  b: 'M22.5 3.5a2.2 2.2 0 1 1 0 4.4a2.2 2.2 0 1 1 0-4.4zM22.5 8.5c6.5 5 7.5 12 4.5 18l1.5 8.5h-12l1.5-8.5c-3-6-2-13 4.5-18z',
  q: 'M10 15l4.5 15.5h16L35 15l-7 8l-2-11l-3.5 10.5L19 12l-2 11zM14.5 30.5h16v4.5h-16z',
  k: 'M21 3h3v4h3.5v3H24v6.5h-3V10h-3.5V7H21zM13 34c-2-7-1-13 4-14.5c2.5-.7 4.5 1 5.5 3c1-2 3-3.7 5.5-3c5 1.5 6 7.5 4 14.5z',
}
/** a line or two across a piece, in the other side's colour, so each reads as itself */
const DETAIL: Record<string, string> = {
  p: '',
  r: 'M15 21.5h15M15 31.5h15',
  n: 'M18.5 13.5h.01',
  b: 'M24.5 13l-4 6',
  q: 'M14.5 30.5h16',
  k: 'M15 29h15',
}
export const COLOURWAYS = {
  ivory: { w: ['#fbf7ec', '#2a2420'], b: ['#2a2420', '#f2e6c9'] },
  coral: { w: ['#ffb4a2', '#7a2e22'], b: ['#2f7f86', '#d9f3f1'] },
} as const

export function Piece({
  kind,
  side,
  colours,
  size,
}: {
  kind: string
  side: 'w' | 'b'
  colours: keyof typeof COLOURWAYS
  size?: string
}) {
  const [fill, edge] = COLOURWAYS[colours][side]
  return (
    <svg
      viewBox="6 2 33 41"
      className="ch-piece"
      style={size ? { width: size, height: size } : undefined}
      aria-hidden
    >
      <g fill={fill} stroke={edge} strokeWidth="1.6" strokeLinejoin="round">
        <path d={SHAPES[kind]} />
        <path d={BASE} />
      </g>
      {DETAIL[kind] && (
        <path
          d={DETAIL[kind]}
          stroke={edge}
          strokeWidth={kind === 'n' ? 3 : 1.4}
          strokeLinecap="round"
          fill="none"
        />
      )}
    </svg>
  )
}
