import { PIPS } from './pips'

/** a die's face, drawn with the shared `.die-face` and `.pip` styles in lab.css */
export function DieFace({ face }: { face: number }) {
  return (
    <span className="die-face" aria-hidden>
      {Array.from({ length: 9 }, (_, k) => (
        <span key={k} className={PIPS[face].includes(k) ? 'pip' : undefined} />
      ))}
    </span>
  )
}
