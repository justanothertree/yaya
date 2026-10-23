import { useCallback, useEffect, useState } from 'react'
import { friendsLog, type FriendSitting } from './cloud'
import { countText, spanText } from './record'
import { today as todayISO } from './goal'

/**
 * What your friends have been doing.
 *
 * ⚠️ IT SHOWS NOTHING BY DEFAULT AND THAT IS THE FEATURE. Three switches stand between a sitting
 * and this list — the owner's chronicle block exists, that block asks for a timeline, and the
 * activity itself is ticked — and all three are read in SQL where a caller cannot reach them.
 * So an empty list here is the ordinary case, not a fault, and the copy under it says which of
 * the three is most likely missing rather than "nothing yet".
 *
 * ⚠️ NO NOTES AND NO RATINGS, because the profile card promises as much and that promise is built
 * from the same flags that draw the card. See docs/2026-10-23-chronicle-friends-timeline.sql.
 */
const DAYS = 7

/** the local calendar day an instant falls in, for grouping — never a UTC slice */
const dayKey = (iso: string): string => {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const dayName = (key: string, todayKey: string): string => {
  if (key === todayKey) return 'Today'
  const d = new Date(key + 'T12:00:00')
  const y = new Date(todayKey + 'T12:00:00')
  y.setDate(y.getDate() - 1)
  if (dayKey(y.toISOString()) === key) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

export function Friends({ authed }: { authed: boolean }) {
  const [log, setLog] = useState<FriendSitting[] | null>(null)

  const load = useCallback(async () => {
    if (!authed) return
    const to = new Date()
    const from = new Date(to.getTime() - DAYS * 86_400_000)
    setLog(await friendsLog(from.toISOString(), to.toISOString()))
  }, [authed])

  useEffect(() => {
    void load()
  }, [load])

  if (!authed) return null
  if (log === null)
    return (
      <p className="muted" aria-busy>
        Looking…
      </p>
    )

  if (log.length === 0)
    return (
      <div className="chron-friends-none">
        <p className="muted">Nothing from anyone yet.</p>
        {/**
         * ⚠️ THE EMPTY STATE NAMES THE THREE SWITCHES, because every one of them is off by
         * default and "nothing yet" would read as "none of my friends use this". Two of the
         * three are on the reader's own side of the fence and one is not, so the list says who
         * has to do what rather than implying it is somebody else's fault.
         */}
        <p className="muted">
          A friend shows up here once they have added a Chronicle card to their profile, ticked
          <strong> Show my timeline</strong> on it, and ticked <strong>Friends can see this</strong>{' '}
          on an activity. Yours works the same way — nothing of yours is here until you do all
          three.
        </p>
      </div>
    )

  const todayKey = todayISO()
  const days: Array<[string, FriendSitting[]]> = []
  for (const s of log) {
    const k = dayKey(s.start)
    const last = days[days.length - 1]
    if (last && last[0] === k) last[1].push(s)
    else days.push([k, [s]])
  }

  return (
    <div className="chron-friends">
      {days.map(([key, rows]) => (
        <section key={key} className="chron-friends-day">
          <h3>{dayName(key, todayKey)}</h3>
          <ul>
            {rows.map((s, i) => (
              <li key={`${s.who}-${s.start}-${i}`} className={'chron-friend-row is-' + s.cat}>
                <span className="chron-friend-who">{s.name}</span>
                <span className="chron-friend-what">
                  {s.colour ? (
                    <span className="chron-dot" style={{ background: s.colour }} aria-hidden />
                  ) : null}
                  {s.activity}
                </span>
                <span className="chron-friend-len">
                  {spanText(Date.parse(s.end) - Date.parse(s.start))}
                </span>
                {s.amount != null && s.metric ? (
                  <span className="muted chron-friend-amt">
                    {countText(s.amount)} {s.metric}
                  </span>
                ) : null}
                <span className="muted chron-friend-when">
                  {clock(s.start)} – {clock(s.end)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
