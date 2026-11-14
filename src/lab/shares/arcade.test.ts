import { describe, expect, it } from 'vitest'
import { ARCADE } from './arcade'
import { ARCHERY_KEY } from '../../gpu/archery'
import { ARTILLERY_KEY } from '../../gpu/artillery'
import { BOWLING_KEY } from '../../gpu/bowling'
import { BRICKS_KEY } from '../../gpu/bricks'
import { CURLING_KEY } from '../../gpu/curling'
import { DARTS_KEY } from '../../gpu/darts'
import { ECHO_KEY } from '../../gpu/echo'
import { HOCKEY_KEY } from '../../gpu/hockey'
import { KEEPY_KEY } from '../../gpu/keepy'
import { LANDER_KEY } from '../../gpu/lander'
import { POOL_KEY } from '../../gpu/pool'
import { POPPER_KEY } from '../../gpu/popper'
import { PUTT_KEY } from '../../gpu/putt'
import { ROCKS_KEY } from '../../gpu/rocks'
import { TIMETRIAL_KEY } from '../../gpu/timetrial'
import { TOWERS_KEY } from '../../gpu/towers'
import { TRAILS_KEY } from '../../gpu/trails'
import { MOBIUS_KEY, HOLES, SPACES } from '../../gpu/mobius'
import { PINBALL_KEY } from '../../gpu/pinball'
import { CROSSING_KEY, COURSES } from '../../gpu/crossing'
import { GUST_KEY } from '../../gpu/gust'
import { TUNNEL_KEY } from '../../gpu/tunnel'
import { STRUT_BEST_KEY } from '../../gpu/strut'
import { QUIZ_KEY } from '../../gpu/wallpaper'
import registry from '../../sections/labDemos.tsx?raw'

/** what the toy itself would have written under its own key, and nothing else */
const kept = (key: string, o: object) => (k: string) => (k === key ? JSON.stringify(o) : null)
const line = (id: string, key: string, o: object) => ARCADE[id](kept(key, o))

describe('arcade share readers', () => {
  it('are all real toys in the Lab', () => {
    expect(Object.keys(ARCADE).length).toBeGreaterThan(0)
    for (const id of Object.keys(ARCADE)) expect(registry, id).toContain(`id: '${id}'`)
  })

  it('say nothing when nothing is kept', () => {
    for (const [id, r] of Object.entries(ARCADE))
      expect(
        r(() => null),
        id,
      ).toBeNull()
  })

  it('archery: the best round, longer round on a tie, and the kept daily by its own date', () => {
    const fx = {
      bow: 'longbow',
      round: 'short',
      face: 'field',
      fletch: 3,
      sightPin: false,
      best: { 'longbow/short': 104, 'compound/long': 104, 'recurve/standard': 98 },
      daily: { day: '2026-3-7', total: 98 },
    }
    expect(line('archery', ARCHERY_KEY, fx)).toBe(
      'best 104 of 120 (Compound, long round), daily round 98 on 7 Mar',
    )
    expect(line('archery', ARCHERY_KEY, { ...fx, best: {}, daily: null })).toBeNull()
  })

  it('artillery: duels won against the hardest computer beaten, fewest shots overall', () => {
    const record = {
      easy: { won: 5, lost: 1, fewest: 1 },
      fair: { won: 0, lost: 4, fewest: 0 },
      hard: { won: 2, lost: 3, fewest: 4 },
    }
    expect(line('artillery', ARTILLERY_KEY, { level: 'easy', sky: 'night', record })).toBe(
      'won 2 of 5 duels against the Hard computer; best ever a win in 1 shot',
    )
    expect(
      line('artillery', ARTILLERY_KEY, { level: 'hard', record: { hard: { lost: 3 } } }),
    ).toBeNull()
  })

  it('bowling: best game, strikes and the hardest computer beaten', () => {
    const record = {
      easy: { won: 3, lost: 0, best: 190, strikes: 12 },
      fair: { won: 1, lost: 2, best: 214, strikes: 20 },
      hard: { won: 0, lost: 4, best: 150, strikes: 5 },
    }
    expect(line('bowling', BOWLING_KEY, { level: 'hard', lane: 'neon', record })).toBe(
      'best game 214, 37 strikes in all, won 1 of 3 games against the Fair computer',
    )
    expect(line('bowling', BOWLING_KEY, { level: 'hard', lane: 'neon' })).toBeNull()
  })

  it('bricks: best score and furthest wall', () => {
    const fx = {
      palette: 'earth',
      best: 12450,
      furthest: 7,
      today: { day: 123456, best: 9000 },
      drawnBest: 300,
    }
    expect(line('bricks', BRICKS_KEY, fx)).toBe('best 12,450 points, reached wall 7')
    expect(line('bricks', BRICKS_KEY, { palette: 'earth', best: 0, furthest: 0 })).toBeNull()
  })

  it('curling: games won (draws count as played) and the best end', () => {
    const record = {
      easy: { won: 2, lost: 0, drawn: 0, bestEnd: 3 },
      fair: { won: 1, lost: 1, drawn: 1, bestEnd: 4 },
      hard: { won: 0, lost: 2, drawn: 0, bestEnd: 1 },
    }
    expect(line('curling', CURLING_KEY, { level: 'hard', ends: 6, record })).toBe(
      'won 1 of 3 games against the Fair computer, best end 4',
    )
    expect(
      line('curling', CURLING_KEY, { level: 'hard', record: { hard: { lost: 2 } } }),
    ).toBeNull()
  })

  it('darts: matches won, best checkout, fastest leg and 180s across every level', () => {
    const record = {
      easy: { won: 2, lost: 0, best: 60, fewest: 18, tons: 1 },
      fair: { won: 0, lost: 1, best: 121, fewest: 15, tons: 0 },
      hard: { won: 1, lost: 2, best: 100, fewest: 21, tons: 2 },
    }
    expect(line('darts', DARTS_KEY, { level: 'easy', board: 'pub', record })).toBe(
      'won 1 of 3 matches against the Hard computer; best ever: checkout 121, a leg in 15 darts, 3 180s',
    )
    expect(line('darts', DARTS_KEY, { level: 'hard', record: { hard: { lost: 2 } } })).toBeNull()
  })

  it('echo: the longest tune, and how it was played', () => {
    const best = {
      strict: { 4: { echo: 9, mirror: 0 }, 6: { echo: 0, mirror: 0 } },
      gentle: { 4: { echo: 11, mirror: 0 }, 6: { echo: 0, mirror: 14 } },
    }
    expect(line('echo', ECHO_KEY, { pads: 4, mode: 'echo', strict: true, best })).toBe(
      'longest tune 14 notes on 6 pads, played back backwards, with 3 goes',
    )
    // a tie names the harder way: strict over gentle
    const tie = { ...best, strict: { ...best.strict, 4: { echo: 14, mirror: 0 } } }
    expect(line('echo', ECHO_KEY, { best: tie })).toBe('longest tune 14 notes on 4 pads')
    expect(line('echo', ECHO_KEY, { pads: 6, mode: 'mirror', strict: false })).toBeNull()
  })

  it('hockey: the record against the hardest computer beaten, with its widest and fastest wins', () => {
    const record = {
      rookie: { won: 5, lost: 0, streak: 0, bestStreak: 5, best: 4, fastest: 30 },
      club: { won: 0, lost: 3, streak: 0, bestStreak: 0, best: 0, fastest: 0 },
      pro: { won: 4, lost: 2, streak: 1, bestStreak: 3, best: 2, fastest: 48 },
    }
    expect(line('hockey', HOCKEY_KEY, { level: 'club', table: 'ice', to: 7, record })).toBe(
      'won 4 of 6 matches against the Pro computer, widest win by 2, fastest win 48 s, best run 3 in a row',
    )
    expect(line('hockey', HOCKEY_KEY, { level: 'pro', record: { pro: { lost: 3 } } })).toBeNull()
  })

  it('keepy-uppy: the best with any ball, calm or breezy', () => {
    const fx = {
      ball: 'balloon',
      field: 'night',
      breeze: true,
      best: {
        balloon: { calm: 40, breezy: 12 },
        beach: { calm: 20, breezy: 0 },
        football: { calm: 3, breezy: 87 },
      },
      played: 1234,
    }
    expect(line('keepy', KEEPY_KEY, fx)).toBe(
      'best 87 points with the football in the breeze (1,234 games)',
    )
    expect(line('keepy', KEEPY_KEY, { ball: 'football', played: 3 })).toBeNull()
  })

  it('lander: the best landing and the hardest autopilot beaten', () => {
    const record = {
      easy: { landed: 9, crashed: 1, beat: 5, best: 900 },
      fair: { landed: 2, crashed: 3, beat: 1, best: 1234 },
      hard: { landed: 1, crashed: 6, beat: 0, best: 400 },
    }
    expect(line('lander', LANDER_KEY, { level: 'hard', look: 'mars', record })).toBe(
      'best landing 1,234, beat the Fair autopilot once',
    )
    expect(
      line('lander', LANDER_KEY, { level: 'hard', record: { hard: { crashed: 5 } } }),
    ).toBeNull()
  })

  it('pool: games won against the hardest computer beaten', () => {
    const record = {
      easy: { won: 6, lost: 0 },
      fair: { won: 0, lost: 2 },
      hard: { won: 2, lost: 5 },
    }
    expect(line('pool', POOL_KEY, { level: 'easy', cloth: 'red', record })).toBe(
      'won 2 of 7 games against the Hard computer',
    )
    expect(line('pool', POOL_KEY, { level: 'easy', record: { easy: { lost: 3 } } })).toBeNull()
  })

  it('popper: the best score and how many colours it was with', () => {
    const fx = { colours: 4, look: 'gems', best: { 4: 900, 5: 12450, 6: 3000 }, games: 31 }
    expect(line('popper', POPPER_KEY, fx)).toBe('best 12,450 points with 5 colours (31 games)')
    expect(line('popper', POPPER_KEY, { colours: 6, games: 2 })).toBeNull()
  })

  it('putt: the fewest strokes round the course and the hardest computer beaten', () => {
    const record = {
      easy: { won: 3, lost: 0, tied: 0, best: 25 },
      fair: { won: 0, lost: 1, tied: 0, best: 22 },
      hard: { won: 1, lost: 2, tied: 1, best: 0 },
    }
    expect(line('putt', PUTT_KEY, { level: 'easy', theme: 'night', record })).toBe(
      'best round 22 strokes over the 6 holes, won 1 of 4 rounds against the Hard computer',
    )
    expect(line('putt', PUTT_KEY, { level: 'hard', record: { hard: { lost: 2 } } })).toBeNull()
  })

  it('rocks: the best score, the wilder pace on a tie', () => {
    const fx = {
      pace: 'calm',
      look: 'paper',
      best: { calm: 500, normal: 7000, wild: 7000 },
      games: 12,
    }
    expect(line('rocks', ROCKS_KEY, fx)).toBe('best 7,000 points at the wild pace (12 games)')
    expect(line('rocks', ROCKS_KEY, { pace: 'wild', games: 4 })).toBeNull()
  })

  it('time trial: best laps on the built-in tracks, never a daily track it cannot date', () => {
    const fx = {
      track: 'hairpins',
      colour: 2,
      best: {
        ring: { lap: 41.234, ghost: '' },
        hairpins: { lap: 62.5, ghost: '' },
        'day-12345': { lap: 30, ghost: '' },
      },
    }
    expect(line('timetrial', TIMETRIAL_KEY, fx)).toBe('The ring in 41.23 s, Hairpins in 1:02.50')
    expect(
      line('timetrial', TIMETRIAL_KEY, { track: 'today', best: { 'day-1': { lap: 30 } } }),
    ).toBeNull()
  })

  it('towers: most waves held on each map', () => {
    const fx = {
      map: 'river',
      theme: 'snow',
      fast: true,
      best: { meadow: 12, river: 23 },
      today: { day: 5, waves: 40 },
    }
    expect(line('towers', TOWERS_KEY, fx)).toBe('most waves held: Meadow 12, River 23')
    expect(
      line('towers', TOWERS_KEY, { map: 'river', fast: true, today: { day: 5, waves: 40 } }),
    ).toBeNull()
  })

  it('trails: rounds won against the hardest computer beaten and the longest ride', () => {
    const record = {
      easy: { won: 4, lost: 0, rounds: 4, longest: 300 },
      fair: { won: 0, lost: 2, rounds: 2, longest: 120 },
      hard: { won: 1, lost: 3, rounds: 4, longest: 1500 },
    }
    expect(line('trails', TRAILS_KEY, { level: 'easy', speed: 'frantic', record })).toBe(
      'won 1 of 4 rounds against the Hard computer, longest ride 1,500 squares',
    )
    expect(line('trails', TRAILS_KEY, { level: 'hard', rivals: 3 })).toBeNull()
  })

  /* the three whose parser moved out of the component for this (keptArcade.test.ts pins it) —
     kept out of order, so "furthest" is the toy's own order and not the last one kept */
  it('möbius golf: holes sunk, the furthest with its strokes and space', () => {
    const space = Object.keys(SPACES)[2] as keyof typeof SPACES
    const best = {
      [HOLES[3].name]: { strokes: 4, space },
      [HOLES[0].name]: { strokes: 1, space: 'room' },
    }
    expect(line('mobius', MOBIUS_KEY, { hole: 1, best })).toBe(
      `2 of ${HOLES.length} holes sunk, up to ${HOLES[3].name} in 4 strokes on the ${SPACES[space].name}`,
    )
    expect(line('mobius', MOBIUS_KEY, { hole: 2, best: {} })).toBeNull()
  })
  it('pinball: the best score and the table it was on', () => {
    expect(
      line('pinball', PINBALL_KEY, { best: { Flippers: 900, 'Night shift': 12340, Zero: 0 } }),
    ).toBe('best 12,340 points on the table “Night shift”')
    expect(line('pinball', PINBALL_KEY, { best: { Zero: 0 } })).toBeNull()
  })
  it('night crossing: courses crossed, the furthest with its time', () => {
    const best = { [COURSES[2].name]: 63.4, [COURSES[0].name]: 12 }
    expect(line('crossing', CROSSING_KEY, { course: 1, best })).toBe(
      `2 of ${COURSES.length} courses crossed, up to ${COURSES[2].name} in 63.4 s`,
    )
    expect(line('crossing', CROSSING_KEY, { course: 1, best: {} })).toBeNull()
  })

  /* the four that keep a result only since this draft (keptResults.test.ts pins the keeping) */
  it('gust: matches won at the hardest level with a win, and its shutouts', () => {
    const record = {
      gentle: { won: 9, lost: 1, shutouts: 6 },
      keen: { won: 3, lost: 2, shutouts: 2 },
      sharp: { won: 0, lost: 4, shutouts: 0 },
    }
    expect(line('gust', GUST_KEY, { level: 'sharp', record })).toBe(
      'won 3 of 5 matches against the Keen computer, 2 times without letting one in',
    )
    const lost = {
      ...record,
      gentle: { won: 0, lost: 1, shutouts: 0 },
      keen: { won: 0, lost: 2, shutouts: 0 },
    }
    expect(line('gust', GUST_KEY, { level: 'keen', record: lost })).toBeNull()
  })
  it('tunnel: the longest streak at each speed that has one, slowest first', () => {
    expect(line('tunnel', TUNNEL_KEY, { best: { warp: 7, cruise: 31, fast: 0 } })).toBe(
      'longest streak without a miss: 31 orbs at Cruise, 7 orbs at Warp',
    )
    expect(line('tunnel', TUNNEL_KEY, { best: { warp: 0, cruise: 0, fast: 0 } })).toBeNull()
  })
  it('strut: the fewest bars to the flag', () => {
    expect(ARCADE.strut((k) => (k === STRUT_BEST_KEY ? '3.25' : null))).toBe(
      'walked a creature to the flag in 3.3 bars',
    )
    expect(ARCADE.strut((k) => (k === STRUT_BEST_KEY ? '-1' : null))).toBeNull()
  })
  it('wallpaper: patterns named right of those asked, and the best run', () => {
    expect(line('wallpaper', QUIZ_KEY, { right: 14, asked: 20, bestRun: 6 })).toBe(
      'named 14 of 20 wallpaper patterns right, best run 6 in a row',
    )
    expect(line('wallpaper', QUIZ_KEY, { right: 1, asked: 4, bestRun: 1 })).toBe(
      'named 1 of 4 wallpaper patterns right',
    )
    expect(line('wallpaper', QUIZ_KEY, { right: 0, asked: 5, bestRun: 0 })).toBeNull()
  })
})
