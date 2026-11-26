import type { CSSProperties } from 'react'

/** A person's row in the Circuits tab: their colour down the left edge, contents wrapping. */
export const personRow = (color: string): CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  flexWrap: 'wrap',
  padding: '0.45rem 0.6rem',
  background: 'var(--b1, rgba(127,127,127,0.06))',
  borderRadius: 8,
  borderLeft: `3px solid ${color}`,
})
