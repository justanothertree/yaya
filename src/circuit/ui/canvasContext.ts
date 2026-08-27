import { createContext } from 'react'

/**
 * True for anything rendered INSIDE a canvas window.
 *
 * A page can be shown either as the whole page or as one window on the canvas, and a few of them
 * need to know which — a profile wearing someone's colours repaints the page in the first case
 * and its own window in the second, and it cannot tell that from its props.
 *
 * Its own module for two reasons. react-refresh/only-export-components will not let a component
 * file export a context; and more usefully, a consumer importing this from CircuitCanvas.tsx
 * would pull the entire canvas — which is lazy-loaded precisely because it is large — into that
 * consumer's chunk.
 */
export const InCanvasWindow = createContext(false)
