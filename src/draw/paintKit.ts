import { ECHOES, SYMMETRIES, TOOLS, type Tool } from './strokes'
import { kitName, kitNum, kitPick, kitStore } from '../ui/savedKits'

/**
 * A way of drawing, kept under a name.
 *
 * ⚠️ THE ROOM REMEMBERED NOTHING AT ALL BEFORE THIS. Every visit to Paint began with a green
 * brush at the default width, symmetry off and echo off, however you had left it — so the six
 * controls that decide what a mark looks like had to be set again before every drawing, and a
 * combination you liked existed only for as long as you did not leave the page. That is a worse
 * problem than any missing brush, and it is the same problem saved palettes solved for colour.
 *
 * Two things follow from that, and both are here: `LAST` restores what you were using, and the
 * store keeps the ones you named.
 */
export type PaintKit = {
  name: string
  tool: Tool
  colour: string
  alpha: number
  width: number
  /** kaleidoscope segments — see Stroke.k */
  symmetry: number
  /** fading copies along the stroke — see Stroke.e */
  echo: number
}

const TOOL_IDS = TOOLS.map(([id]) => id)
const HEX = /^#[0-9a-fA-F]{6}$/

/**
 * A kit from anywhere — storage, or one saved by an older build — without ever throwing.
 *
 * ⚠️ The tool is checked against TOOLS and the modifiers against the lists the pickers offer,
 * rather than being cast. A width of 40 is a stroke that fills the canvas in one press and a
 * symmetry of 9,999 is a page that stops responding, and neither has to be malicious to happen:
 * a kit saved by a build whose slider went further is enough.
 */
export function readPaintKit(v: unknown): PaintKit | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const name = kitName(o.name)
  if (!name) return null
  return {
    name,
    tool: kitPick(TOOL_IDS, o.tool, 'brush'),
    colour: typeof o.colour === 'string' && HEX.test(o.colour) ? o.colour : '#22c55e',
    alpha: kitNum(o.alpha, 0.05, 1, 1),
    width: kitNum(o.width, 0.001, 0.08, 0.008),
    symmetry: kitPick(SYMMETRIES, o.symmetry, 0),
    echo: kitPick(ECHOES, o.echo, 0),
  }
}

export const paintKits = kitStore<PaintKit>('paint_kits_v1', readPaintKit)

/**
 * What you were last using, so the room opens where you left it.
 *
 * ⚠️ SEPARATE FROM THE NAMED ONES, and deliberately not one of them. Writing every tweak into the
 * saved list would fill it with twenty near-identical entries nobody chose to keep; a person's
 * last state and the setups they decided were worth a name are different things, and saved
 * palettes draws the same line.
 */
const LAST_KEY = 'paint_last_v1'

export function loadLastKit(): PaintKit | null {
  try {
    const raw = localStorage.getItem(LAST_KEY)
    return raw ? readPaintKit(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

export function saveLastKit(kit: Omit<PaintKit, 'name'>) {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify({ ...kit, name: 'last' }))
  } catch {
    /* private mode: the room simply opens at its defaults, as it always used to */
  }
}
