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
  draughts: 'Draughts',
  dots: 'Dots and boxes',
  fourrow: 'Four in a row',
  mancala: 'Mancala',
  morris: 'Nine men’s morris',
  hex: 'Hex',
  ultimate: 'Ultimate noughts',
  breakthrough: 'Breakthrough',
  fences: 'Fences',
  halma: 'Chinese checkers',
  go: 'Go',
  fox: 'Fox and geese',
  cube: 'Noughts and crosses in a cube',
  artillery: 'Artillery',
  bowling: 'Bowling',
  curling: 'Curling',
  putt: 'Putt',
  darts: 'Darts',
  backgammon: 'Backgammon',
  seabattle: 'Sea battle',
  dice: 'Ten thousand',
  yacht: 'Yacht',
  shut: 'Shut the box',
  codebreaker: 'Codebreaker',
  shadowbox: 'Shadow box',
  rps: 'Rock, paper, scissors',
  gin: 'Gin rummy',
  cribbage: 'Cribbage',
  dominoes: 'Dominoes',
  hearts: 'Hearts',
  spades: 'Spades',
  eights: 'Crazy eights',
  liars: "Liar's dice",
  poker: 'Hold’em',
  lamps: 'Lamps',
  twentyone: 'Twenty-one',
}

/** the toy's name, for a bell entry or a row, whatever the toy */
export const toyName = (demo: string) =>
  Object.hasOwn(MATCH_NAMES, demo) ? MATCH_NAMES[demo] : 'a Lab game'

/**
 * The computer's levels for Together, easiest first: the same three for every toy that has a
 * match. Here, beside the names, so a page that only offers a challenge (a profile) can list them
 * without importing every toy's rules; games.test.ts checks each toy's own list agrees.
 */
export const MATCH_LEVELS = ['easy', 'fair', 'hard'] as const

/**
 * The toys whose match is versus alone, so a challenge offers no Together and no level: a duel
 * with no computer side (Lamps), or a table the computers only fill (Hearts, whose computers play
 * at the level chosen on the toy). Beside the names for the same reason as the levels;
 * games.test.ts checks it against each toy's own modes.
 */
export const VERSUS_ONLY: ReadonlySet<string> = new Set(['lamps', 'hearts'])

/**
 * How a challenge names a toy's two modes, and which it offers first, where "Versus" and
 * "Together" would mislead. Spades is a partnership game, so the challenger picks partners: the two
 * friends together against two computers by default (Evan's call, 17 Nov 2026), or each friend
 * partnered with a computer, against each other.
 */
const MODE_WORDS: Record<
  string,
  { first: 'versus' | 'together'; versus: string; together: string }
> = {
  spades: {
    first: 'together',
    versus: '⚔️ Each with a computer partner',
    together: '🤝 Partners, against two computers',
  },
}
export const modeWords = (demo: string) =>
  MODE_WORDS[demo] ?? {
    first: 'versus' as const,
    versus: '⚔️ Versus',
    together: '🤝 Together against the computer',
  }
export const LEVEL_NAMES: Record<string, string> = { easy: 'Easy', fair: 'Fair', hard: 'Hard' }
