import { describe, expect, it } from 'vitest'
import {
  codeRules,
  crackedIn,
  readCodeMove,
  readCodeSettings,
  replayPublic,
  whoseGuess,
  type CodeGame,
} from './codebreakerRoom'

const RULES = { length: 4, colours: 6, repeats: true, tries: 10 }
const R = codeRules(RULES)

/** a guess's marks, counted here rather than by the toy: in place, then shared colours less those */
function marks(code: number[], guess: number[]) {
  const exact = code.filter((c, i) => guess[i] === c).length
  let shared = 0
  for (let c = 0; c < 8; c++)
    shared += Math.min(code.filter((x) => x === c).length, guess.filter((x) => x === c).length)
  return { exact, near: shared - exact }
}

function seeded(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

/** both codes set, as the server has them once the friend has said yes and the challenger guessed */
const begun = (a: number[], b: number[]): CodeGame => {
  const g = R.hidden!.accept(R.fresh(), b, 'versus')!
  return R.apply(g, { guess: [0, 0, 0, 0], code: a })
}

describe('codebreaker by turns: the race', () => {
  it('reads the toy’s own settings and nothing else', () => {
    expect(readCodeSettings({})).toEqual(RULES)
    expect(readCodeSettings({ length: 5, colours: 8, repeats: false, tries: 12 })).toEqual({
      length: 5,
      colours: 8,
      repeats: false,
      tries: 12,
    })
    for (const bad of [{ length: 6 }, { colours: 3 }, { repeats: 1 }, { tries: 9 }])
      expect(readCodeSettings(bad)).toBeNull()
  })

  it('lets nobody guess at a code that is not set, and takes each side’s code once', () => {
    const g0 = R.fresh()
    expect(whoseGuess(g0)).toBe(0)
    // the friend's code is not set yet: there is nothing to guess at
    expect(R.legal(g0, { guess: [0, 1, 2, 3], code: [1, 1, 1, 1] }, 0)).toBe(false)
    const g1 = R.hidden!.accept(g0, [5, 4, 3, 2], 'versus')!
    expect(g1.placed).toEqual([false, true])
    // the challenger's first guess must bring their code, a code the rules allow
    expect(R.legal(g1, { guess: [0, 1, 2, 3] }, 0)).toBe(false)
    expect(R.legal(g1, { guess: [0, 1, 2, 3], code: [6, 1, 1, 1] }, 0)).toBe(false)
    expect(R.legal(g1, { guess: [0, 1, 2, 3], code: [1, 1, 1, 1] }, 1)).toBe(false)
    expect(R.legal(g1, { guess: [0, 1, 2, 3], code: [1, 1, 1, 1] }, 0)).toBe(true)
    const g2 = R.apply(g1, { guess: [0, 1, 2, 3], code: [1, 1, 1, 1] })
    expect(g2.guesses).toEqual([
      { by: 0, guess: [0, 1, 2, 3], mark: marks([5, 4, 3, 2], [0, 1, 2, 3]) },
    ])
    // and nobody sets one twice
    expect(R.legal(g2, { guess: [0, 0, 0, 0], code: [2, 2, 2, 2] }, 1)).toBe(false)
    expect(R.legal(g2, { guess: [0, 0, 0, 0] }, 1)).toBe(true)
    // without repeats, a code with a colour twice is refused, as a guess and as a code
    const once = codeRules({ ...RULES, repeats: false })
    expect(once.hidden!.accept(once.fresh(), [1, 1, 2, 3], 'versus')).toBeNull()
    const o1 = once.hidden!.accept(once.fresh(), [1, 0, 2, 3], 'versus')!
    expect(once.legal(o1, { guess: [0, 0, 1, 2], code: [3, 2, 1, 0] }, 0)).toBe(false)
  })

  it('gives the second side as many guesses as the first, and ends it then, every way round', () => {
    // a race played out by a rule written here: whoever has had fewer guesses goes, the
    // challenger on a tie, and it is over once both are done or one cracked it in k and the
    // other has had k
    const rnd = seeded(7)
    const outcomes = new Set<string>()
    for (let n = 0; n < 300; n++) {
      const pick = () => Array.from({ length: 4 }, () => Math.floor(rnd() * 6))
      const codes = [pick(), pick()]
      let g = R.hidden!.accept(R.fresh(), codes[1], 'versus')!
      const had = [0, 0]
      const took: (number | null)[] = [null, null]
      const over = () =>
        [0, 1].every((s) => took[s] !== null || had[s] >= 10) ||
        [0, 1].some((s) => took[s] !== null && had[1 - s] >= took[s]!)
      for (let k = 0; k < 40 && !over(); k++) {
        const doneS = (s: number) => took[s] !== null || had[s] >= 10
        const by = doneS(0) ? 1 : doneS(1) ? 0 : had[1] < had[0] ? 1 : 0
        expect(whoseGuess(g)).toBe(by)
        const guess = rnd() < 0.15 ? codes[1 - by] : pick()
        g = R.apply(g, k === 0 ? { guess, code: codes[0] } : { guess })
        had[by]++
        if (took[by] === null && marks(codes[1 - by], guess).exact === 4) took[by] = had[by]
      }
      expect(over()).toBe(true)
      expect(whoseGuess(g)).toBeNull()
      expect([crackedIn(g, 0), crackedIn(g, 1)]).toEqual(took)
      const [a, b] = took
      const want =
        a === null && b === null
          ? 'draw'
          : b === null || (a !== null && a < b)
            ? 0
            : a === null || b! < a
              ? 1
              : 'draw'
      expect(R.result!(g)).toBe(want)
      outcomes.add(`${want}:${a === null ? 'x' : 'c'}${b === null ? 'x' : 'c'}`)
    }
    // wins each way, a draw by matching, and a draw with nobody cracking it
    for (const o of ['0:cx', '1:xc', 'draw:cc', 'draw:xx']) expect(outcomes).toContain(o)
  })

  it('travels without the codes until it is over, then with both, every field as it was', () => {
    const A = [5, 5, 0, 1]
    const B = [1, 2, 3, 4]
    let g = begun(A, B)
    g = R.apply(g, { guess: [1, 2, 3, 3] })
    const mid = JSON.parse(JSON.stringify(R.encode(g)))
    expect(JSON.stringify(mid)).not.toContain('codes')
    const back = R.decode(mid)!
    expect(back.codes).toEqual([null, null])
    expect(back.guesses).toEqual(g.guesses)
    expect(back.placed).toEqual([true, true])
    // put back on the server with its secret, it is the game it was
    expect(R.hidden!.join(back, R.hidden!.secret(g))).toEqual(g)
    // finished: Ann cracks it, Bo misses with his matching guess
    g = R.apply(g, { guess: B })
    g = R.apply(g, { guess: [0, 0, 0, 0] })
    expect(R.result!(g)).toBe(0)
    const end = R.decode(JSON.parse(JSON.stringify(R.encode(g))))!
    expect(end).toEqual(g)
  })

  it('refuses a race whose marks its codes do not give, and codes shown early', () => {
    const A = [5, 5, 0, 1]
    const B = [1, 2, 3, 4]
    let g = begun(A, B)
    g = R.apply(g, { guess: [1, 2, 3, 3] })
    const w = R.encode(g) as { placed: boolean[]; guesses: number[][] }
    // the wrong marks are fine to a browser, which cannot check them, and refused with the codes
    const lied = { ...w, guesses: [w.guesses[0], [1, 2, 3, 3, 4, 0]] }
    expect(R.hidden!.join(R.decode(lied)!, R.hidden!.secret(g))).toBeNull()
    expect(R.decode({ ...w, codes: [A, B] })).toBeNull()
    // a mark that is no mark, a guess out of turn, a guess before both codes are set
    expect(R.decode({ ...w, guesses: [[1, 2, 3, 3, 3, 2]] })).toBeNull()
    expect(R.decode({ placed: [false, true], guesses: [[1, 2, 3, 3, 0, 0]] })).toBeNull()
    expect(replayPublic(RULES, { placed: [true, true], guesses: [[1, 2, 3, 6, 0, 0]] })).toBeNull()
    // a secret whose codes disagree with what is placed
    expect(R.hidden!.join(R.decode(w)!, { codes: [A, null] })).toBeNull()
    // and a move's own shape
    expect(readCodeMove({ guess: [1, 2, 3, 8] })).toBeNull()
    expect(readCodeMove({ guess: [1, 2], code: 'x' })).toBeNull()
    expect(readCodeMove({ guess: [1, 2, 3, 4], code: [4, 3, 2, 1] })).toEqual({
      guess: [1, 2, 3, 4],
      code: [4, 3, 2, 1],
    })
  })

  it('keeps the guess and not the code in the history', () => {
    expect(R.hidden!.logged({ guess: [1, 2, 3, 4], code: [4, 3, 2, 1] })).toEqual({
      guess: [1, 2, 3, 4],
    })
  })

  it('offers three computers that crack a code in fewer guesses in order, the hardest quickly', () => {
    const solve = (level: string, rules = RULES, seed = 3) => {
      const C = codeRules(rules)
      const rnd = seeded(seed)
      const team = Array.from({ length: rules.length }, () => Math.floor(rnd() * rules.colours))
      let g = C.hidden!.accept(C.fresh(), null, 'together')!
      g = C.apply(g, { guess: Array(rules.length).fill(0), code: team })
      // the team never cracks it, so the computer guesses until it does or runs out
      for (let k = 0; k < 30 && C.turn(g) !== null; k++) {
        const by = C.turn(g)!
        const m =
          by === 1
            ? C.computer!.choose(g, level)
            : { guess: Array(rules.length).fill(rules.colours - 1) }
        if (by === 0 && g.codes[1]!.every((c) => c === rules.colours - 1)) break
        g = C.apply(g, m)
      }
      return crackedIn(g, 1) ?? rules.tries + 1
    }
    const mean = (level: string) => {
      let t = 0
      for (let s = 1; s <= 150; s++) t += solve(level, RULES, s)
      return t / 150
    }
    const [easy, fair, hard] = ['easy', 'fair', 'hard'].map(mean)
    // measured 10.95, 5.22 and 4.45 over 400; the gaps asserted are well inside those
    expect(easy - fair).toBeGreaterThan(3)
    expect(fair - hard).toBeGreaterThan(0.3)
    expect(hard).toBeLessThan(5.5)
    // the largest board the toy offers, answered inside an edge function's patience
    const big = { length: 5, colours: 8, repeats: true, tries: 12 }
    const t0 = performance.now()
    solve('hard', big, 9)
    expect(performance.now() - t0).toBeLessThan(4000)
  })
})
