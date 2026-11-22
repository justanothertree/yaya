import { useCallback, useEffect, useState } from 'react'
import { listMatches, type MatchView } from './cloud'
import { matchHash, rowWords } from './words'

/**
 * Your games: the matches by turns you are in, at the top of the Lab, shown only when there are
 * some. The server sorts the ones waiting on you first. Each row is the match's own address, so a
 * row, the bell and a bookmark all open the same thing.
 *
 * It looks again when you come back to the tab, when the address changes (a move sent, a match
 * opened) and once a minute while you are looking — the bell's own cadence. Moves are never live
 * here; the match itself watches more closely while it is open.
 */
const SHOWN = 3

export function YourGames() {
  const [rows, setRows] = useState<MatchView[]>([])
  const [all, setAll] = useState(false)

  const load = useCallback(async () => {
    try {
      setRows(await listMatches())
    } catch {
      /* signed out, offline or no backend: the list is simply not shown */
    }
  }, [])
  useEffect(() => {
    void load()
    const look = () => {
      if (document.visibilityState === 'visible') void load()
    }
    let t = 0
    const onHash = () => {
      window.clearTimeout(t)
      t = window.setTimeout(look, 800)
    }
    const every = window.setInterval(look, 60000)
    window.addEventListener('focus', look)
    document.addEventListener('visibilitychange', look)
    window.addEventListener('hashchange', onHash)
    return () => {
      window.clearTimeout(t)
      window.clearInterval(every)
      window.removeEventListener('focus', look)
      document.removeEventListener('visibilitychange', look)
      window.removeEventListener('hashchange', onHash)
    }
  }, [load])

  if (!rows.length) return null
  const shown = all ? rows : rows.slice(0, SHOWN)
  return (
    <section className="your-games" aria-label="Your games">
      <h3 className="fw-h">Your games</h3>
      <ul className="your-games-list">
        {shown.map((v) => {
          const w = rowWords(v)
          return (
            <li key={v.id}>
              <a
                className={`your-game${w.urgent ? ' is-yours' : ''}`}
                href={matchHash(v.demo, v.id)}
              >
                <span className="your-game-title">{w.title}</span>
                <span className="your-game-state">{w.state}</span>
              </a>
            </li>
          )
        })}
      </ul>
      {rows.length > SHOWN && (
        <button className="btn btn-ghost" aria-expanded={all} onClick={() => setAll((a) => !a)}>
          {all ? 'Fewer' : `All games (${rows.length})`}
        </button>
      )}
    </section>
  )
}
