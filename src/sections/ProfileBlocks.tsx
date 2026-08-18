import { useState } from 'react'
import { getSupabaseClient } from '../finance/client'

/**
 * Optional, block-based profile customization.
 *
 * Deliberately NOT freeform HTML — every block is a fixed shape the CLIENT renders, and
 * `config` is just that block's data (a bio string, an image URL, a links list). There is no
 * path from one person's config to another person's rendered markup, which is what keeps this
 * safe without a sanitizer. "Optional" is structural: zero blocks means the page underneath
 * (circuits, snake, movies) is unchanged — customizing only ever adds to it.
 */

export type Tier = 'public' | 'friends' | 'members' | 'private'

export type ProfileBlock = {
  id?: string
  block_type: 'bio' | 'banner' | 'stats' | 'activity' | 'links'
  size: 'small' | 'medium' | 'large'
  config: Record<string, unknown>
  visibility: Tier
}

const TIER_LABEL: Record<Tier, string> = {
  public: 'Anyone',
  friends: 'Friends',
  members: 'Members',
  private: 'Only me',
}

export type ActivityItem = {
  kind: 'circuit_log' | 'snake_score' | 'snake_trophy'
  at: string
  detail: string | null
  score: number | null
}

const BLOCK_LABEL: Record<ProfileBlock['block_type'], string> = {
  bio: '📝 Bio',
  banner: '🖼️ Banner',
  stats: '📊 Stats',
  activity: '🕓 Activity',
  links: '🔗 Links',
}

/**
 * A link block's `url` is whatever the profile owner typed — including another member typing it
 * about THEMSELVES, which is the case that matters here. `javascript:` and `data:` both parse as
 * valid URLs and were rendering straight into a real `<a href>`; a `javascript:` one runs in the
 * VIEWER'S session the moment they click it, as if they'd typed it into their own address bar
 * while signed in. Restricting to http/https closes that off entirely rather than trying to
 * blocklist dangerous schemes one at a time.
 */
function safeHref(url: string): string | null {
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

function activityLine(a: ActivityItem): string {
  const when = new Date(a.at).toLocaleDateString()
  if (a.kind === 'circuit_log') return 'Logged a workout in ' + a.detail + ' · ' + when
  if (a.kind === 'snake_trophy')
    return 'Won ' + a.detail + ' in Snake (score ' + a.score + ') · ' + when
  return 'Scored ' + a.score + (a.detail ? ' · ' + a.detail : '') + ' · ' + when
}

/** One block, rendered as a reader sees it — no edit controls here at all. */
function BlockView({
  block,
  activity,
  snakeBest,
}: {
  block: ProfileBlock
  activity: ActivityItem[]
  snakeBest: { score: number; game_mode: string | null } | null
}) {
  const cfg = block.config
  switch (block.block_type) {
    case 'bio': {
      const text = typeof cfg.text === 'string' ? cfg.text : ''
      if (!text.trim()) return null
      return (
        <div className={'card profile-block is-' + block.size}>
          {/* plain text node, never HTML -- a bio can say anything, it can never RENDER anything */}
          <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{text}</p>
        </div>
      )
    }
    case 'banner': {
      const url = typeof cfg.url === 'string' ? cfg.url : ''
      if (!url.trim()) return null
      return (
        <div
          className={'card profile-block is-' + block.size}
          style={{ padding: 0, overflow: 'hidden' }}
        >
          <img src={url} alt="" className="profile-banner-img" />
        </div>
      )
    }
    case 'stats':
      return (
        <div className={'card profile-block is-' + block.size}>
          <h3 style={{ marginTop: 0 }}>📊 Stats</h3>
          <p style={{ margin: 0 }}>
            {snakeBest ? (
              <>
                <strong style={{ fontSize: '1.4rem' }}>{snakeBest.score}</strong>{' '}
                <span className="muted">Snake best</span>
              </>
            ) : (
              <span className="muted">No Snake score yet</span>
            )}
          </p>
          <p className="muted" style={{ margin: '0.3rem 0 0' }}>
            {activity.filter((a) => a.kind === 'snake_trophy').length} trophies
          </p>
        </div>
      )
    case 'activity': {
      const limit = typeof cfg.limit === 'number' ? cfg.limit : 10
      const items = activity.slice(0, limit)
      return (
        <div className={'card profile-block is-' + block.size}>
          <h3 style={{ marginTop: 0 }}>🕓 Activity</h3>
          {items.length ? (
            <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
              {items.map((a, i) => (
                <li key={i}>{activityLine(a)}</li>
              ))}
            </ul>
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              Nothing to show yet.
            </p>
          )}
        </div>
      )
    }
    case 'links': {
      const items = Array.isArray(cfg.items) ? (cfg.items as { label: string; url: string }[]) : []
      if (!items.length) return null
      return (
        <div className={'card profile-block is-' + block.size}>
          <h3 style={{ marginTop: 0 }}>🔗 Links</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
            {items.map((l, i) => {
              const href = safeHref(l.url)
              if (!href) return null
              return (
                <a key={i} className="btn" href={href} target="_blank" rel="noreferrer">
                  {l.label || l.url}
                </a>
              )
            })}
          </div>
        </div>
      )
    }
  }
}

/** Read-only display of every block, in order. Used for everyone, including the owner outside edit mode. */
export function ProfileBlocksView({
  blocks,
  activity,
  snakeBest,
}: {
  blocks: ProfileBlock[]
  activity: ActivityItem[]
  snakeBest: { score: number; game_mode: string | null } | null
}) {
  if (!blocks.length) return null
  return (
    <div className="profile-blocks-grid">
      {blocks.map((b, i) => (
        <BlockView key={b.id ?? i} block={b} activity={activity} snakeBest={snakeBest} />
      ))}
    </div>
  )
}

/** One editable row in the arrange-your-page panel. */
function BlockEditRow({
  block,
  onChange,
  onRemove,
  onMove,
  isFirst,
  isLast,
}: {
  block: ProfileBlock
  onChange: (next: ProfileBlock) => void
  onRemove: () => void
  onMove: (dir: -1 | 1) => void
  isFirst: boolean
  isLast: boolean
}) {
  const setCfg = (patch: Record<string, unknown>) =>
    onChange({ ...block, config: { ...block.config, ...patch } })
  const cycleSize = () =>
    onChange({
      ...block,
      size: block.size === 'small' ? 'medium' : block.size === 'medium' ? 'large' : 'small',
    })

  return (
    <div className="card profile-editrow">
      <div className="profile-editrow-head">
        <strong>{BLOCK_LABEL[block.block_type]}</strong>
        <span className="profile-editrow-actions">
          <button className="btn" disabled={isFirst} onClick={() => onMove(-1)} title="Move up">
            ↑
          </button>
          <button className="btn" disabled={isLast} onClick={() => onMove(1)} title="Move down">
            ↓
          </button>
          <button className="btn" onClick={cycleSize} title="Cycle size">
            {block.size}
          </button>
          <select
            className="btn"
            value={block.visibility}
            onChange={(e) => onChange({ ...block, visibility: e.target.value as Tier })}
            title="Who can see this block"
          >
            {(Object.keys(TIER_LABEL) as Tier[]).map((t) => (
              <option key={t} value={t}>
                {TIER_LABEL[t]}
              </option>
            ))}
          </select>
          <button className="btn" onClick={onRemove} title="Remove">
            ✕
          </button>
        </span>
      </div>
      {block.block_type === 'bio' && (
        <textarea
          className="profile-editrow-textarea"
          placeholder="Say something about yourself…"
          value={typeof block.config.text === 'string' ? block.config.text : ''}
          onChange={(e) => setCfg({ text: e.target.value.slice(0, 2000) })}
          rows={4}
        />
      )}
      {block.block_type === 'banner' && (
        <input
          type="url"
          placeholder="https://…"
          value={typeof block.config.url === 'string' ? block.config.url : ''}
          onChange={(e) => setCfg({ url: e.target.value })}
        />
      )}
      {block.block_type === 'activity' && (
        <label className="muted" style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
          Show
          <input
            type="number"
            min={1}
            max={20}
            style={{ width: '4rem' }}
            value={typeof block.config.limit === 'number' ? block.config.limit : 10}
            onChange={(e) =>
              setCfg({ limit: Math.min(20, Math.max(1, Number(e.target.value) || 10)) })
            }
          />
          items
        </label>
      )}
      {block.block_type === 'links' && (
        <LinksEditor
          items={
            Array.isArray(block.config.items)
              ? (block.config.items as { label: string; url: string }[])
              : []
          }
          onChange={(items) => setCfg({ items })}
        />
      )}
      {block.block_type === 'stats' && (
        <p className="muted" style={{ margin: 0 }}>
          Fills in automatically from your Snake results — nothing to set here.
        </p>
      )}
    </div>
  )
}

function LinksEditor({
  items,
  onChange,
}: {
  items: { label: string; url: string }[]
  onChange: (items: { label: string; url: string }[]) => void
}) {
  const update = (i: number, patch: Partial<{ label: string; url: string }>) =>
    onChange(items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)))
  return (
    <div style={{ display: 'grid', gap: '0.35rem' }}>
      {items.map((it, i) => (
        <div key={i} style={{ display: 'flex', gap: '0.3rem' }}>
          <input
            placeholder="Label"
            value={it.label}
            onChange={(e) => update(i, { label: e.target.value })}
            style={{ width: '8rem' }}
          />
          <input
            placeholder="https://…"
            value={it.url}
            onChange={(e) => update(i, { url: e.target.value })}
            style={{ flex: 1 }}
          />
          <button className="btn" onClick={() => onChange(items.filter((_, idx) => idx !== i))}>
            ✕
          </button>
        </div>
      ))}
      <button
        className="btn"
        onClick={() => onChange([...items, { label: '', url: '' }])}
        disabled={items.length >= 10}
      >
        + Add link
      </button>
    </div>
  )
}

/** The "arrange your page" panel — owner only, shown behind an Edit toggle in Profile.tsx. */
export function ProfileBlocksEditor({
  initial,
  username,
  onSaved,
}: {
  initial: ProfileBlock[]
  username: string
  onSaved: (blocks: ProfileBlock[]) => void
}) {
  const [blocks, setBlocks] = useState<ProfileBlock[]>(initial)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const addBlock = (type: ProfileBlock['block_type']) =>
    setBlocks((b) => [
      ...b,
      {
        block_type: type,
        size: 'medium',
        config: {},
        // 'members' means anyone with ANY account on the site -- fine for a bio or a links
        // list, but activity/stats surface circuit-flavored detail (workout logs, trophies) to
        // people who may have signed up for an unrelated module and have no context for it.
        // 'friends' at least requires an accepted mutual friendship first. The circuit_log rows
        // themselves are separately restricted to viewers who actually share that circuit
        // (get_member_activity checks membership per row) -- this default is about avoiding an
        // accidentally-broad START, not a gap in what the row-level check already covers.
        visibility: type === 'activity' || type === 'stats' ? 'friends' : 'members',
      },
    ])
  const move = (i: number, dir: -1 | 1) =>
    setBlocks((b) => {
      const j = i + dir
      if (j < 0 || j >= b.length) return b
      const next = [...b]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })

  const save = async () => {
    setSaving(true)
    setErr(null)
    const { error } = await getSupabaseClient().rpc('save_my_profile_blocks', {
      p_blocks: blocks.map(({ block_type, size, config, visibility }) => ({
        block_type,
        size,
        config,
        visibility,
      })),
    })
    setSaving(false)
    if (error) setErr(error.message)
    else onSaved(blocks)
  }

  return (
    <div className="card profile-editor" data-username={username}>
      <h3 style={{ marginTop: 0 }}>Arrange your page</h3>
      <div style={{ display: 'grid', gap: '0.5rem' }}>
        {blocks.map((b, i) => (
          <BlockEditRow
            key={i}
            block={b}
            onChange={(next) => setBlocks((all) => all.map((x, idx) => (idx === i ? next : x)))}
            onRemove={() => setBlocks((all) => all.filter((_, idx) => idx !== i))}
            onMove={(dir) => move(i, dir)}
            isFirst={i === 0}
            isLast={i === blocks.length - 1}
          />
        ))}
      </div>
      <div className="profile-editor-add">
        {(Object.keys(BLOCK_LABEL) as Array<ProfileBlock['block_type']>).map((t) => (
          <button
            key={t}
            className="btn"
            onClick={() => addBlock(t)}
            disabled={blocks.length >= 20}
          >
            + {BLOCK_LABEL[t]}
          </button>
        ))}
      </div>
      {err && <p style={{ color: '#f46b6b', margin: '0.5rem 0 0' }}>{err}</p>}
      <div style={{ marginTop: '0.6rem' }}>
        <button className="btn" onClick={() => void save()} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}
