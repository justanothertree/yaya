import { useEffect, useState } from 'react'
import { challenge, challengeableFriends } from './cloud'
import { LEVEL_NAMES, MATCH_LEVELS, MATCH_NAMES, VERSUS_ONLY, modeWords } from './names'
import { matchHash } from './words'

/**
 * 🎲 Challenge, on a friend's profile: pick the toy, versus or together, and the computer's level
 * for together. It sends the same challenge the toy's own button does, and opens the match at its
 * own address in the Lab.
 *
 * ⚠️ SHOWN ONLY BESIDE "✓ Friends", and the server asks again: `lab_match_challenge` refuses
 * anybody who is not an accepted friend with the answer a stranger gets. A profile names a
 * username and a challenge needs an id, so the friend is found in the same directory the toy's
 * picker reads; somebody not in it as a friend is not offered a button that would only fail.
 *
 * ⚠️ IT IMPORTS NAMES, NOT RULES: games.ts holds every toy's engine, and the profile page has no
 * use for chess's move generator. names.ts carries the toy names and the levels, and games.test.ts
 * holds them to the real rules.
 */
/** the head's button; the page holds whether the panel is open */
export function ProfileChallengeButton({
  open,
  onToggle,
}: {
  open: boolean
  onToggle: () => void
}) {
  return (
    <button
      className="btn"
      aria-expanded={open}
      aria-controls="profile-challenge"
      onClick={onToggle}
    >
      🎲 Challenge
    </button>
  )
}

/**
 * ⚠️ THE PANEL LIVES UNDER THE HEAD, NOT IN IT: the head's buttons sit in a flex row that does not
 * wrap, and a panel inside it pushed the whole card 42px past a 375px screen. Measured, then moved.
 */
export function ProfileChallenge({ username, name }: { username: string; name: string }) {
  const [friend, setFriend] = useState<{ id: string } | null | undefined>(undefined)
  const [demo, setDemo] = useState<string>(Object.keys(MATCH_NAMES)[0])
  const [mode, setMode] = useState<'versus' | 'together'>(modeWords(demo).first)
  const words = modeWords(demo)
  const [level, setLevel] = useState<string>(MATCH_LEVELS[1])
  const [busy, setBusy] = useState(false)
  // a duel has no computer: versus alone, whatever was picked for the toy before it
  const together = !VERSUS_ONLY.has(demo)
  const how = together ? mode : 'versus'
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (friend !== undefined) return
    let alive = true
    challengeableFriends()
      .then((list) => alive && setFriend(list.find((f) => f.username === username) ?? null))
      .catch(() => alive && setError('Your friends could not be loaded. Try again in a moment.'))
    return () => {
      alive = false
    }
  }, [friend, username])

  const send = async () => {
    if (!friend) return
    setBusy(true)
    setError(null)
    try {
      const v = await challenge(friend.id, demo, how, how === 'together' ? { level } : {})
      location.hash = matchHash(demo, v.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The challenge could not be sent.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {
        <div id="profile-challenge" className="match-panel profile-challenge">
          <p className="muted">
            Challenge {name} to a game by turns: you move now, they move whenever they like, and the
            server checks every move.
          </p>
          {friend === null && (
            <p className="muted">Only friends can be challenged, and {name} isn’t listed as one.</p>
          )}
          {friend === undefined && !error && <p className="muted">Getting ready…</p>}
          {friend && (
            <>
              <div className="lab-controls" role="group" aria-label="Which game">
                {Object.entries(MATCH_NAMES).map(([id, toy]) => (
                  <button
                    key={id}
                    className="btn btn-ghost"
                    aria-pressed={demo === id}
                    onClick={() => {
                      setDemo(id)
                      // each toy starts on the mode it offers first: Spades on the partners
                      setMode(modeWords(id).first)
                    }}
                  >
                    {toy}
                  </button>
                ))}
              </div>
              {together && (
                <div className="lab-controls" role="group" aria-label="How to play">
                  <button
                    className="btn btn-ghost"
                    aria-pressed={mode === 'versus'}
                    onClick={() => setMode('versus')}
                  >
                    {words.versus}
                  </button>
                  <button
                    className="btn btn-ghost"
                    aria-pressed={mode === 'together'}
                    onClick={() => setMode('together')}
                  >
                    {words.together}
                  </button>
                </div>
              )}
              {how === 'together' && (
                <div className="lab-controls" role="group" aria-label="How well the computer plays">
                  {MATCH_LEVELS.map((l) => (
                    <button
                      key={l}
                      className="btn btn-ghost"
                      aria-pressed={level === l}
                      onClick={() => setLevel(l)}
                    >
                      {LEVEL_NAMES[l]}
                    </button>
                  ))}
                </div>
              )}
              <div className="lab-controls">
                <button className="btn" disabled={busy} onClick={() => void send()}>
                  {busy ? 'Sending…' : `Challenge ${name} to ${MATCH_NAMES[demo]}`}
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
      }
    </>
  )
}
