import { describe, expect, it } from 'vitest'
import { BOARD, hardestWin, wonOf } from './board'
import * as backgammon from '../../gpu/backgammon'
import * as breakthrough from '../../gpu/breakthrough'
import * as chess from '../../gpu/chess'
import * as cribbage from '../../gpu/cribbage'
import * as cube from '../../gpu/cube'
import * as dominoes from '../../gpu/dominoes'
import * as dots from '../../gpu/dots'
import * as draughts from '../../gpu/draughts'
import * as eights from '../../gpu/eights'
import * as fences from '../../gpu/fences'
import * as fourrow from '../../gpu/fourrow'
import * as fox from '../../gpu/fox'
import * as gin from '../../gpu/gin'
import * as go from '../../gpu/goboard'
import * as gomoku from '../../gpu/gomoku'
import * as halma from '../../gpu/halma'
import * as hearts from '../../gpu/hearts'
import * as hex from '../../gpu/hex'
import * as liars from '../../gpu/liars'
import * as mancala from '../../gpu/mancala'
import * as morris from '../../gpu/morris'
import * as reversi from '../../gpu/reversi'
import * as seabattle from '../../gpu/seabattle'
import * as shut from '../../gpu/shut'
import * as spades from '../../gpu/spades'
import * as twentyone from '../../gpu/twentyone'
import * as ultimate from '../../gpu/ultimate'
import * as yacht from '../../gpu/yacht'
import { ONLINE_KEY } from '../social/online'
import registry from '../../sections/labDemos.tsx?raw'

/* a toy's value as the toy writes it — JSON, under its own key — typed by the toy's own Saved */
type Kept = { key: string; json: string }
const kept = <T>(key: string, value: T): Kept => ({ key, json: JSON.stringify(value) })
/* storage holding that and nothing else */
const at = (s: Kept) => (k: string) => (k === s.key ? s.json : null)
const nothing = () => null

/*
 * Each case: a fixture where every figure the reader uses is something other than its default —
 * every level, not only the one named, and each level different, so reading the wrong one shows —
 * and one that keeps play but nothing worth sharing (no win; the extras set anyway, so a reader
 * that shares them without a win shows too).
 */
type Case = { id: string; full: Kept; line: string; none: Kept }

const reversiFull = kept<reversi.Saved>(reversi.REVERSI_KEY, {
  ...reversi.EMPTY,
  record: {
    easy: { won: 9, lost: 0, drawn: 0, best: 40 },
    fair: { won: 4, lost: 1, drawn: 1, best: 22 },
    hard: { won: 2, lost: 2, drawn: 1, best: 18 },
  },
})

const cases: Case[] = [
  {
    id: 'backgammon',
    full: kept<backgammon.Saved>(backgammon.BACKGAMMON_KEY, {
      ...backgammon.EMPTY,
      record: {
        easy: { won: 4, lost: 1, points: 6, against: 1 },
        fair: { won: 2, lost: 2, points: 3, against: 4 },
        hard: { won: 3, lost: 5, points: 7, against: 9 },
      },
    }),
    line: 'won 3 of 8 games against the Hard computer, 7 points to 9',
    none: kept<backgammon.Saved>(backgammon.BACKGAMMON_KEY, {
      ...backgammon.EMPTY,
      record: {
        easy: { won: 0, lost: 1, points: 0, against: 2 },
        fair: { won: 0, lost: 2, points: 0, against: 3 },
        hard: { won: 0, lost: 3, points: 0, against: 5 },
      },
    }),
  },
  {
    id: 'breakthrough',
    full: kept<breakthrough.Saved>(breakthrough.BREAKTHROUGH_KEY, {
      ...breakthrough.EMPTY,
      record: {
        easy: { won: 9, lost: 1, fastest: 12 },
        fair: { won: 5, lost: 2, fastest: 17 },
        hard: { won: 2, lost: 1, fastest: 23 },
      },
    }),
    line: 'won 2 of 3 games against the Hard computer, quickest win in 23 moves',
    none: kept<breakthrough.Saved>(breakthrough.BREAKTHROUGH_KEY, {
      ...breakthrough.EMPTY,
      record: {
        easy: { won: 0, lost: 1, fastest: 12 },
        fair: { won: 0, lost: 2, fastest: 0 },
        hard: { won: 0, lost: 4, fastest: 23 },
      },
    }),
  },
  {
    id: 'chess',
    full: kept<chess.Saved>(chess.CHESS_KEY, {
      ...chess.EMPTY,
      record: {
        easy: { won: 6, lost: 1, drawn: 1 },
        fair: { won: 3, lost: 3, drawn: 0 },
        hard: { won: 1, lost: 4, drawn: 2 },
      },
    }),
    line: 'won 1 of 7 games against the Hard computer (2 drawn)',
    none: kept<chess.Saved>(chess.CHESS_KEY, {
      ...chess.EMPTY,
      record: {
        easy: { won: 0, lost: 1, drawn: 1 },
        fair: { won: 0, lost: 0, drawn: 4 },
        hard: { won: 0, lost: 3, drawn: 2 },
      },
    }),
  },
  {
    id: 'cribbage',
    full: kept<cribbage.Saved>(cribbage.CRIBBAGE_KEY, {
      ...cribbage.EMPTY,
      record: {
        easy: { won: 8, lost: 1, skunks: 5, best: 28 },
        fair: { won: 4, lost: 4, skunks: 1, best: 20 },
        hard: { won: 6, lost: 3, skunks: 2, best: 24 },
      },
    }),
    line: 'won 6 of 9 games against the Hard computer, 2 skunks, best hand 24',
    none: kept<cribbage.Saved>(cribbage.CRIBBAGE_KEY, {
      ...cribbage.EMPTY,
      record: {
        easy: { won: 0, lost: 1, skunks: 0, best: 12 },
        fair: { won: 0, lost: 2, skunks: 0, best: 16 },
        hard: { won: 0, lost: 3, skunks: 0, best: 29 },
      },
    }),
  },
  {
    id: 'cube',
    full: kept<cube.Saved>(cube.CUBE_KEY, {
      ...cube.EMPTY,
      record: {
        easy: { won: 7, lost: 0, drawn: 3 },
        fair: { won: 4, lost: 1, drawn: 0 },
        hard: { won: 2, lost: 2, drawn: 1 },
      },
    }),
    line: 'won 2 of 5 games against the Hard computer (1 drawn)',
    none: kept<cube.Saved>(cube.CUBE_KEY, {
      ...cube.EMPTY,
      record: {
        easy: { won: 0, lost: 1, drawn: 1 },
        fair: { won: 0, lost: 2, drawn: 0 },
        hard: { won: 0, lost: 3, drawn: 2 },
      },
    }),
  },
  {
    id: 'dominoes',
    full: kept<dominoes.Saved>(dominoes.DOMINOES_KEY, {
      ...dominoes.EMPTY,
      record: { easy: { won: 5, lost: 1 }, fair: { won: 2, lost: 2 }, hard: { won: 3, lost: 4 } },
    }),
    line: 'won 3 of 7 games against the Hard computer',
    none: kept<dominoes.Saved>(dominoes.DOMINOES_KEY, {
      ...dominoes.EMPTY,
      record: { easy: { won: 0, lost: 1 }, fair: { won: 0, lost: 2 }, hard: { won: 0, lost: 4 } },
    }),
  },
  {
    id: 'dots',
    full: kept<dots.Saved>(dots.DOTS_KEY, {
      ...dots.EMPTY,
      record: {
        easy: { won: 9, lost: 0, drawn: 2, best: 11 },
        fair: { won: 3, lost: 3, drawn: 0, best: 2 },
        hard: { won: 4, lost: 1, drawn: 1, best: 5 },
      },
    }),
    line: 'won 4 of 6 games against the Hard computer (1 drawn), widest win 5 boxes',
    none: kept<dots.Saved>(dots.DOTS_KEY, {
      ...dots.EMPTY,
      record: {
        easy: { won: 0, lost: 1, drawn: 2, best: 3 },
        fair: { won: 0, lost: 2, drawn: 0, best: 0 },
        hard: { won: 0, lost: 3, drawn: 1, best: 5 },
      },
    }),
  },
  {
    id: 'draughts',
    full: kept<draughts.Saved>(draughts.DRAUGHTS_KEY, {
      ...draughts.EMPTY,
      record: {
        easy: { won: 5, lost: 1, drawn: 0 },
        fair: { won: 2, lost: 0, drawn: 1 },
        hard: { won: 1, lost: 1, drawn: 3 },
      },
    }),
    line: 'won 1 of 5 games against the Hard computer (3 drawn)',
    none: kept<draughts.Saved>(draughts.DRAUGHTS_KEY, {
      ...draughts.EMPTY,
      record: {
        easy: { won: 0, lost: 1, drawn: 0 },
        fair: { won: 0, lost: 0, drawn: 1 },
        hard: { won: 0, lost: 1, drawn: 3 },
      },
    }),
  },
  {
    id: 'eights',
    full: kept<eights.Saved>(eights.EIGHTS_KEY, {
      ...eights.EMPTY,
      record: {
        easy: { won: 6, played: 7 },
        fair: { won: 2, played: 5 },
        hard: { won: 3, played: 8 },
      },
    }),
    line: 'won 3 of 8 games on Hard',
    none: kept<eights.Saved>(eights.EIGHTS_KEY, {
      ...eights.EMPTY,
      record: {
        easy: { won: 0, played: 2 },
        fair: { won: 0, played: 5 },
        hard: { won: 0, played: 8 },
      },
    }),
  },
  {
    id: 'fences',
    full: kept<fences.Saved>(fences.FENCES_KEY, {
      ...fences.EMPTY,
      record: {
        easy: { won: 4, lost: 0, best: 9 },
        fair: { won: 1, lost: 1, best: 11 },
        hard: { won: 2, lost: 1, best: 14 },
      },
    }),
    line: 'won 2 of 3 games against the Hard computer, quickest win in 14 moves',
    none: kept<fences.Saved>(fences.FENCES_KEY, {
      ...fences.EMPTY,
      record: {
        easy: { won: 0, lost: 1, best: 9 },
        fair: { won: 0, lost: 1, best: 0 },
        hard: { won: 0, lost: 2, best: 14 },
      },
    }),
  },
  {
    id: 'fourrow',
    full: kept<fourrow.Saved>(fourrow.FOUR_KEY, {
      ...fourrow.EMPTY,
      record: {
        easy: { won: 12, lost: 0, drawn: 0, fastest: 7 },
        fair: { won: 3, lost: 3, drawn: 2, fastest: 9 },
        hard: { won: 5, lost: 2, drawn: 1, fastest: 11 },
      },
    }),
    line: 'won 5 of 8 games against the Hard computer (1 drawn), quickest win in 11 moves',
    none: kept<fourrow.Saved>(fourrow.FOUR_KEY, {
      ...fourrow.EMPTY,
      record: {
        easy: { won: 0, lost: 1, drawn: 0, fastest: 7 },
        fair: { won: 0, lost: 3, drawn: 2, fastest: 0 },
        hard: { won: 0, lost: 2, drawn: 1, fastest: 11 },
      },
    }),
  },
  {
    id: 'fox',
    full: kept<fox.Saved>(fox.FOX_KEY, {
      ...fox.EMPTY,
      record: { geese: { won: 3, lost: 2, drawn: 1 }, fox: { won: 1, lost: 4, drawn: 0 } },
    }),
    line: 'won 3 of 6 games as the geese (1 drawn), won 1 of 5 games as the fox',
    none: kept<fox.Saved>(fox.FOX_KEY, {
      ...fox.EMPTY,
      record: { geese: { won: 0, lost: 2, drawn: 1 }, fox: { won: 0, lost: 4, drawn: 2 } },
    }),
  },
  {
    id: 'gin',
    full: kept<gin.Saved>(gin.GIN_KEY, {
      ...gin.EMPTY,
      record: { easy: { won: 7, lost: 1, gins: 3 }, hard: { won: 2, lost: 3, gins: 4 } },
    }),
    line: 'won 2 of 5 games against the Hard computer, went gin 4 times',
    none: kept<gin.Saved>(gin.GIN_KEY, {
      ...gin.EMPTY,
      record: { easy: { won: 0, lost: 1, gins: 1 }, hard: { won: 0, lost: 3, gins: 2 } },
    }),
  },
  {
    id: 'go',
    full: kept<go.Saved>(go.GO_KEY, {
      ...go.EMPTY,
      record: { easy: { won: 4, lost: 0 }, fair: { won: 2, lost: 3 }, hard: { won: 1, lost: 6 } },
    }),
    line: 'won 1 of 7 games against the Hard computer',
    none: kept<go.Saved>(go.GO_KEY, {
      ...go.EMPTY,
      record: { easy: { won: 0, lost: 1 }, fair: { won: 0, lost: 3 }, hard: { won: 0, lost: 6 } },
    }),
  },
  {
    id: 'gomoku',
    full: kept<gomoku.Saved>(gomoku.GOMOKU_KEY, {
      ...gomoku.EMPTY,
      record: {
        easy: { won: 8, lost: 0, drawn: 0 },
        fair: { won: 3, lost: 2, drawn: 2 },
        hard: { won: 4, lost: 2, drawn: 1 },
      },
    }),
    line: 'won 4 of 7 games against the Hard computer (1 drawn)',
    none: kept<gomoku.Saved>(gomoku.GOMOKU_KEY, {
      ...gomoku.EMPTY,
      record: {
        easy: { won: 0, lost: 1, drawn: 0 },
        fair: { won: 0, lost: 2, drawn: 2 },
        hard: { won: 0, lost: 2, drawn: 1 },
      },
    }),
  },
  {
    id: 'halma',
    full: kept<halma.Saved>(halma.HALMA_KEY, {
      ...halma.EMPTY,
      record: {
        easy: { won: 3, lost: 0, fewest: 30 },
        fair: { won: 1, lost: 1, fewest: 35 },
        hard: { won: 2, lost: 2, fewest: 38 },
      },
    }),
    line: 'won 2 of 4 games against the Hard computer, quickest win in 38 moves',
    none: kept<halma.Saved>(halma.HALMA_KEY, {
      ...halma.EMPTY,
      record: {
        easy: { won: 0, lost: 1, fewest: 30 },
        fair: { won: 0, lost: 1, fewest: 0 },
        hard: { won: 0, lost: 2, fewest: 38 },
      },
    }),
  },
  {
    id: 'hearts',
    full: kept<hearts.Saved>(hearts.HEARTS_KEY, {
      ...hearts.EMPTY,
      record: {
        easy: { won: 5, played: 6, moons: 3 },
        fair: { won: 1, played: 4, moons: 2 },
        hard: { won: 2, played: 7, moons: 1 },
      },
    }),
    line: 'won 2 of 7 games on Hard, shot the moon once',
    none: kept<hearts.Saved>(hearts.HEARTS_KEY, {
      ...hearts.EMPTY,
      record: {
        easy: { won: 0, played: 2, moons: 1 },
        fair: { won: 0, played: 4, moons: 0 },
        hard: { won: 0, played: 7, moons: 1 },
      },
    }),
  },
  {
    id: 'hex',
    full: kept<hex.Saved>(hex.HEX_KEY, {
      ...hex.EMPTY,
      record: {
        easy: { won: 10, lost: 1, streak: 7, best: 8 },
        fair: { won: 3, lost: 2, streak: 0, best: 2 },
        hard: { won: 6, lost: 3, streak: 2, best: 4 },
      },
    }),
    line: 'won 6 of 9 games against the Hard computer, best run 4 in a row',
    none: kept<hex.Saved>(hex.HEX_KEY, {
      ...hex.EMPTY,
      record: {
        easy: { won: 0, lost: 1, streak: 0, best: 3 },
        fair: { won: 0, lost: 2, streak: 0, best: 0 },
        hard: { won: 0, lost: 3, streak: 0, best: 4 },
      },
    }),
  },
  {
    id: 'liars',
    full: kept<liars.Saved>(liars.LIARS_KEY, {
      ...liars.EMPTY,
      record: {
        easy: { won: 4, lost: 1, caught: 6, fooled: 2 },
        fair: { won: 2, lost: 2, caught: 3, fooled: 1 },
        hard: { won: 3, lost: 5, caught: 11, fooled: 4 },
      },
    }),
    line: 'won 3 of 8 games on Hard, caught 11 lies',
    none: kept<liars.Saved>(liars.LIARS_KEY, {
      ...liars.EMPTY,
      record: {
        easy: { won: 0, lost: 1, caught: 2, fooled: 2 },
        fair: { won: 0, lost: 2, caught: 0, fooled: 1 },
        hard: { won: 0, lost: 5, caught: 11, fooled: 4 },
      },
    }),
  },
  {
    id: 'mancala',
    full: kept<mancala.Saved>(mancala.MANCALA_KEY, {
      ...mancala.EMPTY,
      record: {
        easy: { won: 7, lost: 1, drawn: 0, best: 20 },
        fair: { won: 2, lost: 2, drawn: 1, best: 6 },
        hard: { won: 3, lost: 1, drawn: 2, best: 12 },
      },
    }),
    line: 'won 3 of 6 games against the Hard computer (2 drawn), widest win 12 seeds',
    none: kept<mancala.Saved>(mancala.MANCALA_KEY, {
      ...mancala.EMPTY,
      record: {
        easy: { won: 0, lost: 1, drawn: 0, best: 20 },
        fair: { won: 0, lost: 2, drawn: 1, best: 0 },
        hard: { won: 0, lost: 1, drawn: 2, best: 12 },
      },
    }),
  },
  {
    id: 'morris',
    full: kept<morris.Saved>(morris.MORRIS_KEY, {
      ...morris.EMPTY,
      record: {
        easy: { won: 6, lost: 0, drawn: 1 },
        fair: { won: 1, lost: 1, drawn: 0 },
        hard: { won: 2, lost: 3, drawn: 4 },
      },
    }),
    line: 'won 2 of 9 games against the Hard computer (4 drawn)',
    none: kept<morris.Saved>(morris.MORRIS_KEY, {
      ...morris.EMPTY,
      record: {
        easy: { won: 0, lost: 1, drawn: 1 },
        fair: { won: 0, lost: 1, drawn: 0 },
        hard: { won: 0, lost: 3, drawn: 4 },
      },
    }),
  },
  {
    id: 'reversi',
    full: kept<reversi.Saved>(reversi.REVERSI_KEY, {
      ...reversi.EMPTY,
      record: {
        easy: { won: 9, lost: 0, drawn: 0, best: 40 },
        fair: { won: 4, lost: 1, drawn: 1, best: 22 },
        hard: { won: 2, lost: 2, drawn: 1, best: 18 },
      },
    }),
    line: 'won 2 of 5 games against the Hard computer (1 drawn), widest win 18 discs',
    none: kept<reversi.Saved>(reversi.REVERSI_KEY, {
      ...reversi.EMPTY,
      record: {
        easy: { won: 0, lost: 1, drawn: 0, best: 40 },
        fair: { won: 0, lost: 1, drawn: 1, best: 0 },
        hard: { won: 0, lost: 2, drawn: 1, best: 18 },
      },
    }),
  },
  {
    id: 'seabattle',
    full: kept<seabattle.Saved>(seabattle.SEA_KEY, {
      ...seabattle.EMPTY,
      record: {
        easy: { won: 5, lost: 0, fewest: 29 },
        fair: { won: 2, lost: 1, fewest: 35 },
        hard: { won: 3, lost: 2, fewest: 41 },
      },
    }),
    line: 'won 3 of 5 games against the Hard computer, quickest win in 41 shots',
    none: kept<seabattle.Saved>(seabattle.SEA_KEY, {
      ...seabattle.EMPTY,
      record: {
        easy: { won: 0, lost: 1, fewest: 29 },
        fair: { won: 0, lost: 1, fewest: 0 },
        hard: { won: 0, lost: 2, fewest: 41 },
      },
    }),
  },
  {
    id: 'shut',
    full: kept<shut.Saved>(shut.SHUT_KEY, {
      ...shut.EMPTY,
      record: {
        easy: { won: 4, lost: 0, drawn: 0 },
        fair: { won: 1, lost: 2, drawn: 0 },
        hard: { won: 2, lost: 1, drawn: 1 },
      },
      best: 0,
      shut: 3,
      turns: 14,
    }),
    line: 'won 2 of 4 games against the Hard computer (1 drawn), box shut 3 times in 14 games alone',
    none: kept<shut.Saved>(shut.SHUT_KEY, {
      ...shut.EMPTY,
      record: {
        easy: { won: 0, lost: 1, drawn: 0 },
        fair: { won: 0, lost: 2, drawn: 1 },
        hard: { won: 0, lost: 1, drawn: 1 },
      },
    }),
  },
  {
    id: 'spades',
    full: kept<spades.Saved>(spades.SPADES_KEY, {
      ...spades.EMPTY,
      record: {
        easy: { won: 6, played: 8, nils: 5 },
        fair: { won: 1, played: 3, nils: 1 },
        hard: { won: 4, played: 9, nils: 2 },
      },
    }),
    line: 'won 4 of 9 games on Hard, made nil twice',
    none: kept<spades.Saved>(spades.SPADES_KEY, {
      ...spades.EMPTY,
      record: {
        easy: { won: 0, played: 2, nils: 1 },
        fair: { won: 0, played: 3, nils: 0 },
        hard: { won: 0, played: 9, nils: 2 },
      },
    }),
  },
  {
    id: 'twentyone',
    full: kept<twentyone.Saved>(twentyone.TWENTYONE_KEY, {
      ...twentyone.EMPTY,
      chips: 1800,
      peak: 2450,
      rebuys: 1,
      hands: 312,
      agreed: 87,
      decided: 100,
    }),
    line: 'most chips ever 2,450 over 312 hands, 87% of decisions by the book',
    // played, and agreed with the book, but never held more than the bank's starting chips
    none: kept<twentyone.Saved>(twentyone.TWENTYONE_KEY, {
      ...twentyone.EMPTY,
      chips: 900,
      peak: twentyone.START_CHIPS,
      hands: 40,
      agreed: 20,
      decided: 30,
    }),
  },
  {
    id: 'ultimate',
    full: kept<ultimate.Saved>(ultimate.ULTIMATE_KEY, {
      ...ultimate.EMPTY,
      record: {
        easy: { won: 5, lost: 1, drawn: 0 },
        fair: { won: 3, lost: 0, drawn: 1 },
        hard: { won: 1, lost: 2, drawn: 2 },
      },
    }),
    line: 'won 1 of 5 games against the Hard computer (2 drawn)',
    none: kept<ultimate.Saved>(ultimate.ULTIMATE_KEY, {
      ...ultimate.EMPTY,
      record: {
        easy: { won: 0, lost: 1, drawn: 0 },
        fair: { won: 0, lost: 0, drawn: 1 },
        hard: { won: 0, lost: 2, drawn: 2 },
      },
    }),
  },
  {
    id: 'yacht',
    full: kept<yacht.Saved>(yacht.YACHT_KEY, {
      ...yacht.EMPTY,
      record: {
        easy: { won: 6, lost: 1, drawn: 0 },
        fair: { won: 2, lost: 2, drawn: 0 },
        hard: { won: 3, lost: 2, drawn: 1 },
      },
      best: 241,
    }),
    line: 'won 3 of 6 games against the Hard computer (1 drawn), best game alone 241',
    none: kept<yacht.Saved>(yacht.YACHT_KEY, {
      ...yacht.EMPTY,
      record: {
        easy: { won: 0, lost: 1, drawn: 0 },
        fair: { won: 0, lost: 2, drawn: 1 },
        hard: { won: 0, lost: 2, drawn: 1 },
      },
    }),
  },
]

describe('board and card toys share their record', () => {
  it('has a case for every reader, and a reader for every case', () => {
    expect(cases.map((c) => c.id).sort()).toEqual(Object.keys(BOARD).sort())
  })
  for (const c of cases) {
    describe(c.id, () => {
      it('says nothing with nothing kept', () => expect(BOARD[c.id](nothing)).toBeNull())
      it('words what is kept', () => {
        const line = BOARD[c.id](at(c.full))
        expect(line).toBe(c.line)
        expect(line!.length).toBeLessThan(120)
      })
      it('says nothing when nothing was won', () => expect(BOARD[c.id](at(c.none))).toBeNull())
      it('reads the toy’s own key and no other', () => {
        // the same value under every key but its own is somebody else's storage
        expect(BOARD[c.id]((k) => (k === c.full.key ? null : c.full.json))).toBeNull()
      })
    })
  }

  it('names the hardest level with a win, with that level’s own figures', () => {
    const read = kept<fourrow.Saved>(fourrow.FOUR_KEY, {
      ...fourrow.EMPTY,
      record: {
        easy: { won: 12, lost: 0, drawn: 0, fastest: 7 },
        fair: { won: 1, lost: 3, drawn: 0, fastest: 15 },
        hard: { won: 0, lost: 6, drawn: 2, fastest: 0 },
      },
    })
    expect(BOARD.fourrow(at(read))).toBe(
      'won 1 of 4 games against the Fair computer, quickest win in 15 moves',
    )
    const lv = ['easy', 'fair', 'hard'] as const
    const t = (won: number) => ({ won, lost: 1 })
    expect(hardestWin(lv, { easy: t(1), fair: t(0), hard: t(0) })?.level).toBe('easy')
    expect(hardestWin(lv, { easy: t(0), fair: t(0), hard: t(0) })).toBeNull()
  })

  it('counts in words that fit the number', () => {
    expect(wonOf({ won: 1, lost: 0 }, 'x')).toBe('won 1 of 1 game x')
    const one = kept<dots.Saved>(dots.DOTS_KEY, {
      ...dots.EMPTY,
      record: { ...dots.EMPTY.record, hard: { won: 1, lost: 0, drawn: 0, best: 1 } },
    })
    expect(BOARD.dots(at(one))).toBe('won 1 of 1 game against the Hard computer, widest win 1 box')
  })

  it('reversi adds games won in a call, and shares them even with no win against the computer', () => {
    const online = JSON.stringify({
      reversi: { versus: { won: 2, lost: 1, drawn: 0 }, together: { won: 1, lost: 0, drawn: 1 } },
      chess: { versus: { won: 5, lost: 0, drawn: 0 } },
    })
    const both = (k: string) =>
      k === ONLINE_KEY ? online : k === reversi.REVERSI_KEY ? reversiFull.json : null
    expect(BOARD.reversi(both)).toBe(
      'won 2 of 5 games against the Hard computer (1 drawn), widest win 18 discs, beat friends in 2 of 3 online games, won 1 of 2 online games together against the computer (1 drawn)',
    )
    expect(BOARD.reversi((k) => (k === ONLINE_KEY ? online : null))).toBe(
      'beat friends in 2 of 3 online games, won 1 of 2 online games together against the computer (1 drawn)',
    )
  })

  it('shut the box shares a lowest score alone even with no win against the computer', () => {
    const read = kept<shut.Saved>(shut.SHUT_KEY, { ...shut.EMPTY, best: 4, shut: 0, turns: 6 })
    expect(BOARD.shut(at(read))).toBe('lowest left alone 4 in 6 games')
  })

  it('a broken store is nothing to share, never a crash', () => {
    for (const id of Object.keys(BOARD)) {
      expect(
        BOARD[id](() => '{'),
        id,
      ).toBeNull()
      expect(
        BOARD[id](() => '[1,2]'),
        id,
      ).toBeNull()
    }
  })

  it('only names toys the Lab has', () => {
    for (const id of Object.keys(BOARD)) expect(registry, id).toContain(`id: '${id}'`)
  })
})
