/**
 * The names of the toys a match by turns can be played on, and nothing else.
 *
 * ⚠️ ITS OWN MODULE BECAUSE THE BELL IMPORTS IT. useNotifications is mounted on every page, so
 * whatever it imports is in the bundle every visitor downloads. games.ts holds the toys' rules —
 * the whole chess and reversi engines — and the bell needs only a word for each. games.test.ts
 * checks the two lists name the same toys.
 */
export const MATCH_NAMES: Record<string, string> = {
  reversi: 'Reversi',
  chess: 'Chess',
  pool: 'Pool',
  gomoku: 'Five in a row',
}

/** the toy's name, for a bell entry or a row, whatever the toy */
export const toyName = (demo: string) =>
  Object.hasOwn(MATCH_NAMES, demo) ? MATCH_NAMES[demo] : 'a Lab game'
