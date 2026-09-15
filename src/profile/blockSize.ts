/**
 * What a block's config costs, measured the way the server measures it.
 *
 * ⚠️ ITS OWN FILE because fast refresh only works when a component file exports components,
 * and a size budget is not one. It lived in ProfileBlocks.tsx until the pet picker needed it too
 * — a pet is a whole drawing, so that block's budget is the one most likely to run out.
 */

/** Must stay in step with the length() guard in save_my_profile_blocks. */
export const CONFIG_LIMIT = 16000

/**
 * How big the server will think this block's config is.
 *
 * ⚠️ THE WHOLE CONFIG, because that is what `length(e->>'config')` measures on the other end. The
 * two pickers each measured only their own field — the song, or the chosen drawings — so both
 * under-reported, and a block could be shown as using 62% of its room while the config it would
 * actually send was over the cap. The save then failed with "invalid block", a message about the
 * SHAPE of the data for a problem that is really "this is too long".
 */
/**
 * Postgres writes jsonb back with a space after every `:` and every `,`; JSON.stringify does not.
 *
 * ⚠️ THIS IS NOT A ROUNDING ERROR ON A PACKED DRAWING. A drawing is thousands of
 * comma-separated numbers, so it is very nearly one extra character per number — measured at 25.6%
 * on a twelve-stroke drawing, which means a config the meter showed as 15,999 of 16,000 arrives as
 * about 20,100 and is refused. The error is 'invalid block', a message about the SHAPE of the data
 * for a problem that is really "this is too long", which is the worst possible way to be told.
 *
 * Counted from the VALUE rather than by scanning the text, so a comma inside a string is not
 * mistaken for a separator. Verified exact against Postgres on a sample containing both.
 */
const separators = (v: unknown): number => {
  if (Array.isArray(v)) return Math.max(0, v.length - 1) + v.reduce((n, x) => n + separators(x), 0)
  if (v && typeof v === 'object') {
    const keys = Object.keys(v as object)
    return (
      Math.max(0, keys.length - 1) +
      keys.length +
      keys.reduce((n, k) => n + separators((v as Record<string, unknown>)[k]), 0)
    )
  }
  return 0
}

export const configSize = (config: Record<string, unknown>) => {
  const c = config ?? {}
  return JSON.stringify(c).length + separators(c)
}
