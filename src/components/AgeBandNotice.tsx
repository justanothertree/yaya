import { useState } from 'react'

export type AgeBand = 'adult' | 'minor'

/**
 * The members whose age nobody has recorded, and two buttons to record it.
 *
 * ⚠️ THE FAILURE THIS EXISTS FOR IS A SILENT ONE. `feed_may_show` is
 * `owner = auth.uid() or age_band = 'adult' or feed_opt_in`, so a member with no age band is in
 * nobody's feed but their own — and because they can see their own posts, their screen looks
 * exactly like everybody else's. Nothing told them and nothing told the admin. New accounts
 * start in that state deliberately (a child must not be visible by default), which makes this
 * the state EVERY new member arrives in and the one nobody was going to notice.
 *
 * ⚠️ ROWS AND A CALLBACK, NOT AN RPC, and that is the whole reason this is its own file. The
 * notice will be EMPTY on production for as long as everybody has an age band — all 14 do today
 * — and `#dev-admin` renders AdminPanel with no token, so every RPC behind it answers nothing.
 * A component that fetched its own rows would therefore be a component nobody could ever look
 * at: "a room with nothing in it passes every check there is". Taking `handles` as a prop lets
 * `src/dev/AgeNoticePreview.tsx` hand it invented ones, which is the same move
 * `src/dev/TradeReviewPreview.tsx` makes for the trade review, for the same reason.
 *
 * ⚠️ IT SAYS WHAT THE CHOICE DID, because the notice clears the moment an age is set and a row
 * that vanishes is not a confirmation. `adult` puts somebody into both feed tabs; `minor` leaves
 * them out until a guardian opts in. Those are different outcomes and a misclick on the first is
 * the one with a cost, so the line stays on screen until the panel next loads.
 */
export function AgeBandNotice({
  handles,
  onSet,
}: {
  handles: string[]
  onSet: (username: string, band: AgeBand) => Promise<void>
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [done, setDone] = useState<{ username: string; band: AgeBand }[]>([])
  const [err, setErr] = useState<string | null>(null)

  const waiting = handles.filter((h) => !done.some((d) => d.username === h))
  if (!waiting.length && !done.length) return null

  async function set(username: string, band: AgeBand) {
    setBusy(username)
    setErr(null)
    try {
      await onSet(username, band)
      setDone((d) => [...d, { username, band }])
    } catch (e: unknown) {
      setErr(String((e as { message?: string })?.message ?? e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div
      style={{
        border: '1px solid var(--accent,#7c6af7)',
        background: 'var(--b1,rgba(127,127,127,0.07))',
        borderRadius: 10,
        padding: '0.7rem 0.8rem',
        marginBottom: '1.1rem',
      }}
    >
      {!!waiting.length && (
        <>
          <div style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '0.2rem' }}>
            ⚠️ No age recorded for {waiting.length} {waiting.length === 1 ? 'member' : 'members'}
          </div>
          <p className="muted" style={{ fontSize: '0.78rem', margin: '0 0 0.6rem' }}>
            Nobody else can see their posts until you set one. New accounts start this way.
          </p>
        </>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
        {waiting.map((h) => (
          <div
            key={h}
            style={{
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '0.4rem',
            }}
          >
            {/* ⚠️ IT WRAPS RATHER THAN ELLIPSES, WHICH IS THE OPPOSITE OF THE MEMBER ROWS ABOVE
                IT, and the sweep is what settled the difference. Written with the panel's usual
                `overflow: hidden` + ellipsis, a 24-character handle measured 179px of text in a
                144px box at 375 — so it rendered as `@a_handle_of_24_chars…`. In a member row
                that is fine, because the display name and email sit next to it; here the handle
                is the ONLY thing identifying the person, so an ellipsis is the one part of this
                notice that cannot be allowed to go missing.
                The pixel floor stays, and stays in PIXELS: the root font-size is fluid, and
                `min-width: 0` with nothing under it is how a handle ends up a 3px column. */}
            <span
              style={{
                flex: 1,
                minWidth: 96,
                fontSize: '0.85rem',
                fontWeight: 700,
                overflowWrap: 'anywhere',
              }}
            >
              @{h}
            </span>
            {(['adult', 'minor'] as const).map((band) => (
              <button
                key={band}
                className="btn btn-ghost"
                disabled={busy !== null}
                onClick={() => void set(h, band)}
                aria-label={`Record @${h} as ${band === 'adult' ? 'an adult' : 'a minor'}`}
                style={{
                  fontSize: '0.78rem',
                  padding: '0.3rem 0.7rem',
                  minHeight: 28,
                  flexShrink: 0,
                }}
              >
                {busy === h ? '…' : band === 'adult' ? 'Adult' : 'Minor'}
              </button>
            ))}
          </div>
        ))}
      </div>

      {done.map((d) => (
        <p
          key={d.username}
          className="muted"
          style={{ fontSize: '0.78rem', margin: '0.45rem 0 0' }}
        >
          @{d.username} is {d.band === 'adult' ? 'an adult' : 'a minor'} —{' '}
          {d.band === 'adult'
            ? 'their posts appear in both feed tabs now.'
            : 'their posts stay out of the feed until a guardian opts in.'}
        </p>
      ))}

      {err && <p style={{ color: '#f46b6b', fontSize: '0.78rem', margin: '0.45rem 0 0' }}>{err}</p>}
    </div>
  )
}
