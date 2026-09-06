// What's here — the one screen that says what this site can do.
//
// ⚠️ IT REPLACED A KEYBOARD-SHORTCUT CARD THAT LISTED THREE SHORTCUTS AND NOT ONE FEATURE.
// That card was the only overview the site had, it was bound to `?` and nothing else — so it
// did not exist at all on a phone — and it never mentioned Paint, pools, profiles, backdrops or
// Canvas. Everything somebody could not find was findable; it was just never named anywhere.
//
// ⚠️ THE ROOMS COME FROM navFor(), NOT FROM A LIST TYPED HERE. That is the whole discipline of
// nav/places.ts, and this is exactly the sixth list that file exists to prevent — an overview
// which quietly stops mentioning a room somebody added is worse than no overview, because it
// reads as authoritative. Add a room there and it appears here.
//
// ⚠️ THE THINGS BELOW THE ROOMS ARE CONTROLS, NOT DESCRIPTIONS. It would have been easier to
// write "your profile is in the menu under your initial", but a sentence about where a button
// lives goes stale the moment the button moves, and it still leaves you hunting. These do the
// thing. The account menu keeps its own copies because it is a menu; this is the index.
import { navFor, type Section, type Viewer } from '../nav/places'

export function WhatsHere({
  viewer,
  onClose,
  onGo,
  onAppearance,
  onProfile,
  onReportBug,
  onToggleCanvas,
  canvasOpen,
  canvasCapable,
  desktop,
}: {
  viewer: Viewer
  onClose: () => void
  onGo: (s: Section) => void
  onAppearance: () => void
  /** null when you have no profile page yet — signed out, or no username chosen */
  onProfile: (() => void) | null
  onReportBug: () => void
  onToggleCanvas: () => void
  canvasOpen: boolean
  canvasCapable: boolean
  desktop: boolean
}) {
  const rooms = navFor(viewer)

  /** one row of the "beyond the rooms" list; `null` entries are dropped */
  type Thing = { icon: string; label: string; hint: string; run: () => void } | null
  const things: Thing[] = [
    onProfile
      ? {
          icon: '🪪',
          label: 'Your profile',
          hint: 'Your page — how you look to everyone else.',
          run: onProfile,
        }
      : null,
    {
      icon: '🎨',
      label: 'Appearance',
      hint: 'Colours, the background behind everything, click effects and the mouse trail.',
      run: onAppearance,
    },
    /**
     * ⚠️ LISTED EVEN WHERE IT CANNOT BE USED, which is the opposite of what I wrote first.
     *
     * Canvas is only available in rooms that can be windowed, so gating the row on
     * `canvasCapable` made it disappear on Home — the one page a first-time visitor is standing
     * on when they go looking for what this site does. An index that hides a capability
     * depending on where you happen to be is not an index. On a page that cannot do it the row
     * stays and says so; only a phone drops it, because a phone genuinely has nowhere to put a
     * second window.
     */
    desktop
      ? {
          icon: '⛶',
          label: canvasOpen ? 'Canvas is on' : 'Canvas',
          hint: canvasCapable
            ? 'Put rooms in windows and use more than one at once — the instrument beside the visualiser.'
            : 'Rooms in windows, more than one at once. Not on this page — open the Instrument, Visualiser or Paint and try it there.',
          run: canvasCapable ? onToggleCanvas : () => onGo('instrument'),
        }
      : null,
    {
      icon: '🐞',
      label: 'Report a bug',
      hint: 'From wherever you found it. It comes straight to me.',
      run: onReportBug,
    },
  ]

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="What's here"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 200,
        padding: '1rem',
      }}
    >
      <div
        className="card wh-card"
        style={{ maxWidth: 560, width: '100%', cursor: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="section-title" style={{ marginTop: 0 }}>
          What&apos;s here
        </h2>

        <p className="muted wh-lead">Every room you can open:</p>
        <div className="wh-rooms">
          {rooms.map((p) => (
            <button
              key={p.id}
              className="wh-room"
              onClick={() => {
                onGo(p.id)
                onClose()
              }}
            >
              <span aria-hidden>{p.icon}</span> {p.label}
            </button>
          ))}
        </div>

        <p className="muted wh-lead">And the things that aren&apos;t rooms:</p>
        <div className="wh-things">
          {things
            .filter((t): t is NonNullable<Thing> => t !== null)
            .map((t) => (
              <button
                key={t.label}
                className="wh-thing"
                onClick={() => {
                  t.run()
                  onClose()
                }}
              >
                <span className="wh-thing-top">
                  <span aria-hidden>{t.icon}</span> <strong>{t.label}</strong>
                </span>
                <span className="muted wh-thing-hint">{t.hint}</span>
              </button>
            ))}
        </div>

        {/* same signal Canvas uses: on a phone this is three facts about a keyboard nobody
            has to hand, taking up the space the actual answers need */}
        {desktop && (
          <p className="muted wh-keys">
            Keyboard: <kbd>←</kbd> <kbd>→</kbd> move between sections, <kbd>?</kbd> opens this,{' '}
            <kbd>Esc</kbd> closes it.
          </p>
        )}

        <div style={{ textAlign: 'right' }}>
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
