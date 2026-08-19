import { useState } from 'react'
import {
  ProfileBlocksEditor,
  ProfileBlocksView,
  type ProfileBlock,
} from '../sections/ProfileBlocks'
import { avatarStyle, BANNER_STYLES, type BannerStyle } from '../profile/look'

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
        <ProfileBlocksEditor initial={blocks} username={who} onSaved={setBlocks} />
      ) : (
        <ProfileBlocksView
          blocks={blocks}
          activity={[]}
          snakeBest={{ score: 812, game_mode: 'classic' }}
          username={who}
        />
      )}
    </div>
  )
}
