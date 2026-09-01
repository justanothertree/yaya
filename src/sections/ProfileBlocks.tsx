import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { getSupabaseClient } from '../finance/client'
import { BANNER_STYLES, bannerBackground, type BannerStyle } from '../profile/look'
import { SongBlock, VisualBlock } from '../profile/ProfileMusic'
import { songFromConfig } from '../profile/songBlockConfig'
import { packSong } from '../audio/songFile'
import { library, subscribeLibrary, type LibraryItem } from '../audio/library'
import { VISUALS } from '../audio/visualModes'
import { PALETTES } from '../audio/palettes'

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
  block_type:
    | 'bio'
    | 'banner'
    | 'stats'
    | 'activity'
    | 'guestbook'
    | 'status'
    | 'trophies'
    | 'song'
    | 'visualizer'
  size: 'small' | 'medium' | 'large'
  config: Record<string, unknown>
  visibility: Tier
}

/** Shape of one guestbook note as list_profile_notes returns it. Local — only the Guestbook
 *  below consumes it, and exporting it invited a second reader that would then need keeping
 *  in step with the RPC. */
type ProfileNote = {
  id: string
  body: string
  at: string
  author: string
  author_username: string
  can_delete: boolean
}

/** Must stay in step with the length() guard in save_my_profile_blocks. */
const CONFIG_LIMIT = 16000

const TIER_LABEL: Record<Tier, string> = {
  public: 'Anyone',
  friends: 'Friends',
  members: 'Members',
  private: 'Only me',
}

export type ActivityItem = {
  kind: 'circuit_log' | 'snake_score' | 'snake_trophy'
  at: string
  /** for a circuit log this is the circuits you SHARE, and null when you share none */
  detail: string | null
  score: number | null
  /** circuit logs only: what was actually done, resolved against their own exercise list */
  items?: Array<{ name: string; unit: string | null; val: number; points: number }> | null
}

const BLOCK_LABEL: Record<ProfileBlock['block_type'], string> = {
  bio: '📝 Bio',
  banner: '🖼️ Banner',
  stats: '📊 Stats',
  activity: '🕓 Activity',
  guestbook: '💬 Guestbook',
  status: '💭 Status',
  trophies: '🏆 Trophies',
  song: '🎵 Song',
  visualizer: '◉ Visualiser',
}

/**
 * The mood set for a status.
 *
 * PICKED, not typed — the standing ceiling on this whole system is "no full HTML/CSS editor",
 * and the same logic applies at small scale: an emoji field you type into has a wrong-input
 * state, a row of moods to click does not.
 */
const MOODS = ['💭', '🎮', '💪', '🔥', '😴', '🎬', '🎧', '🍕', '🧠', '😤', '🥳', '🫠'] as const

/** 2.5 -> "2.5", 40 -> "40" — a rep count should not read as 40.0 */
const num = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100))

function activityLine(a: ActivityItem): string {
  const when = new Date(a.at).toLocaleDateString()
  if (a.kind === 'circuit_log') {
    /**
     * "Logged a workout in The Crew" is the fact that activity happened, not the activity. The
     * circuit feed says what was done, and so does this now.
     *
     * `detail` is the circuits you SHARE with them and is null when you share none — the person
     * decides who sees their activity, but a group's NAME involves people other than them, so
     * you get the what without the where.
     */
    const did = (a.items ?? [])
      .map((it) => `${num(it.val)}${it.unit ? ' ' + it.unit : ''} ${it.name}`)
      .join(', ')
    const pts = a.score ? ` · ${a.score} pts` : ''
    const where = a.detail ? ` · ${a.detail}` : ''
    return (did || 'Logged a workout') + pts + where + ' · ' + when
  }
  if (a.kind === 'snake_trophy')
    return 'Won ' + a.detail + ' in Snake (score ' + a.score + ') · ' + when
  return 'Scored ' + a.score + (a.detail ? ' · ' + a.detail : '') + ' · ' + when
}

/**
 * A trophy, from get_member_trophies — EVERY one of them.
 *
 * ⚠️ Not from the activity feed. Trophies used to be filtered out of `activity`, which is
 * ordered by time and capped at 20 items, so a member with a lot of recent runs was told they
 * had none: theirs were older than the window. A tally must not be a page of a timeline.
 */
export type ProfileTrophy = {
  trophy_name: string
  at: string
  /** which handle won it — a member can hold several, and the medals do not say */
  handle: string | null
  game_mode: string | null
}

/** One block, rendered as a reader sees it — no edit controls here at all. */
function BlockView({
  block,
  activity,
  trophies,
  snakeBest,
  username,
  isMe,
}: {
  block: ProfileBlock
  activity: ActivityItem[]
  trophies: ProfileTrophy[]
  snakeBest: { score: number; game_mode: string | null } | null
  /** whose page this is — a banner with no colour picked falls back to their own */
  username: string
  /** the guestbook's compose box addresses you differently on your own page */
  isMe: boolean
}) {
  const cfg = block.config
  switch (block.block_type) {
    /**
     * ⚠️ A song is NOTES, so this hosts nothing and streams nothing — the visitor's own browser
     * synthesises it. See ProfileMusic. An unreadable one renders as nothing rather than as a
     * broken player: the parser returns null for anything it will not vouch for, and a profile
     * is the last place to argue with a visitor about somebody else's data.
     */
    case 'song': {
      const song = songFromConfig(cfg)
      if (!song) return null
      return <SongBlock id={block.id ?? `song-${song.name}`} song={song} />
    }
    case 'visualizer':
      return <VisualBlock cfg={cfg} />
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
            {trophies.length} trophies
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
      const won = trophies
      return (
        <div className={'card profile-block is-' + block.size}>
          <h3 style={{ marginTop: 0 }}>🏆 Trophies</h3>
          {won.length ? (
            <div className="profile-trophies">
              {won.map((a, i) => (
                <span
                  key={i}
                  className={'profile-trophy is-' + a.trophy_name}
                  title={`${new Date(a.at).toLocaleDateString()}${a.handle ? ` · as ${a.handle}` : ''}`}
                >
                  <span aria-hidden>
                    {a.trophy_name === 'gold' ? '🥇' : a.trophy_name === 'silver' ? '🥈' : '🥉'}
                  </span>{' '}
                  {a.trophy_name.charAt(0).toUpperCase() + a.trophy_name.slice(1)}
                  <span className="muted">
                    {' · '}
                    {new Date(a.at).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </span>
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
  trophies,
  snakeBest,
  username,
  isMe = false,
}: {
  blocks: ProfileBlock[]
  activity: ActivityItem[]
  trophies: ProfileTrophy[]
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
          trophies={trophies}
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

/**
 * What a collapsed row says about itself.
 *
 * A list of seven labels is not a page you can recognise — the point of collapsing is that you
 * can still see WHICH bio and WHICH status without opening each one.
 */
/** The blocks BlockView renders as nothing, so the editor can say so instead of showing a gap. */
function isBlockEmpty(block: ProfileBlock): boolean {
  const txt = typeof block.config.text === 'string' ? block.config.text.trim() : ''
  if (block.block_type === 'bio') return !txt
  if (block.block_type === 'status') return !txt
  if (block.block_type === 'song') return !songFromConfig(block.config)
  return false
}

function blockSummary(block: ProfileBlock): string {
  const txt = typeof block.config.text === 'string' ? block.config.text.trim() : ''
  switch (block.block_type) {
    case 'bio':
      return txt ? txt.replace(/\s+/g, ' ').slice(0, 48) : 'nothing written yet'
    case 'status':
      return txt ? `${(block.config.emoji as string) ?? '💭'} ${txt.slice(0, 36)}` : 'no status set'
    case 'banner': {
      const style = typeof block.config.style === 'string' ? block.config.style : 'aurora'
      return BANNER_STYLES[style as BannerStyle]?.label ?? 'Aurora'
    }
    case 'activity':
      return `last ${typeof block.config.limit === 'number' ? block.config.limit : 10}`
    case 'song': {
      const song = songFromConfig(block.config)
      return song ? song.name : 'nothing picked yet'
    }
    case 'visualizer': {
      const m = typeof block.config.mode === 'string' ? block.config.mode : 'bars'
      return VISUALS.find(([id]) => id === m)?.[2] ?? 'Bars'
    }
    default:
      return 'fills in on its own'
  }
}

/**
 * Choosing which of your songs goes on the page.
 *
 * ⚠️ It reads the LOCAL library, which lives in this browser — so you can only put up a song
 * from the machine you made it on. The song itself is then copied into the block, which is what
 * makes it work for visitors: the page carries the notes, so it does not matter that the library
 * it came from is on somebody's laptop.
 */
function SongPicker({
  value,
  onChange,
}: {
  value: Record<string, unknown>
  onChange: (config: Record<string, unknown>) => void
}) {
  const items = useSyncExternalStore(subscribeLibrary, library, library)
  const current = songFromConfig(value)
  /**
   * ⚠️ Say so BEFORE the save fails.
   *
   * The server caps a block's config, and a song past that cap came back as "invalid block" —
   * a message about the shape of the data for a problem that is really "this piece is long".
   * Checking here means the answer arrives while you are choosing, not after you press Done.
   */
  const tooBig = JSON.stringify(value.song ?? {}).length > CONFIG_LIMIT
  if (!items.length)
    return (
      <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
        Nothing in your library yet. Make something in the Instrument room and press{' '}
        <strong>Keep song</strong>, then come back.
      </p>
    )
  return (
    <label className="inst-pick" style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
      <span className="muted">Song</span>
      <select
        className="viz-select"
        value={current?.name ?? ''}
        onChange={(e) => {
          const picked = items.find((i: LibraryItem) => i.song.name === e.target.value)
          // ⚠️ the COMPACT form goes into the block — see packSong. The readable one is roughly
          // five times larger and a normal four-layer song does not fit in a profile block at all
          onChange({ ...value, song: picked ? packSong(picked.song) : undefined })
        }}
      >
        <option value="">Pick one…</option>
        {items.map((i: LibraryItem) => (
          <option key={i.id} value={i.song.name}>
            {i.kind === 'loop' ? '🔁' : '🎵'} {i.name}
          </option>
        ))}
      </select>
      {tooBig && (
        <span className="muted" style={{ fontSize: '0.75rem' }}>
          This one is long — it may not fit on a page. Try a shorter take.
        </span>
      )}
    </label>
  )
}

/** Which visualiser a visitor sees, and in which colours. It watches whatever the page plays. */
function VisualPicker({
  value,
  onChange,
}: {
  value: Record<string, unknown>
  onChange: (config: Record<string, unknown>) => void
}) {
  const mode = typeof value.mode === 'string' ? value.mode : 'bars'
  const palette = typeof value.palette === 'string' ? value.palette : 'theme'
  return (
    <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
      <label className="inst-pick" style={{ display: 'flex', gap: '0.4rem' }}>
        <span className="muted">Style</span>
        <select
          className="viz-select"
          value={mode}
          onChange={(e) => onChange({ ...value, mode: e.target.value })}
        >
          {VISUALS.map(([id, icon, label]) => (
            <option key={id} value={id}>
              {icon} {label}
            </option>
          ))}
        </select>
      </label>
      <label className="inst-pick" style={{ display: 'flex', gap: '0.4rem' }}>
        <span className="muted">Colour</span>
        <select
          className="viz-select"
          value={palette}
          onChange={(e) => onChange({ ...value, palette: e.target.value })}
        >
          {PALETTES.map((pal) => (
            <option key={pal.id} value={pal.id}>
              {pal.label}
            </option>
          ))}
        </select>
      </label>
      {/* ⚠️ The same dials the visualiser page has. They were missing, so a visualiser on a
          profile could be any of sixteen shapes in any of eleven colours and then had to look
          exactly as it came — no trails, no kaleidoscope, no glow. Those are the tools that make
          two people's pages look different from each other. */}
      {(
        [
          ['bloom', 'Bloom', 0, 1, 0.01, 0.25],
          ['trail', 'Trails', 0, 0.97, 0.01, 0.5],
          ['punch', 'Punch', 0, 1, 0.01, 0],
          ['echo', 'Echo', 0, 1, 0.01, 0],
        ] as Array<[string, string, number, number, number, number]>
      ).map(([key, label, lo, hi, step, dflt]) => (
        <label key={key} className="appearance-slider" style={{ minWidth: '9rem' }}>
          <span className="muted">{label}</span>
          <input
            type="range"
            min={lo}
            max={hi}
            step={step}
            value={typeof value[key] === 'number' ? (value[key] as number) : dflt}
            onChange={(e) => onChange({ ...value, [key]: Number(e.target.value) })}
          />
          <span className="appearance-slider-val">
            {Math.round((typeof value[key] === 'number' ? (value[key] as number) : dflt) * 100)}
          </span>
        </label>
      ))}
      <label className="inst-pick" style={{ display: 'flex', gap: '0.4rem' }}>
        <span className="muted">Mirror</span>
        <select
          className="viz-select"
          value={typeof value.mirror === 'number' ? value.mirror : 1}
          onChange={(e) => onChange({ ...value, mirror: Number(e.target.value) })}
        >
          {[1, 2, 3, 4, 6, 8].map((n) => (
            <option key={n} value={n}>
              {n === 1 ? 'Off' : n}
            </option>
          ))}
        </select>
      </label>
      <span className="muted" style={{ fontSize: '0.78rem', flexBasis: '100%' }}>
        Moves when a song on this page is playing.
      </span>
    </div>
  )
}

function BlockEditRow({
  block,
  username,
  activity,
  trophies,
  snakeBest,
  open,
  onToggle,
  onChange,
  onRemove,
  onMove,
  isFirst,
  isLast,
}: {
  block: ProfileBlock
  username: string
  /** the same data the reader's page gets, because the preview below IS the reader's page */
  activity: ActivityItem[]
  trophies: ProfileTrophy[]
  snakeBest: { score: number; game_mode: string | null } | null
  open: boolean
  onToggle: () => void
  onChange: (next: ProfileBlock) => void
  onRemove: () => void
  onMove: (dir: -1 | 1) => void
  isFirst: boolean
  isLast: boolean
}) {
  /**
   * Bring the row you just opened into view.
   *
   * The list is long enough that the row you tap can be off-screen entirely by the time it
   * expands — and a control you cannot see is a control that does not work.
   */
  const rowRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const el = rowRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    if (r.top >= 0 && r.top < window.innerHeight * 0.5) return // already comfortably in view
    /**
     * ⚠️ 'auto', not 'smooth'. Smooth scrolling is an animation, and an animation that does not
     * run leaves you exactly where you were — measured here doing nothing at all while 'auto'
     * moved 1260px. Same family as requestAnimationFrame never firing in a hidden tab. This is
     * the fix for "editing doesn't work", so it has to be the version that can be verified,
     * not the prettier one. And it answers a tap, where instant reads as responsive anyway.
     */
    el.scrollIntoView({ block: 'start', behavior: 'auto' })
  }, [open])

  const setCfg = (patch: Record<string, unknown>) =>
    onChange({ ...block, config: { ...block.config, ...patch } })
  const cycleSize = () =>
    onChange({
      ...block,
      size: block.size === 'small' ? 'medium' : block.size === 'medium' ? 'large' : 'small',
    })

  /**
   * Collapsed by default, one open at a time.
   *
   * Every block used to carry its whole toolbar permanently: five controls that measured 113px
   * of chrome per block, 678px across six of them, and 2.5 phone screens to arrange a page.
   * The list was the one thing you could not see. So the header is now the three things you do
   * while SCANNING — move up, move down, remove — and everything you do while EDITING lives
   * inside the block you opened.
   */
  return (
    <div className="card profile-editrow" data-open={open || undefined} ref={rowRef}>
      <div className="profile-editrow-head">
        <button
          type="button"
          className="profile-editrow-toggle"
          aria-expanded={open}
          onClick={onToggle}
        >
          <span className="profile-editrow-caret" aria-hidden>
            {open ? '▾' : '▸'}
          </span>
          <strong>{BLOCK_LABEL[block.block_type]}</strong>
          <span className="muted profile-editrow-sum">{blockSummary(block)}</span>
        </button>
        <span className="profile-editrow-actions">
          <button className="btn" disabled={isFirst} onClick={() => onMove(-1)} title="Move up">
            ↑
          </button>
          <button className="btn" disabled={isLast} onClick={() => onMove(1)} title="Move down">
            ↓
          </button>
          <button className="btn" onClick={onRemove} title="Remove">
            ✕
          </button>
        </span>
      </div>
      {!open ? null : (
        <>
          {block.block_type === 'song' && (
            <SongPicker
              value={block.config}
              onChange={(config) => onChange({ ...block, config })}
            />
          )}

          {block.block_type === 'visualizer' && (
            <VisualPicker
              value={block.config}
              onChange={(config) => onChange({ ...block, config })}
            />
          )}

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
            <label
              className="muted"
              style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}
            >
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
                    className={
                      'profile-mood' + ((block.config.emoji ?? '💭') === m ? ' is-on' : '')
                    }
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
              Friends can leave notes on your page. Whoever this block is visible to can write in it
              — you can remove anything left here.
            </p>
          )}

          {/* Settings, in words. These used to be two nameless controls in the toolbar: a button
              that said "medium" and a dropdown that said "Friends", neither of which told you
              what it was for. They are used once per block, so they belong down here with a
              label rather than up there taking the room the block's own name needed. */}
          <div className="profile-editrow-settings">
            <label>
              <span className="muted">Who can see this</span>
              <select
                className="btn"
                value={block.visibility}
                onChange={(e) => onChange({ ...block, visibility: e.target.value as Tier })}
              >
                {(Object.keys(TIER_LABEL) as Tier[]).map((t) => (
                  <option key={t} value={t}>
                    {TIER_LABEL[t]}
                  </option>
                ))}
              </select>
            </label>
            {/* Hidden on a phone: every width renders as one full-width column there (see
                .profile-block under the 700px breakpoint), so the control provably does nothing
                on the device you'd be tapping it with.
                Named by what they DO, because "small / medium / large" described nothing you
                could see — and until today two of them were the same rule. */}
            <label className="profile-editrow-size">
              <span className="muted">Width on a wide screen</span>
              <button className="btn" onClick={cycleSize} title="Cycle width">
                {block.size === 'small'
                  ? 'one column'
                  : block.size === 'medium'
                    ? 'two columns'
                    : 'full width'}
              </button>
            </label>
          </div>
        </>
      )}

      {/**
       * The block as a reader sees it — same component, same props.
       *
       * ⚠️ BELOW the controls, not above them. It used to sit between the header and the editor,
       * which put the controls 152px further down: on a phone you tapped a block and NOTHING
       * VISIBLY CHANGED, because everything that opened was below the fold. That reads as
       * "editing doesn't work, I can only add blocks and rearrange", which is exactly what it
       * was reported as.
       *
       * Underneath is the better place regardless: you change a setting and watch the result
       * move directly beneath your finger.
       */}
      <div className="profile-editrow-preview">
        {open && (
          <div className="muted profile-editrow-previewlabel">How it looks on your page</div>
        )}
        {isBlockEmpty(block) ? (
          <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
            Nothing in this one yet — {open ? 'fill it in above' : 'tap to fill it in'}.
          </p>
        ) : (
          <BlockView
            block={block}
            activity={activity}
            trophies={trophies}
            snakeBest={snakeBest}
            username={username}
            isMe
          />
        )}
      </div>
    </div>
  )
}

/** The "arrange your page" panel — owner only, shown behind an Edit toggle in Profile.tsx. */
export function ProfileBlocksEditor({
  initial,
  username,
  activity,
  trophies,
  snakeBest,
  onSaved,
}: {
  initial: ProfileBlock[]
  username: string
  /** passed straight through to the previews, so editing shows the page and not a description */
  activity: ActivityItem[]
  trophies: ProfileTrophy[]
  snakeBest: { score: number; game_mode: string | null } | null
  onSaved: (blocks: ProfileBlock[]) => void
}) {
  const [blocks, setBlocks] = useState<ProfileBlock[]>(initial)
  const [err, setErr] = useState<string | null>(null)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  /** the block you just removed, and the list it came from, so it can come straight back */
  const [undo, setUndo] = useState<{ blocks: ProfileBlock[]; label: string } | null>(null)
  /** which block is open for editing; null means the list is a list. One at a time. */
  const [openIdx, setOpenIdx] = useState<number | null>(null)
  /** the add-a-block palette, which is seven buttons you are mostly not pressing */
  const [adding, setAdding] = useState(false)

  const addBlock = (type: ProfileBlock['block_type']) => {
    // Straight into editing it: you added a block because you have something to put in it.
    setOpenIdx(blocks.length)
    setAdding(false)
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
  }
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= blocks.length) return
    // The open block travels with its content. Rows are keyed by position, so without this
    // moving a block would leave the panel open on whatever swapped into its old slot.
    setOpenIdx((cur) => (cur === i ? j : cur === j ? i : cur))
    setBlocks((b) => {
      const next = [...b]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }
  /**
   * Removing is the one thing here that can lose work, and it now persists on its own — so it
   * is the one thing that keeps an explicit way back rather than an explicit way forward.
   */
  const removeAt = (i: number) => {
    const gone = blocks[i]
    setUndo({ blocks, label: BLOCK_LABEL[gone.block_type] })
    setOpenIdx((cur) => (cur === i ? null : cur != null && cur > i ? cur - 1 : cur))
    setBlocks((all) => all.filter((_, idx) => idx !== i))
  }
  const undoRemove = () => {
    if (!undo) return
    setBlocks(undo.blocks)
    setUndo(null)
  }

  /**
   * It saves itself.
   *
   * There was a Save button at the very bottom of the panel — and on a phone the panel was
   * 2011px tall with seven "+ block" buttons above it, so you typed a bio at the top and never
   * reached the thing that kept it. "My bio isn't saving" was the button being unreachable,
   * not the save being broken.
   *
   * Debounced rather than per-keystroke: 700ms also coalesces a hue slider drag, which would
   * otherwise post a couple of hundred times.
   */
  const payloadOf = (list: ProfileBlock[]) =>
    list.map(({ block_type, size, config, visibility }) => ({
      block_type,
      size,
      config,
      visibility,
    }))

  /**
   * ⚠️ Compares VALUES, not "have I run yet".
   *
   * StrictMode double-invokes effects, so a boolean first-run guard is defeated — and here the
   * cost of getting it wrong is a write. Holding the JSON of what is actually stored means the
   * second invocation sees no difference and does nothing, and so does a re-render that changed
   * something other than the blocks.
   */
  const savedJsonRef = useRef(JSON.stringify(payloadOf(initial)))
  /** the newest unsaved payload, for the unmount flush below */
  const pendingRef = useRef<{
    json: string
    payload: ReturnType<typeof payloadOf>
    blocks: ProfileBlock[]
  } | null>(null)
  const onSavedRef = useRef(onSaved)
  useEffect(() => {
    onSavedRef.current = onSaved
  }, [onSaved])

  useEffect(() => {
    const payload = payloadOf(blocks)
    const json = JSON.stringify(payload)
    if (json === savedJsonRef.current) return
    pendingRef.current = { json, payload, blocks }
    const t = window.setTimeout(() => {
      setStatus('saving')
      void getSupabaseClient()
        .rpc('save_my_profile_blocks', { p_blocks: payload })
        .then(({ error }) => {
          if (error) {
            setErr(error.message)
            setStatus('idle')
            return
          }
          savedJsonRef.current = json
          pendingRef.current = null
          setErr(null)
          setStatus('saved')
          onSavedRef.current(blocks)
        })
    }, 700)
    return () => window.clearTimeout(t)
  }, [blocks])

  /**
   * Leaving mid-debounce must not lose the last thing you typed.
   *
   * Tapping "Done editing" unmounts this, which clears the timer above — reintroducing exactly
   * the bug being fixed for anyone who types and leaves inside 700ms. Fire-and-forget, because
   * cleanup cannot await.
   */
  useEffect(
    () => () => {
      const p = pendingRef.current
      if (!p || p.json === savedJsonRef.current) return
      void getSupabaseClient()
        .rpc('save_my_profile_blocks', { p_blocks: p.payload })
        .then(({ error }) => {
          // The PARENT is still mounted — only the editor went away — so telling it what landed
          // is both safe and necessary: without this, typing and immediately tapping "Done
          // editing" stored the new text and then showed you the old one until a reload.
          if (!error) onSavedRef.current(p.blocks)
        })
    },
    [],
  )

  return (
    <div className="card profile-editor" data-username={username}>
      <h3 style={{ marginTop: 0 }}>Your page</h3>
      <p className="muted" style={{ margin: '0 0 0.75rem', fontSize: '0.82rem' }}>
        This is what people see, in order. Tap a block to change it.
      </p>
      <div style={{ display: 'grid', gap: '0.5rem' }}>
        {blocks.map((b, i) => (
          <BlockEditRow
            key={i}
            block={b}
            username={username}
            activity={activity}
            trophies={trophies}
            snakeBest={snakeBest}
            open={openIdx === i}
            onToggle={() => setOpenIdx((cur) => (cur === i ? null : i))}
            onChange={(next) => setBlocks((all) => all.map((x, idx) => (idx === i ? next : x)))}
            onRemove={() => removeAt(i)}
            onMove={(dir) => move(i, dir)}
            isFirst={i === 0}
            isLast={i === blocks.length - 1}
          />
        ))}
      </div>
      {/* Seven "+ block" buttons sat here permanently, 192px of a phone screen spent on things
          you are not adding. Behind one word now. */}
      <div className="profile-editor-add">
        {adding ? (
          <>
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
            <button className="btn btn-ghost" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </>
        ) : (
          <button
            className="btn"
            onClick={() => setAdding(true)}
            disabled={blocks.length >= 20}
            aria-expanded={false}
          >
            + Add a block
          </button>
        )}
      </div>
      {/* Where the Save button was. It says what happened instead of asking you to make it
          happen — and carries the one undo, because removing a block is the only action here
          that can lose something. */}
      <div className="profile-editor-status" aria-live="polite">
        <span className={err ? 'profile-editor-err' : 'muted'}>
          {err
            ? `Couldn’t save — ${err}`
            : status === 'saving'
              ? 'Saving…'
              : status === 'saved'
                ? 'Saved ✓'
                : 'Changes save themselves.'}
        </span>
        {undo && (
          <button className="btn btn-ghost" onClick={undoRemove}>
            Undo removing {undo.label}
          </button>
        )}
      </div>
    </div>
  )
}
