import { useEffect, useState } from 'react'
import { challenge, challengeableFriends } from './cloud'
import { matchToy } from './games'
import { matchHash } from './words'

/**
 * 🎲 Challenge a friend: pick a friend, versus or together, and the computer's level for
 * together. The challenge is a match in `invited` state; it opens at once, at its own address,
 * and your friend finds it in their bell and their Your games.
 *
 * Only accepted friends are offered, and the server asks again (`lab_match_challenge` refuses
 * anybody else with the answer a stranger gets). Challenging somebody you already have a match
 * going with on this toy opens that one instead, as the server decides.
 */
export function MatchChallenge({
  demo,
  settings,
  levelNames,
  sides,
}: {
  demo: string
  /** what the challenge plays on, from the toy's own settings: a board size, say */
  settings: Record<string, unknown>
  levelNames: Record<string, string>
  /**
   * A lopsided game's sides, for versus: the challenger picks theirs (sent as `side`), the first
   * being the default, and the friend plays the other. Together, the team plays the toy's own side.
   */
  sides?: readonly { value: string; name: string }[]
}) {
  const toy = matchToy(demo)
  const [open, setOpen] = useState(false)
  const [friends, setFriends] = useState<{ id: string; name: string }[] | null>(null)
  const [who, setWho] = useState<string | null>(null)
  const [mode, setMode] = useState<'versus' | 'together'>('versus')
  const [level, setLevel] = useState<string>(toy?.levels[1] ?? toy?.levels[0] ?? '')
  const [side, setSide] = useState<string | null>(sides?.[0]?.value ?? null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || friends) return
    let alive = true
    challengeableFriends()
      .then((f) => alive && setFriends(f))
      .catch(() => alive && setError('Your friends could not be loaded. Try again in a moment.'))
    return () => {
      alive = false
    }
  }, [open, friends])

  if (!toy) return null
  const send = async () => {
    if (!who) return
    setBusy(true)
    setError(null)
    try {
      const v = await challenge(
        who,
        demo,
        mode,
        mode === 'together'
          ? { ...settings, level }
          : side === null
            ? settings
            : { ...settings, side },
      )
      setOpen(false)
      location.hash = matchHash(demo, v.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The challenge could not be sent.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="match-challenge">
      <button
        className="btn btn-ghost"
        aria-expanded={open}
        aria-controls={`match-challenge-${demo}`}
        onClick={() => setOpen((o) => !o)}
      >
        🎲 Challenge a friend
      </button>
      {open && (
        <div id={`match-challenge-${demo}`} className="match-panel">
          <p className="muted">
            Play {toy.name} by turns: you move now, your friend moves whenever they like, and the
            server checks every move.
          </p>
          {friends === null && !error && <p className="muted">Loading your friends…</p>}
          {friends?.length === 0 && (
            <p className="muted">
              You have no friends here yet. Add some on <a href="#people">People</a>, then challenge
              them.
            </p>
          )}
          {friends && friends.length > 0 && (
            <>
              <div className="lab-controls" role="group" aria-label="Which friend">
                {friends.map((f) => (
                  <button
                    key={f.id}
                    className="btn btn-ghost"
                    aria-pressed={who === f.id}
                    onClick={() => setWho(f.id)}
                  >
                    {f.name}
                  </button>
                ))}
              </div>
              <div className="lab-controls" role="group" aria-label="How to play">
                <button
                  className="btn btn-ghost"
                  aria-pressed={mode === 'versus'}
                  onClick={() => setMode('versus')}
                >
                  ⚔️ Versus
                </button>
                <button
                  className="btn btn-ghost"
                  aria-pressed={mode === 'together'}
                  onClick={() => setMode('together')}
                >
                  🤝 Together against the computer
                </button>
              </div>
              {mode === 'versus' && sides && sides.length > 1 && (
                <div className="lab-controls" role="group" aria-label="Your side">
                  {sides.map((s) => (
                    <button
                      key={s.value}
                      className="btn btn-ghost"
                      aria-pressed={side === s.value}
                      onClick={() => setSide(s.value)}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              )}
              {mode === 'together' && (
                <div className="lab-controls" role="group" aria-label="How well the computer plays">
                  {toy.levels.map((l) => (
                    <button
                      key={l}
                      className="btn btn-ghost"
                      aria-pressed={level === l}
                      onClick={() => setLevel(l)}
                    >
                      {levelNames[l] ?? l}
                    </button>
                  ))}
                </div>
              )}
              <div className="lab-controls">
                <button className="btn" disabled={!who || busy} onClick={() => void send()}>
                  {busy ? 'Sending…' : 'Send challenge'}
                </button>
              </div>
            </>
          )}
          {error && (
            <p className="lab-warn" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
