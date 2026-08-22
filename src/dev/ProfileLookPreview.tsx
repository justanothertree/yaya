import { useState } from 'react'
import {
  ProfileBlocksEditor,
  ProfileBlocksView,
  type ProfileBlock,
} from '../sections/ProfileBlocks'
import { avatarStyle, BANNER_STYLES, type BannerStyle } from '../profile/look'
import { derivePalette, type PaletteSeed } from '../theme/customTheme'

/**
 * DEV-only workbench for how a profile LOOKS.
 *
 * The real profile page requires a real session (`<Profile authed={isFinanceAuthed} />`), and the
 * customiser sits behind "it's my own page" on top of that — so every visual decision here was
 * otherwise unverifiable without signing in, which is exactly the situation the `#dev-` route
 * exists for (same reasoning as #dev-admin).
 *
 * ⚠️ Every name here is invented. This file ships in a public repo and must never carry a real
 * member's name or handle.
 */

const PEOPLE = ['ada', 'bo', 'cleo', 'dmitri', 'esme', 'fen', 'gus', 'hana', 'ivo', 'juno']

const SAMPLE_BLOCKS: ProfileBlock[] = [
  { block_type: 'banner', size: 'large', config: {}, visibility: 'members' },
  {
    block_type: 'bio',
    size: 'medium',
    config: { text: 'Invented person. Real layout.' },
    visibility: 'members',
  },
  { block_type: 'stats', size: 'small', config: {}, visibility: 'friends' },
  // no session here, so its RPCs fail — which is exactly what should be checked: the block must
  // render its empty state rather than blowing up the page around it
  { block_type: 'guestbook', size: 'large', config: {}, visibility: 'friends' },
  {
    block_type: 'status',
    size: 'medium',
    config: { emoji: '🎮', text: 'chasing a 310' },
    visibility: 'members',
  },
  { block_type: 'trophies', size: 'medium', config: {}, visibility: 'friends' },
  // the block whose whole point is the detail it shows — see SAMPLE_ACTIVITY
  { block_type: 'activity', size: 'medium', config: { limit: 4 }, visibility: 'friends' },
]

// stand-in trophies, so the block can be seen with content rather than only its empty state
const SAMPLE_ACTIVITY = [
  // A circuit log the way the RPC returns it now: what was done, what it scored, and the
  // circuits you SHARE — plus one with detail: null, which is what someone who shares no
  // circuit with this person sees. Both shapes need to render.
  {
    kind: 'circuit_log' as const,
    at: '2026-08-21T00:00:00Z',
    detail: 'The Crew',
    score: 40,
    items: [{ name: 'Miles walked', unit: 'mi', val: 2.5, points: 40 }],
  },
  {
    kind: 'circuit_log' as const,
    at: '2026-08-20T00:00:00Z',
    detail: null,
    score: 68,
    items: [
      { name: 'Pushups', unit: 'reps', val: 40, points: 40 },
      { name: 'Plank', unit: 'min', val: 2.8, points: 28 },
    ],
  },
  { kind: 'snake_trophy' as const, at: '2026-08-01T00:00:00Z', detail: 'Round winner', score: 210 },
  {
    kind: 'snake_trophy' as const,
    at: '2026-07-14T00:00:00Z',
    detail: 'Longest snake',
    score: 188,
  },
]

export function ProfileLookPreview() {
  const [blocks, setBlocks] = useState<ProfileBlock[]>(SAMPLE_BLOCKS)
  const [who, setWho] = useState('ada')
  const [editing, setEditing] = useState(true)

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
        dev preview — #dev-profile · invented people, real components
      </p>

      {/* Do derived colours actually read as different people? */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Derived identity colours</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem' }}>
          {PEOPLE.map((n) => (
            <button
              key={n}
              onClick={() => setWho(n)}
              className="cz-chip"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
              title={`Preview ${n}'s page`}
            >
              <span
                aria-hidden
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '1.6rem',
                  height: '1.6rem',
                  borderRadius: '50%',
                  fontWeight: 700,
                  fontSize: '0.8rem',
                  ...avatarStyle(n),
                }}
              >
                {n[0].toUpperCase()}
              </span>
              {n}
            </button>
          ))}
        </div>
      </div>

      {/* Every banner style at one glance, to catch any that render flat or muddy. */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Every banner style · {who}</h3>
        <div className="profile-banner-styles">
          {(Object.keys(BANNER_STYLES) as BannerStyle[]).map((k) => (
            <div
              key={k}
              className="profile-banner-swatch"
              style={{ background: BANNER_STYLES[k].css(200) }}
            >
              <span>{BANNER_STYLES[k].label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* The scoped look: each card below wears a DIFFERENT person's theme, side by side on one
          page. If scoping leaks, they'd all match — which is the thing to look for here. */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Scoped looks, side by side</h3>
        <div
          style={{
            display: 'grid',
            gap: '0.6rem',
            gridTemplateColumns: 'repeat(auto-fit, minmax(12rem, 1fr))',
          }}
        >
          {[
            { who: 'ada', theme: 'light' as const, palette: null },
            { who: 'bo', theme: 'dark' as const, palette: null },
            { who: 'cleo', theme: 'alt' as const, palette: null },
            {
              who: 'juno',
              theme: null,
              palette: { bg: '#1b1024', text: '#ffe9f7', accent: '#ff5da8' } as PaletteSeed,
            },
          ].map((m) => (
            <div
              key={m.who}
              data-theme={m.palette ? undefined : m.theme}
              style={{
                ...(m.palette ? (derivePalette(m.palette) as React.CSSProperties) : {}),
                background: 'var(--bg)',
                color: 'var(--text)',
                border: '1px solid var(--border)',
                borderRadius: 10,
                padding: '0.75rem',
              }}
              data-look-probe={m.who}
            >
              <strong>{m.who}</strong>
              <p className="muted" style={{ margin: '0.25rem 0 0.5rem', fontSize: '0.8rem' }}>
                {m.palette ? 'custom palette' : m.theme}
              </p>
              <button
                className="btn"
                style={{ background: 'var(--accent)', color: 'var(--btn-text)' }}
              >
                Accent
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <strong>Viewing as:</strong> {who}
        <button
          className="btn"
          onClick={() => setEditing((v) => !v)}
          style={{ marginLeft: 'auto' }}
        >
          {editing ? 'Show read view' : 'Show editor'}
        </button>
      </div>

      {editing ? (
        <ProfileBlocksEditor
          initial={blocks}
          username={who}
          activity={SAMPLE_ACTIVITY}
          snakeBest={{ score: 812, game_mode: 'classic' }}
          onSaved={setBlocks}
        />
      ) : (
        <ProfileBlocksView
          blocks={blocks}
          activity={SAMPLE_ACTIVITY}
          snakeBest={{ score: 812, game_mode: 'classic' }}
          username={who}
        />
      )}
    </div>
  )
}
