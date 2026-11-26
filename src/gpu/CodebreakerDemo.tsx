import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { CopyLink } from '../lab/CopyLink'
import { here } from '../lab/links'
import {
  CODE_KEY,
  COLOUR_COUNTS,
  DEFAULT_RULES,
  LENGTHS,
  LEVELS,
  PEGS,
  TRIES,
  allCodes,
  consistent,
  dailySeed,
  dayKey,
  guessFor,
  mark,
  randomCode,
  readSaved,
  seeded,
  valid,
  type Code,
  type Level,
  type Mark,
  type Rules,
  type Saved,
} from './codebreaker'
import { useKept } from './kept'
import { crackedIn, readCodeSettings, type CodeGame } from './codebreakerRoom'
import { useLabMatch } from '../lab/matches/useLabMatch'
import { MatchBar, MatchSend } from '../lab/matches/MatchBar'
import { MatchChallenge } from '../lab/matches/MatchChallenge'
import { useSignedIn } from '../lab/matches/useSignedIn'
import { otherName } from '../lab/matches/words'
import { myHidden } from '../lab/matches/cloud'

type Mode = 'daily' | 'practice' | 'computer'
type Row = { guess: Code; mark: Mark; left?: number }

const COLOURS = [
  '#e63946',
  '#1d7bd8',
  '#2a9d58',
  '#f4c430',
  '#8d5cf6',
  '#f08c3a',
  '#16b5c4',
  '#e76fac',
]
const COLOUR_NAMES = ['red', 'blue', 'green', 'yellow', 'violet', 'orange', 'teal', 'pink']
const SHAPES = ['●', '▲', '■', '◆', '★', '✚', '♥', '⬟']
const LEVEL_NAMES: Record<Level, string> = { lucky: 'Lucky', clever: 'Clever' }
const PEG_NAMES: Record<Saved['pegs'], string> = {
  colours: 'Colours',
  shapes: 'Shapes too',
  numbers: 'Numbers too',
}

function Peg({
  c,
  pegs,
  size = 'big',
}: {
  c: number | null
  pegs: Saved['pegs']
  size?: 'big' | 'small'
}) {
  if (c === null) return <span className={`cb-peg is-${size} is-empty`} aria-hidden />
  return (
    <span className={`cb-peg is-${size}`} style={{ background: COLOURS[c] }} aria-hidden>
      {pegs === 'shapes' ? SHAPES[c] : pegs === 'numbers' ? c + 1 : ''}
    </span>
  )
}
function Marks({ m, length }: { m: Mark; length: number }) {
  return (
    <span
      className="cb-marks"
      aria-hidden
      style={{ gridTemplateColumns: `repeat(${Math.ceil(length / 2)}, 1fr)` }}
    >
      {Array.from({ length }, (_, i) => (
        <span
          key={i}
          className={i < m.exact ? 'is-exact' : i < m.exact + m.near ? 'is-near' : ''}
        />
      ))}
    </span>
  )
}
const MATCH_LEVELS = { easy: 'Easy', fair: 'Fair', hard: 'Hard' }
const said = (code: Code) => code.map((c) => COLOUR_NAMES[c]).join(', ')
const said_ = said
const sayMark = (m: Mark) =>
  `${m.exact} in the right place${m.near ? `, ${m.near} the right colour elsewhere` : ''}`

export function CodebreakerDemo() {
  const [saved, setSaved] = useKept(CODE_KEY, readSaved)
  const today = dayKey(new Date())
  const playedToday = saved.daily?.day === today
  const [mode, setMode] = useState<Mode>(playedToday ? 'practice' : 'daily')
  const rulesFor = (m: Mode, s: Saved = saved): Rules => (m === 'daily' ? DEFAULT_RULES : s.rules)
  const [game, setGame] = useState(() => ({
    mode,
    rules: rulesFor(mode),
    secret:
      mode === 'daily'
        ? randomCode(DEFAULT_RULES, seeded(dailySeed(new Date())))
        : randomCode(saved.rules, Math.random),
    rows: [] as Row[],
    done: false as false | 'won' | 'lost',
  }))
  const [draft, setDraft] = useState<(number | null)[]>(() => Array(game.rules.length).fill(null))
  const [line, setLine] = useState(
    mode === 'daily'
      ? "Today's code — the same for everyone. Ten guesses."
      : 'A new code. Find it.',
  )
  const timer = useRef(0)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  /* ── a match by turns, when the address names one (src/lab/matches/useLabMatch.ts): a race to
     crack each other's code (codebreakerRoom.ts). Each code is kept back by the server — the
     friend's comes with their yes, the challenger's with their first guess — and afterwards it is
     fetched back from lab-move, the one place that will show it, and only to its owner.
     ⚠️ NO PREVIEW: a guess's marks are only known where the other code is. The code to hide
     starts as a random one, as Sea battle's fleet starts shuffled, so Accept always brings one. */
  const [hide, setHide] = useState<(number | null)[]>([])
  const [editing, setEditing] = useState<'code' | 'guess'>('guess')
  /** what the match itself has to say about a guess refused here — never the toy's own line */
  const [warn, setWarn] = useState('')
  const hideNow = useRef(hide)
  hideNow.current = hide
  const lm = useLabMatch('codebreaker', { preview: false, bring: () => hideNow.current })
  const inMatch = !!lm.id
  const signedIn = useSignedIn()
  const mset = inMatch && lm.view ? readCodeSettings(lm.view.settings) : null
  const mg = inMatch ? (lm.shown as CodeGame | null) : null
  const mside: 0 | 1 = lm.view?.mode === 'together' ? 0 : lm.view?.you === 1 ? 1 : 0
  const mtheirs: 0 | 1 = mside === 0 ? 1 : 0
  const mplaced = !!mg?.placed[mside]
  const [myCode, setMyCode] = useState<Code | null>(null)
  const msetKey = mset ? `${lm.id}|${mset.length}|${mset.colours}|${mset.repeats}` : ''
  useEffect(() => {
    if (!mset) return
    window.clearTimeout(timer.current)
    setHide(randomCode(mset, Math.random))
    setDraft(Array(mset.length).fill(null))
    setMyCode(null)
    // a new match, or new rules for it, is the only cue
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msetKey])
  /* my own code, once it is hidden: asked of lab-move, which shows each player only theirs */
  useEffect(() => {
    if (!inMatch || !mplaced || myCode || !lm.id) return
    let live = true
    myHidden(lm.id)
      .then((c) => {
        if (live && Array.isArray(c)) setMyCode(c as Code)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [inMatch, mplaced, myCode, lm.id])
  /* a guess, once the server has marked it, leaves the draft */
  const guessCount = mg?.guesses.length ?? 0
  useEffect(() => {
    if (mset) setDraft(Array(mset.length).fill(null))
    setWarn('')
    // only a new guess on the board clears the one being made
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guessCount])
  /* leaving a match, the toy starts afresh with its own rules */
  const wasInMatch = useRef(inMatch)
  useEffect(() => {
    if (wasInMatch.current && !inMatch) start(mode)
    wasInMatch.current = inMatch
    // only leaving the match starts a code
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inMatch])

  const { rules: ownRules } = game
  const rules = mset ?? ownRules
  // the toy's own game only: a match's rules are rebuilt every render, and need no pool
  const pool = useMemo(() => allCodes(ownRules), [ownRules])
  const possible = useMemo(() => consistent(pool, game.rows), [pool, game.rows])

  const start = (m: Mode, s: Saved = saved) => {
    window.clearTimeout(timer.current)
    const r = rulesFor(m, s)
    if (m === 'daily' && s.daily?.day === today) {
      setMode('daily')
      setGame({
        mode: m,
        rules: r,
        secret: randomCode(r, seeded(dailySeed(new Date()))),
        rows: [],
        done: s.daily.guesses ? 'won' : 'lost',
      })
      setLine(
        s.daily.guesses
          ? `You cracked today's code in ${s.daily.guesses}. A new one comes tomorrow.`
          : "Today's code beat you. A new one comes tomorrow.",
      )
      return
    }
    setMode(m)
    setGame({
      mode: m,
      rules: r,
      secret:
        m === 'daily' ? randomCode(r, seeded(dailySeed(new Date()))) : randomCode(r, Math.random),
      rows: [],
      done: false,
    })
    setDraft(Array(r.length).fill(null))
    setLine(
      m === 'daily'
        ? "Today's code — the same for everyone. Ten guesses."
        : m === 'practice'
          ? 'A new code. Find it.'
          : 'Make a code for the computer to crack, then let it guess.',
    )
  }
  const setRules = (p: Partial<Rules>) => {
    let r = { ...saved.rules, ...p }
    if (!r.repeats && r.colours < r.length) r = { ...r, repeats: true }
    const s = { ...saved, rules: r }
    setSaved(s)
    if (mode !== 'daily' && (game.rows.length === 0 || game.done)) start(mode, s)
  }

  const finish = (rows: Row[], won: boolean) => {
    setGame((g) => ({ ...g, rows, done: won ? 'won' : 'lost' }))
    setSaved((s) => {
      const spread = [...s.spread]
      spread[won ? rows.length : 0]++
      return {
        ...s,
        spread,
        daily: game.mode === 'daily' ? { day: today, guesses: won ? rows.length : 0 } : s.daily,
      }
    })
    setLine(
      won
        ? `🏆 Cracked in ${rows.length} ${rows.length === 1 ? 'guess' : 'guesses'}!`
        : `Out of guesses — the code was ${said(game.secret)}.`,
    )
  }

  const submit = () => {
    if (game.done || game.mode === 'computer') return
    if (draft.some((c) => c === null)) return setLine('Fill every place first.')
    const guess = draft as Code
    if (!valid(guess, rules)) return setLine('No colour may appear twice in this game.')
    const m = mark(game.secret, guess)
    const rows = [...game.rows, { guess, mark: m }]
    rows[rows.length - 1].left = consistent(pool, rows).length
    setDraft(Array(rules.length).fill(null))
    if (m.exact === rules.length) return finish(rows, true)
    if (rows.length >= rules.tries) return finish(rows, false)
    setGame((g) => ({ ...g, rows }))
    setLine(`${sayMark(m)}.`)
  }
  /** fill the first empty place of the row being made: the code to hide, or the guess */
  const fill = (d: (number | null)[], c: number) => {
    const i = d.indexOf(null)
    if (i < 0) return d
    const next = [...d]
    next[i] = c
    return next
  }
  const add = (c: number) => {
    if (inMatch) {
      if (matchEditing() === 'code') setHide((d) => fill(d, c))
      else setDraft((d) => fill(d, c))
      return
    }
    if (game.done) return
    setDraft((d) => {
      const i = d.indexOf(null)
      if (i < 0) return d
      const next = [...d]
      next[i] = c
      return next
    })
  }
  const back = () =>
    (inMatch && matchEditing() === 'code' ? setHide : setDraft)((d) => {
      const filled = d.map((c, i) => (c === null ? -1 : i)).filter((i) => i >= 0)
      if (!filled.length) return d
      const next = [...d]
      next[filled[filled.length - 1]] = null
      return next
    })

  /** the computer's turn to crack your code, a guess at a time */
  const letItGuess = () => {
    if (draft.some((c) => c === null)) return setLine('Finish your code first.')
    const secret = draft as Code
    if (!valid(secret, rules)) return setLine('No colour may appear twice in this game.')
    const level = saved.level
    const rand = Math.random
    setGame((g) => ({ ...g, secret, rows: [], done: false }))
    setLine('The computer is thinking…')
    let rows: Row[] = []
    let left = pool
    const step = () => {
      const g = guessFor(left, level, rand)
      const m = mark(secret, g)
      left = consistent(left, [{ guess: g, mark: m }])
      rows = [...rows, { guess: g, mark: m, left: left.length }]
      const won = m.exact === rules.length
      const over = won || rows.length >= rules.tries
      setGame((s) => ({ ...s, rows, done: over ? (won ? 'lost' : 'won') : false }))
      if (won) setLine(`The computer cracked your code in ${rows.length}.`)
      else if (over) setLine(`🏆 Your code held — the computer ran out of guesses.`)
      else {
        setLine(
          `${sayMark(m)} — ${left.length} code${left.length === 1 ? '' : 's'} still possible.`,
        )
        timer.current = window.setTimeout(step, 750)
      }
    }
    timer.current = window.setTimeout(step, 600)
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('input, textarea, select')) return
    const n = Number(e.key)
    if (Number.isInteger(n) && n >= 1 && n <= rules.colours) {
      e.preventDefault()
      add(n - 1)
    } else if (e.key === 'Backspace') {
      e.preventDefault()
      back()
    } else if (e.key === 'Enter' && !(e.target as HTMLElement).closest('button')) {
      e.preventDefault()
      if (inMatch) guessInMatch()
      else if (mode === 'computer') letItGuess()
      else submit()
    }
  }

  /* ── the match's own helpers and view */
  const mtogether = lm.view?.mode === 'together'
  const minvited = lm.view?.status === 'invited'
  /** whether I have a code still to hide: the friend before their yes, the challenger before
     their first guess */
  const laying =
    inMatch &&
    !mplaced &&
    (minvited ? lm.view?.you === 1 && !mtogether : lm.canPlay && lm.view?.you === 0)
  /** which row the palette fills: the code, while it is being hidden and has room, or the guess */
  const matchEditing = (): 'code' | 'guess' =>
    laying && (editing === 'code' || minvited) ? 'code' : 'guess'
  const guessInMatch = () => {
    if (!mset || !lm.canPlay) return
    if (laying && (hide.some((c) => c === null) || !valid(hide as Code, mset)))
      return setWarn(
        hide.some((c) => c === null)
          ? 'Fill every place of your code first.'
          : 'No colour may appear twice in your code.',
      )
    if (draft.some((c) => c === null)) return setWarn('Fill every place of your guess first.')
    if (!valid(draft as Code, mset)) return setWarn('No colour may appear twice in this game.')
    setWarn('')
    lm.play(laying ? { guess: draft as Code, code: hide as Code } : { guess: draft as Code })
  }

  const computerRunning = mode === 'computer' && game.rows.length > 0 && !game.done
  const total = saved.spread.reduce((a, x) => a + x, 0)
  const most = Math.max(1, ...saved.spread)
  const share = useMemo(() => {
    if (game.mode !== 'daily' || !game.done || !game.rows.length) return ''
    const grid = game.rows
      .map(
        (r) =>
          '⚫'.repeat(r.mark.exact) +
          '⚪'.repeat(r.mark.near) +
          '·'.repeat(rules.length - r.mark.exact - r.mark.near),
      )
      .join('\n')
    return `🔐 Codebreaker ${today}: ${game.done === 'won' ? game.rows.length : 'X'}/${rules.tries}\n${grid}\n${here()}#lab?demo=codebreaker`
  }, [game, rules, today])

  if (inMatch) {
    const length = mset?.length ?? rules.length
    const them = !lm.view ? 'They' : mtogether ? 'The computer' : otherName(lm.view)
    const view = mg
    const rowsBy = (who: 0 | 1) => (view ? view.guesses.filter((x) => x.by === who) : [])
    const mine = rowsBy(mside)
    const theirs = rowsBy(mtheirs)
    const over = !!view && lm.view?.status === 'finished'
    const myIn = view ? crackedIn(view, mside) : null
    const theirIn = view ? crackedIn(view, mtheirs) : null
    const last = view?.guesses[view.guesses.length - 1]
    const shownCode = mplaced ? (view?.codes[mside] ?? myCode) : laying ? hide : null
    const theirCode = view?.codes[mtheirs] ?? null
    const editingCode = matchEditing() === 'code'
    const words = (() => {
      if (minvited)
        return laying
          ? 'Hide a code for them to crack — it starts as a random one; tap a place to change it — then accept.'
          : ''
      if (!view || !mset) return ''
      if (over) {
        const a = myIn === null ? 'never cracked theirs' : `cracked theirs in ${myIn}`
        const b = theirIn === null ? 'never cracked yours' : `cracked yours in ${theirIn}`
        return `${mtogether ? 'You two' : 'You'} ${a}; ${them.toLowerCase() === 'they' ? 'they' : them} ${b}.`
      }
      const said = last
        ? `${last.by === mside ? (mtogether && lm.view?.you !== 0 ? 'Your side' : 'You') : them} guessed ${said_(last.guess)} — ${sayMark(last.mark)}.`
        : ''
      if (laying)
        return `${said ? said + ' ' : ''}Hide your code — a random one is ready; tap a place to change it — and make your first guess at theirs.`
      if (myIn !== null && !lm.canPlay)
        return `${said ? said + ' ' : ''}🔓 You cracked it in ${myIn}. ${them} has as many guesses to match it.`
      return `${said ? said + ' ' : ''}${lm.canPlay ? 'Your guess.' : lm.hasPending ? 'Send it.' : ''}`
    })()
    const pegRow = (r: { guess: Code; mark: Mark }, i: number, whose: string) => (
      <li
        key={i}
        className="cb-row"
        aria-label={`${whose} guess ${i + 1}: ${said_(r.guess)} — ${sayMark(r.mark)}`}
      >
        <span className="cb-n" aria-hidden>
          {i + 1}
        </span>
        <span className="cb-pegs">
          {r.guess.map((c, k) => (
            <Peg key={k} c={c} pegs={saved.pegs} />
          ))}
        </span>
        <Marks m={r.mark} length={length} />
      </li>
    )
    const making = lm.canPlay || lm.hasPending
    return (
      <div className="lab-keys cb-room" onKeyDown={onKey}>
        <MatchBar lm={lm} sides={['the first to guess', 'the second to guess']} />
        {view && mset && (
          <div className="dice-scores">
            <div
              className={`dice-score${view.guesses.length && lm.view?.turn === lm.view?.you && !mtogether ? ' is-up' : ''}`}
            >
              <span>{mtogether ? 'You two' : 'You'}</span>
              <strong>{myIn !== null ? `🔓 ${myIn}` : `${mine.length} of ${mset.tries}`}</strong>
            </div>
            <div className="dice-score">
              <span>{them}</span>
              <strong>
                {theirIn !== null ? `🔓 ${theirIn}` : `${theirs.length} of ${mset.tries}`}
              </strong>
            </div>
          </div>
        )}
        {(warn || words) && (
          <p className="mc-line" aria-live="polite">
            {warn || words}
          </p>
        )}
        <div className="sb-seas">
          {!minvited && (
            <section aria-label="Your guesses at their code">
              <h3 className="fw-h">Your guesses at their code</h3>
              <ol className="cb-board" aria-label="Your guesses so far">
                {mine.map((r, i) => pegRow(r, i, 'Your'))}
                {making && myIn === null && (
                  <li
                    className={`cb-row is-draft${editingCode ? '' : ' is-editing'}`}
                    aria-label={`Guess ${mine.length + 1}: ${draft.map((c) => (c === null ? 'empty' : COLOUR_NAMES[c])).join(', ')}`}
                  >
                    <span className="cb-n" aria-hidden>
                      {mine.length + 1}
                    </span>
                    <span className="cb-pegs">
                      {draft.map((c, k) => (
                        <button
                          key={k}
                          className="cb-slot"
                          disabled={!lm.canPlay}
                          aria-label={`Guess, place ${k + 1}: ${c === null ? 'empty' : COLOUR_NAMES[c]}${c === null ? '' : ' — tap to clear'}`}
                          onClick={() => {
                            setEditing('guess')
                            setDraft((d) => d.map((x, j) => (j === k ? null : x)))
                          }}
                        >
                          <Peg c={c} pegs={saved.pegs} />
                        </button>
                      ))}
                    </span>
                  </li>
                )}
                {theirCode && (
                  <li className="cb-row is-secret" aria-label={`Their code: ${said_(theirCode)}`}>
                    <span className="cb-n" aria-hidden>
                      🔓
                    </span>
                    <span className="cb-pegs">
                      {theirCode.map((c, k) => (
                        <Peg key={k} c={c} pegs={saved.pegs} />
                      ))}
                    </span>
                  </li>
                )}
              </ol>
            </section>
          )}
          <section aria-label="Your code, and their guesses at it">
            <h3 className="fw-h">
              {mtogether ? 'Your code, and the computer’s guesses' : 'Your code, and their guesses'}
            </h3>
            <ol className="cb-board" aria-label="Their guesses so far">
              <li
                className={`cb-row is-code${laying && editingCode ? ' is-editing' : ''}`}
                aria-label={
                  shownCode
                    ? `Your code: ${shownCode.map((c) => (c === null ? 'empty' : COLOUR_NAMES[c])).join(', ')}${laying ? '' : ' — hidden from them'}`
                    : 'Your code: not hidden yet'
                }
              >
                <span className="cb-n" aria-hidden>
                  🔒
                </span>
                <span className="cb-pegs">
                  {laying
                    ? hide.map((c, k) => (
                        <button
                          key={k}
                          className="cb-slot"
                          aria-label={`Your code, place ${k + 1}: ${c === null ? 'empty' : COLOUR_NAMES[c]}${c === null ? '' : ' — tap to clear'}`}
                          onClick={() => {
                            setEditing('code')
                            setHide((d) => d.map((x, j) => (j === k ? null : x)))
                          }}
                        >
                          <Peg c={c} pegs={saved.pegs} />
                        </button>
                      ))
                    : (shownCode ?? Array(length).fill(null)).map((c, k) => (
                        <Peg key={k} c={c} pegs={saved.pegs} />
                      ))}
                </span>
              </li>
              {theirs.map((r, i) => pegRow(r, i, mtogether ? 'The computer’s' : 'Their'))}
            </ol>
          </section>
        </div>
        {(laying || (lm.canPlay && myIn === null)) && mset && (
          <div className="cb-palette">
            {laying && !minvited && (
              <div className="lab-controls" role="group" aria-label="Which row the colours go to">
                <button
                  className="btn btn-ghost"
                  aria-pressed={editingCode}
                  onClick={() => setEditing('code')}
                >
                  🔒 Your code
                </button>
                <button
                  className="btn btn-ghost"
                  aria-pressed={!editingCode}
                  onClick={() => setEditing('guess')}
                >
                  Your guess
                </button>
              </div>
            )}
            <div className="lab-controls" role="group" aria-label="Colours">
              {Array.from({ length: mset.colours }, (_, c) => (
                <button
                  key={c}
                  className="cb-pick"
                  aria-label={`${COLOUR_NAMES[c]} (key ${c + 1})`}
                  onClick={() => add(c)}
                >
                  <Peg c={c} pegs={saved.pegs} />
                </button>
              ))}
            </div>
            <div className="lab-controls">
              <button className="btn btn-ghost" onClick={back} aria-label="Take back the last peg">
                ⌫ Back
              </button>
              {laying && (
                <button
                  className="btn btn-ghost"
                  onClick={() => setHide(randomCode(mset, Math.random))}
                >
                  🎲 Another random code
                </button>
              )}
              {!minvited && (
                <button className="btn" onClick={guessInMatch} disabled={!lm.canPlay}>
                  Guess ({mine.length + 1} of {mset.tries})
                </button>
              )}
            </div>
          </div>
        )}
        <MatchSend lm={lm} />
        <p className="muted lab-hint">
          A race: you each hide a code and take turns guessing at the other’s, marked as ever — a
          black dot for each peg in the right place, a white dot for each right colour elsewhere.
          Whoever cracks it in fewer guesses wins; whoever guesses second always gets as many as the
          first had, so going first is no edge. Nobody sees a code but its owner until the race is
          over.
        </p>
      </div>
    )
  }

  return (
    <div className="lab-keys cb-room" onKeyDown={onKey}>
      <div className="lab-controls">
        <div className="lab-group" role="group" aria-label="What to play">
          <button
            className="btn btn-ghost"
            aria-pressed={mode === 'daily'}
            onClick={() => start('daily')}
          >
            📅 Today’s code
          </button>
          <button
            className="btn btn-ghost"
            aria-pressed={mode === 'practice'}
            onClick={() => start('practice')}
          >
            Practice
          </button>
          <button
            className="btn btn-ghost"
            aria-pressed={mode === 'computer'}
            onClick={() => start('computer')}
          >
            🤖 Computer guesses
          </button>
        </div>
        {mode !== 'daily' && (
          <button className="btn btn-ghost" onClick={() => start(mode)}>
            ↻ New code
          </button>
        )}
        {signedIn && mode !== 'daily' && (
          <MatchChallenge
            demo="codebreaker"
            settings={{ ...saved.rules }}
            levelNames={MATCH_LEVELS}
          />
        )}
      </div>

      <p className="mc-line" aria-live="polite">
        {line}
      </p>

      <ol className="cb-board" aria-label="Guesses so far">
        {game.rows.map((r, i) => (
          <li
            key={i}
            className="cb-row"
            aria-label={`Guess ${i + 1}: ${said(r.guess)} — ${sayMark(r.mark)}`}
          >
            <span className="cb-n" aria-hidden>
              {i + 1}
            </span>
            <span className="cb-pegs">
              {r.guess.map((c, k) => (
                <Peg key={k} c={c} pegs={saved.pegs} />
              ))}
            </span>
            <Marks m={r.mark} length={rules.length} />
            {(saved.counting || mode === 'computer') && r.left !== undefined && (
              <span className="cb-left muted">{r.left} left</span>
            )}
          </li>
        ))}
        {!game.done && !computerRunning && (
          <li
            className="cb-row is-draft"
            aria-label={`${mode === 'computer' ? 'Your code' : `Guess ${game.rows.length + 1}`}: ${draft.map((c) => (c === null ? 'empty' : COLOUR_NAMES[c])).join(', ')}`}
          >
            <span className="cb-n" aria-hidden>
              {mode === 'computer' ? '🔒' : game.rows.length + 1}
            </span>
            <span className="cb-pegs">
              {draft.map((c, k) => (
                <button
                  key={k}
                  className="cb-slot"
                  aria-label={`Place ${k + 1}: ${c === null ? 'empty' : COLOUR_NAMES[c]}${c === null ? '' : ' — tap to clear'}`}
                  onClick={() => setDraft((d) => d.map((x, j) => (j === k ? null : x)))}
                >
                  <Peg c={c} pegs={saved.pegs} />
                </button>
              ))}
            </span>
          </li>
        )}
        {game.done && mode !== 'computer' && (
          <li className="cb-row is-secret" aria-label={`The code: ${said(game.secret)}`}>
            <span className="cb-n" aria-hidden>
              🔓
            </span>
            <span className="cb-pegs">
              {game.secret.map((c, k) => (
                <Peg key={k} c={c} pegs={saved.pegs} />
              ))}
            </span>
          </li>
        )}
      </ol>

      {!game.done && !computerRunning && (
        <div className="cb-palette">
          <div className="lab-controls" role="group" aria-label="Colours">
            {Array.from({ length: rules.colours }, (_, c) => (
              <button
                key={c}
                className="cb-pick"
                aria-label={`${COLOUR_NAMES[c]} (key ${c + 1})`}
                onClick={() => add(c)}
              >
                <Peg c={c} pegs={saved.pegs} />
              </button>
            ))}
          </div>
          <div className="lab-controls">
            <button className="btn btn-ghost" onClick={back} aria-label="Take back the last peg">
              ⌫ Back
            </button>
            {mode === 'computer' ? (
              <button className="btn" onClick={letItGuess}>
                🤖 Let it guess
              </button>
            ) : (
              <button className="btn" onClick={submit}>
                Guess ({game.rows.length + 1} of {rules.tries})
              </button>
            )}
            {saved.counting && mode !== 'computer' && (
              <span className="muted lab-score">{possible.length} codes still possible</span>
            )}
          </div>
        </div>
      )}
      {share && <CopyLink text={share} label="🔗 Copy today’s result" />}

      <section className="cb-spread" aria-label="Your codes cracked, by guesses">
        <h3 className="fw-h">Cracked in…</h3>
        {total === 0 ? (
          <p className="muted mc-note">Nothing yet — every code you play counts here.</p>
        ) : (
          <div className="cb-bars">
            {saved.spread.map((n, i) =>
              i === 0 || n > 0 || i <= 8 ? (
                <div key={i} className="cb-bar">
                  <span>{i === 0 ? '✕' : i}</span>
                  <span className="cb-bar-fill" style={{ width: `${(n / most) * 100}%` }} />
                  <span className="muted">{n}</span>
                </div>
              ) : null,
            )}
          </div>
        )}
      </section>

      <div className="fw-panel">
        <section aria-label="Rules">
          <h3 className="fw-h">
            Rules{' '}
            {mode === 'daily' && (
              <span className="muted">(today’s code always uses the standard ones)</span>
            )}
          </h3>
          <div className="lab-controls" role="group" aria-label="Places">
            <span className="fw-label">Places</span>
            {LENGTHS.map((n) => (
              <button
                key={n}
                className="btn btn-ghost"
                aria-pressed={saved.rules.length === n}
                aria-label={`${n} places`}
                onClick={() => setRules({ length: n })}
              >
                {n}
              </button>
            ))}
          </div>
          <div className="lab-controls" role="group" aria-label="Colours in play">
            <span className="fw-label">Colours</span>
            {COLOUR_COUNTS.map((n) => (
              <button
                key={n}
                className="btn btn-ghost"
                aria-pressed={saved.rules.colours === n}
                aria-label={`${n} colours`}
                onClick={() => setRules({ colours: n })}
              >
                {n}
              </button>
            ))}
          </div>
          <div className="lab-controls" role="group" aria-label="Guesses allowed">
            <span className="fw-label">Guesses</span>
            {TRIES.map((n) => (
              <button
                key={n}
                className="btn btn-ghost"
                aria-pressed={saved.rules.tries === n}
                aria-label={`${n} guesses`}
                onClick={() => setRules({ tries: n })}
              >
                {n}
              </button>
            ))}
          </div>
          <div className="lab-controls">
            <button
              className="btn btn-ghost"
              aria-pressed={saved.rules.repeats}
              onClick={() => setRules({ repeats: !saved.rules.repeats })}
            >
              Colours may repeat
            </button>
            <button
              className="btn btn-ghost"
              aria-pressed={saved.counting}
              onClick={() => setSaved((s) => ({ ...s, counting: !s.counting }))}
            >
              Count the codes left
            </button>
          </div>
        </section>
        <section aria-label="Pegs and the computer">
          <h3 className="fw-h">Pegs</h3>
          <div className="lab-controls" role="group" aria-label="Peg markings">
            {PEGS.map((p) => (
              <button
                key={p}
                className="btn btn-ghost"
                aria-pressed={saved.pegs === p}
                onClick={() => setSaved((s) => ({ ...s, pegs: p }))}
              >
                {PEG_NAMES[p]}
              </button>
            ))}
          </div>
          <h3 className="fw-h">The computer, guessing</h3>
          <div className="lab-controls" role="group" aria-label="How the computer guesses">
            {LEVELS.map((l) => (
              <button
                key={l}
                className="btn btn-ghost"
                aria-pressed={saved.level === l}
                onClick={() => setSaved((s) => ({ ...s, level: l }))}
              >
                {LEVEL_NAMES[l]}
              </button>
            ))}
          </div>
        </section>
      </div>
      <p className="muted lab-hint">
        A code of coloured pegs is hidden. Make a guess and you are told, with a black dot, each peg
        that is the right colour in the right place, and with a white dot each other peg that is the
        right colour but somewhere else — every peg counted once. Find the code before the guesses
        run out. Today’s code is the same for everyone and can be played once a day; copy your
        result to compare. Or hide a code of your own and watch the computer crack it: Lucky guesses
        any code that could still be right, Clever picks the guess whose worst answer leaves the
        fewest codes standing, and usually needs five or fewer. Keys: 1–
        {rules.colours} add a colour, Backspace takes one back, Enter guesses. Shapes or numbers on
        the pegs help when colours are hard to tell apart.
      </p>
    </div>
  )
}
