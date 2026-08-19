import { useCallback, useEffect, useState } from 'react'
import { getSupabaseClient } from '../finance/client'
import { BANNER_STYLES, bannerBackground, type BannerStyle } from '../profile/look'

/**
 * Optional, block-based profile customization.
 *
 * Deliberately NOT freeform HTML — every block is a fixed shape the CLIENT renders, and
 * `config` is just that block's data (a bio string, an image URL, an activity limit). There is no
 * path from one person's config to another person's rendered markup, which is what keeps this
 * safe without a sanitizer. "Optional" is structural: zero blocks means the page underneath
 * (circuits, snake, movies) is unchanged — customizing only ever adds to it.
 *
 * No block type sends a viewer OFF the site (a "Links" block used to, and was cut) — the content
 * itself belongs in the block, not a button pointing somewhere else.
 */

export type Tier = 'public' | 'friends' | 'members' | 'private'

export type ProfileBlock = {
  id?: string
  block_type: 'bio' | 'banner' | 'stats' | 'activity' | 'guestbook' | 'status' | 'trophies'
  size: 'small' | 'medium' | 'large'
  config: Record<string, unknown>
  visibility: Tier
}

export type ProfileNote = {
  id: string
  body: string
  at: string
  author: string
  author_username: string
  can_delete: boolean
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
  guestbook: '💬 Guestbook',
  status: '💭 Status',
  trophies: '🏆 Trophies',
}

/**
 * The mood set for a status.
 *
 * PICKED, not typed — the standing ceiling on this whole system is "no full HTML/CSS editor",
 * and the same logic applies at small scale: an emoji field you type into has a wrong-input
 * state, a row of moods to click does not.
 */
const MOODS = ['💭', '🎮', '💪', '🔥', '😴', '🎬', '🎧', '🍕', '🧠', '😤', '🥳', '🫠'] as const

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
  username,
  isMe,
}: {
  block: ProfileBlock
  activity: ActivityItem[]
  snakeBest: { score: number; game_mode: string | null } | null
  /** whose page this is — a banner with no colour picked falls back to their own */
  username: string
  /** the guestbook's compose box addresses you differently on your own page */
  isMe: boolean
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
      // Always renders: a banner is a chosen LOOK now, not a URL that might be blank or broken.
      const { background } = bannerBackground(cfg, username)
      return (
        <div
          className={'card profile-block is-' + block.size}
          style={{ padding: 0, overflow: 'hidden' }}
        >
          <div className="profile-banner-art" style={{ background }} aria-hidden />
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
    case 'status': {
      const text = typeof cfg.text === 'string' ? cfg.text.trim() : ''
      const emoji = typeof cfg.emoji === 'string' && cfg.emoji ? cfg.emoji : '💭'
      if (!text) return null
      // One line, big, no heading — a status IS the sentence, and a "Status" label above it
      // would just be a word taking up the space the sentence should have.
      return (
        <div className={'card profile-block profile-status is-' + block.size}>
          <span className="profile-status-emoji" aria-hidden>
            {emoji}
          </span>
          <p style={{ margin: 0 }}>{text}</p>
        </div>
      )
    }
    case 'trophies': {
      // Snake trophies already existed and were only ever COUNTED (the stats block says "3
      // trophies"). Naming them is the difference between a number and something worth showing.
      const won = activity.filter((a) => a.kind === 'snake_trophy')
      return (
        <div className={'card profile-block is-' + block.size}>
          <h3 style={{ marginTop: 0 }}>🏆 Trophies</h3>
          {won.length ? (
            <div className="profile-trophies">
              {won.map((a, i) => (
                <span
                  key={i}
                  className="profile-trophy"
                  title={new Date(a.at).toLocaleDateString()}
                >
                  🏆 {a.detail}
                  {a.score != null && <span className="muted"> · {a.score}</span>}
                </span>
              ))}
            </div>
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              {isMe ? 'No trophies yet — go win a round.' : 'None yet.'}
            </p>
          )}
        </div>
      )
    }
    case 'guestbook':
      return <Guestbook username={username} isMe={isMe} />
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
  }
}

/** Read-only display of every block, in order. Used for everyone, including the owner outside edit mode. */
export function ProfileBlocksView({
  blocks,
  activity,
  snakeBest,
  username,
  isMe = false,
}: {
  blocks: ProfileBlock[]
  activity: ActivityItem[]
  snakeBest: { score: number; game_mode: string | null } | null
  username: string
  isMe?: boolean
}) {
  if (!blocks.length) return null
  return (
    <div className="profile-blocks-grid">
      {blocks.map((b, i) => (
        <BlockView
          key={b.id ?? i}
          block={b}
          activity={activity}
          snakeBest={snakeBest}
          username={username}
          isMe={isMe}
        />
      ))}
    </div>
  )
}

/**
 * The guestbook: friends leave a note on your page.
 *
 * Fetches its own notes rather than riding along in the profile payload — they change on their
 * own schedule (someone else writes one), and a note posted here should appear without reloading
 * the whole profile.
 *
 * Deliberately plain. No likes, no counts, no sorting but newest-first: a number beside a note
 * only ever changes what people are willing to write, which is precisely the "corporate fluff"
 * this site exists without.
 */
function Guestbook({ username, isMe }: { username: string; isMe: boolean }) {
  const [notes, setNotes] = useState<ProfileNote[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await getSupabaseClient().rpc('list_profile_notes', {
      p_username: username,
    })
    if (!error) setNotes((data as ProfileNote[]) ?? [])
    setLoaded(true)
  }, [username])

  useEffect(() => {
    setLoaded(false)
    void load()
  }, [load])

  const post = async () => {
    const body = draft.trim()
    if (!body || busy) return
    setBusy(true)
    setErr(null)
    const { error } = await getSupabaseClient().rpc('post_profile_note', {
      p_username: username,
      p_body: body,
    })
    setBusy(false)
    if (error) {
      setErr(error.message)
      return
    }
    setDraft('')
    await load()
  }

  const remove = async (id: string) => {
    const { error } = await getSupabaseClient().rpc('delete_profile_note', { p_id: id })
    if (error) setErr(error.message)
    else await load()
  }

  return (
    <div className="card profile-block is-large">
      <h3 style={{ marginTop: 0 }}>💬 Guestbook</h3>
      {/* Writing on your own page is allowed — it's your page, and a first note stops a new
          guestbook from looking broken. */}
      <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.6rem' }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, 500))}
          onKeyDown={(e) => e.key === 'Enter' && void post()}
          placeholder={isMe ? 'Leave a note on your own page…' : `Say something to ${username}…`}
          aria-label="Write a note"
          style={{ flex: 1 }}
        />
        <button className="btn" onClick={() => void post()} disabled={!draft.trim() || busy}>
          {busy ? '…' : 'Post'}
        </button>
      </div>
      {err && <p style={{ color: '#f46b6b', margin: '0 0 0.5rem', fontSize: '0.82rem' }}>{err}</p>}
      {notes.length === 0 && loaded && (
        <p className="muted" style={{ margin: 0, fontSize: '0.88rem' }}>
          {isMe ? 'Nothing yet — your friends can write here.' : 'Be the first to write something.'}
        </p>
      )}
      <div style={{ display: 'grid', gap: '0.5rem' }}>
        {notes.map((n) => (
          <div key={n.id} className="profile-note">
            <div className="profile-note-head">
              <a
                className="profile-note-author"
                href={'#profile?u=' + encodeURIComponent(n.author_username)}
              >
                {n.author}
              </a>
              <span className="muted profile-note-when">
                {new Date(n.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </span>
              {n.can_delete && (
                <button
                  className="btn profile-note-x"
                  onClick={() => void remove(n.id)}
                  title="Remove this note"
                  aria-label="Remove this note"
                >
                  ✕
                </button>
              )}
            </div>
            {/* plain text, never markup — same rule as the bio */}
            <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{n.body}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

/** One editable row in the arrange-your-page panel. */
/**
 * Pick a banner by looking at it.
 *
 * Every swatch is the REAL background at the currently-chosen colour, so the choice is made by
 * eye rather than by reading eight names and guessing. That is the whole difference from the URL
 * field this replaces: nothing here can be typed wrong, and there is no state where you've filled
 * it in and still can't tell what you'll get.
 */
function BannerPicker({
  config,
  username,
  onChange,
}: {
  config: Record<string, unknown>
  username: string
  onChange: (patch: Record<string, unknown>) => void
}) {
  const { style, hue } = bannerBackground(config, username)
  return (
    <div style={{ display: 'grid', gap: '0.5rem' }}>
      <div className="profile-banner-styles">
        {(Object.keys(BANNER_STYLES) as BannerStyle[]).map((k) => (
          <button
            key={k}
            className={'profile-banner-swatch' + (k === style ? ' is-on' : '')}
            style={{ background: BANNER_STYLES[k].css(hue) }}
            onClick={() => onChange({ style: k, hue })}
            aria-pressed={k === style}
            title={BANNER_STYLES[k].label}
          >
            <span>{BANNER_STYLES[k].label}</span>
          </button>
        ))}
      </div>
      <label style={{ display: 'grid', gap: 4 }}>
        <span className="muted" style={{ fontSize: '0.8rem' }}>
          Colour
        </span>
        {/* The full spectrum as the track, so the slider shows what it does. */}
        <input
          type="range"
          min={0}
          max={359}
          value={hue}
          onChange={(e) => onChange({ style, hue: Number(e.target.value) })}
          aria-label="Banner colour"
          className="profile-hue"
        />
      </label>
    </div>
  )
}

function BlockEditRow({
  block,
  username,
  onChange,
  onRemove,
  onMove,
  isFirst,
  isLast,
}: {
  block: ProfileBlock
  username: string
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
        <BannerPicker config={block.config} username={username} onChange={setCfg} />
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
      {block.block_type === 'stats' && (
        <p className="muted" style={{ margin: 0 }}>
          Fills in automatically from your Snake results — nothing to set here.
        </p>
      )}
      {block.block_type === 'status' && (
        <div style={{ display: 'grid', gap: '0.4rem' }}>
          <div className="profile-mood-row">
            {MOODS.map((m) => (
              <button
                key={m}
                className={'profile-mood' + ((block.config.emoji ?? '💭') === m ? ' is-on' : '')}
                onClick={() => setCfg({ emoji: m })}
                aria-pressed={(block.config.emoji ?? '💭') === m}
                title={`Use ${m}`}
              >
                {m}
              </button>
            ))}
          </div>
          <input
            placeholder="What are you up to?"
            value={typeof block.config.text === 'string' ? block.config.text : ''}
            onChange={(e) => setCfg({ text: e.target.value.slice(0, 120) })}
          />
        </div>
      )}
      {block.block_type === 'trophies' && (
        <p className="muted" style={{ margin: 0 }}>
          Fills in from the Snake rounds you&apos;ve won — nothing to set here.
        </p>
      )}
      {block.block_type === 'guestbook' && (
        <p className="muted" style={{ margin: 0 }}>
          Friends can leave notes on your page. Whoever this block is visible to can write in it —
          you can remove anything left here.
        </p>
      )}
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
            username={username}
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
