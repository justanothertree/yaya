import { useCallback, useEffect, useState } from 'react'
import { fetchFeed } from './cloud'
import { dayKeyOf, groupByDay, mergeEvents, type FeedEvent, type FeedKind } from './event'
import { spanText, countText } from '../chronicle/record'

/**
 * Everything happening here, in one list.
 *
 * ⚠️ IT IS NOT A SECOND COPY OF THE CIRCUIT'S FEED. That one is a workout browser — month, week,
 * day and table views over circuit logs, with goal bars and photos — and it keeps all of that.
 * What moved is the LIST: the thing the notification bell has always pointed at, which could
 * only ever show one of the five kinds of thing people do here.
 *
 * ⚠️ THE ROW IS BUILT PER KIND RATHER THAN FROM ONE SENTENCE. `feedSentence` exists and is
 * tested, and it is the right answer for a profile's activity line where everything must fit on
 * one row — but a feed has room, and "Rated Mistfall Hunter 94 · 29/10/2026" reads like a log
 * file. The sentence stays the fallback for a kind this build does not know how to draw.
 */

const DAYS = 14

const GLYPH: Record<FeedKind, string> = {
  sitting: '🗓',
  circuit_log: '💪',
  rating: '⭐',
  snake_score: '🐍',
  snake_trophy: '🏆',
}

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

/** Today / Yesterday / a weekday, from day keys rather than from instants */
function dayName(key: string, todayKey: string): string {
  if (key === todayKey) return 'Today'
  const y = new Date()
  y.setDate(y.getDate() - 1)
  if (key === dayKeyOf(y.toISOString())) return 'Yesterday'
  return new Date(key + 'T12:00:00').toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

/** what the event says, in the shape its own kind deserves */
function What({ e }: { e: FeedEvent }) {
  if (e.kind === 'sitting') {
    const len = e.until ? spanText(Date.parse(e.until) - Date.parse(e.at)) : null
    return (
      <span className="feed-what">
        {e.colour ? (
          <span className="feed-dot" style={{ background: e.colour }} aria-hidden />
        ) : null}
        <span className="feed-noun">{e.detail ?? 'Something'}</span>
        {len ? <span className="muted feed-sub">{len}</span> : null}
        {e.amount != null && e.metric ? (
          <span className="muted feed-sub">
            {countText(e.amount)} {e.metric}
          </span>
        ) : null}
      </span>
    )
  }
  if (e.kind === 'circuit_log') {
    const did = (e.items ?? [])
      .map((it) => `${countText(it.val)}${it.unit ? ' ' + it.unit : ''} ${it.name}`)
      .join(', ')
    return (
      <span className="feed-what">
        <span className="feed-noun">{did || 'Logged a workout'}</span>
        {e.score ? <span className="muted feed-sub">{e.score} pts</span> : null}
        {/* the circuits you SHARE with them, never the ones you do not -- the server decides
            this and sends null when you share none */}
        {e.detail ? <span className="muted feed-sub">{e.detail}</span> : null}
      </span>
    )
  }
  if (e.kind === 'rating')
    return (
      <span className="feed-what">
        <span className="muted feed-verb">Rated</span>
        <span className="feed-noun">{e.detail ?? 'something'}</span>
        {e.score != null ? <span className="feed-score">{e.score}</span> : null}
      </span>
    )
  if (e.kind === 'snake_trophy')
    return (
      <span className="feed-what">
        <span className="muted feed-verb">Won</span>
        <span className="feed-noun">{e.detail}</span>
        {e.score != null ? <span className="muted feed-sub">score {e.score}</span> : null}
      </span>
    )
  return (
    <span className="feed-what">
      <span className="muted feed-verb">Scored</span>
      <span className="feed-noun">{e.score}</span>
      {e.detail ? <span className="muted feed-sub">{e.detail}</span> : null}
    </span>
  )
}

export function FeedRoom({ authed }: { authed: boolean }) {
  const [events, setEvents] = useState<FeedEvent[] | null>(null)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    if (!authed) return
    const to = new Date()
    const from = new Date(to.getTime() - DAYS * 86_400_000)
    try {
      const rows = await fetchFeed(from.toISOString(), to.toISOString())
      /* merged even though the server already ordered them: the client is what holds the
         previous window, and a refresh that overlaps is the normal case rather than a fault */
      setEvents(mergeEvents(rows))
      setFailed(false)
    } catch {
      setEvents([])
      setFailed(true)
    }
  }, [authed])

  useEffect(() => {
    void load()
  }, [load])

  if (!authed)
    return (
      <p className="muted">
        The feed is what everyone here has been up to. <a href="#signin">Sign in</a> to see it.
      </p>
    )

  if (events === null)
    return (
      <p className="muted" aria-busy>
        Looking…
      </p>
    )

  if (failed)
    return (
      <p className="muted">
        The feed could not be loaded just now.{' '}
        <button className="btn btn-ghost" onClick={() => void load()}>
          Try again
        </button>
      </p>
    )

  if (events.length === 0)
    return (
      <div className="feed-none">
        <p className="muted">Nothing in the last fortnight.</p>
        {/**
         * ⚠️ IT OFFERS DOORS RATHER THAN DESCRIBING THEM. The Chronicle friends list had an
         * empty state naming three switches in prose with not one link in it — the page that
         * proved the switches were off was the page that could not turn them on. Whatever is
         * missing here, the next thing somebody wants is a way in.
         */}
        <p className="muted">
          Start something in <a href="#chronicle">Chronicle</a>, log a workout in{' '}
          <a href="#circuit">the Circuit</a>, or <a href="#ratings">rate something</a> — it shows up
          here.
        </p>
      </div>
    )

  const todayKey = dayKeyOf(new Date().toISOString())

  return (
    <div className="feed">
      {groupByDay(events).map(([key, rows]) => (
        <section key={key} className="feed-day">
          <h3>{dayName(key, todayKey)}</h3>
          <ul>
            {rows.map((e) => (
              <li key={`${e.kind}:${e.id}`} className={'feed-row is-' + e.kind}>
                <span className="feed-glyph" aria-hidden>
                  {GLYPH[e.kind]}
                </span>
                <span className="feed-who">
                  {e.mine ? (
                    'You'
                  ) : (
                    <a href={'#profile?u=' + encodeURIComponent(e.who)}>{e.name}</a>
                  )}
                </span>
                <What e={e} />
                <span className="muted feed-when">{clock(e.at)}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
