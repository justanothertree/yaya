/**
 * What every share reader has in common: how it is handed storage, and the few ways results are
 * worded everywhere (bests.ts and the shares/<group>.ts files).
 */
export type Read = (key: string) => string | null
/** a toy's result in words, from what the toy keeps — or null when nothing worth sharing is kept */
export type Reader = (read: Read) => string | null

/** seconds as m:ss, or h:mm:ss past the hour */
export function clock(s: number): string {
  const t = Math.round(s)
  const [h, m, sec] = [Math.floor(t / 3600), Math.floor((t % 3600) / 60), t % 60]
  const ss = String(sec).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** "3 of 10 levels solved", or null when none are */
export const solved = (n: number, of: number, what = 'levels') =>
  n > 0 ? `${n} of ${of} ${what} solved` : null
