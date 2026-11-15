/**
 * What a Lab toy keeps between visits, read and written the one way — the half of it that needs no
 * React, so a toy's rules module can use it and still run anywhere: in a test, in a worker, and in
 * the edge function that will check matches by turns (docs/2026-11-14-lab-async-matches-plan.md,
 * step 0). The React hook over it is useKept, in kept.ts, which re-exports all of this.
 *
 * ⚠️ NOTHING HERE MAY IMPORT REACT OR TOUCH THE DOM WHEN THE MODULE LOADS. localStorage and window
 * are reached only inside these functions, at call time; serverRules.test.ts walks every rules
 * module's imports and fails on one that reaches React or a component.
 */

/** what is kept under `key`, through the toy's own reader; a store that refuses reads as nothing */
export function loadKept<T>(key: string, read: (text: string | null) => T): T {
  try {
    return read(localStorage.getItem(key))
  } catch {
    return read(null)
  }
}
/**
 * The event a Lab write announces in its own tab. The browser's `storage` event tells OTHER tabs
 * that something changed and never the tab that wrote it, so whatever shows a toy's result while
 * the toy is open (the Share your score box) would otherwise have to keep asking. Every Lab write
 * goes through writeKept, which says so here; resultWatch.test.ts fails on a write that does not.
 */
export const RESULT_EVENT = 'lab:result'

/**
 * Write a toy's stored text and announce it in this tab. Throws as localStorage does (private
 * mode, a full store), so a caller's own catch still decides what a refusal means; the event goes
 * out only for a write that happened.
 */
export function writeKept(key: string, text: string) {
  localStorage.setItem(key, text)
  if (typeof window !== 'undefined')
    window.dispatchEvent(new CustomEvent(RESULT_EVENT, { detail: { key } }))
}

/** keep it; a store that refuses — private mode — keeps it for this visit only */
export function storeKept(key: string, value: unknown) {
  try {
    writeKept(key, JSON.stringify(value))
  } catch {
    /* private mode: kept for this visit */
  }
}
/**
 * A count read back from the store: a whole number from nought up to just under `max`, or nought.
 * What is stored can be anything a person (or an old version) left there, so a count is believed
 * only when it is one. Forty-four readers had their own copy of this line, differing only in max.
 */
export const whole = (v: unknown, max = 1e6) =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < max ? v : 0
