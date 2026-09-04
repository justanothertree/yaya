import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { getSupabaseClient } from '../finance/client'
import { useTouchOnly } from '../ui/pointerKind'
import { BANNER_STYLES, bannerBackground, type BannerStyle } from '../profile/look'
import { SongBlock, VisualBlock } from '../profile/ProfileMusic'
import { songFromConfig } from '../profile/songBlockConfig'
import { packSong } from '../audio/songFile'
import { ArtBlock } from '../profile/ProfileArt'
import { gallery, subscribeGallery, type Art } from '../draw/gallery'
import { packDrawing, readDrawing } from '../draw/strokes'
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
    | 'art'
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

/**
 * How big the server will think this block's config is.
 *
 * ⚠️ THE WHOLE CONFIG, because that is what `length(e->>'config')` measures on the other end. The
 * two pickers each measured only their own field — the song, or the chosen drawings — so both
 * under-reported, and a block could be shown as using 62% of its room while the config it would
 * actually send was over the cap. The save then failed with "invalid block", a message about the
 * SHAPE of the data for a problem that is really "this is too long".
 */
/**
 * Postgres writes jsonb back with a space after every `:` and every `,`; JSON.stringify does not.
 *
 * ⚠️ THIS IS NOT A ROUNDING ERROR ON A PACKED DRAWING. A drawing is thousands of
 * comma-separated numbers, so it is very nearly one extra character per number — measured at 25.6%
 * on a twelve-stroke drawing, which means a config the meter showed as 15,999 of 16,000 arrives as
 * about 20,100 and is refused. The error is 'invalid block', a message about the SHAPE of the data
 * for a problem that is really "this is too long", which is the worst possible way to be told.
 *
 * Counted from the VALUE rather than by scanning the text, so a comma inside a string is not
 * mistaken for a separator. Verified exact against Postgres on a sample containing both.
 */
const separators = (v: unknown): number => {
  if (Array.isArray(v)) return Math.max(0, v.length - 1) + v.reduce((n, x) => n + separators(x), 0)
  if (v && typeof v === 'object') {
    const keys = Object.keys(v as object)
    return (
      Math.max(0, keys.length - 1) +
      keys.length +
      keys.reduce((n, k) => n + separators((v as Record<string, unknown>)[k]), 0)
    )
  }
  return 0
}

const configSize = (config: Record<string, unknown>) => {
  const c = config ?? {}
  return JSON.stringify(c).length + separators(c)
}

/**
 * Block types the SERVER may not accept yet.
 *
 * ⚠️ save_my_profile_blocks keeps its own allowlist and rejects the WHOLE payload if any block is
 * not on it — so one unknown block type does not fail to save itself, it stops the page saving at
 * all. Anyone who added an Art block therefore lost every edit they made afterwards, and all they
 * were told was "invalid block".
 *
 * Listing it here does not fix the save; the one-time SQL in
 * docs/2026-09-02-site-content-and-art-block.sql does that. What this does is turn a dead end into
 * something you can act on, and it stops being used the moment the server accepts the type — no
 * second edit needed here, because the error it keys off simply stops happening.
 */
const NEEDS_SERVER_SUPPORT: Array<ProfileBlock['block_type']> = ['art']

/**
 * Does this block get a line to itself?
 *
 * ⚠️ Stored in the block's own config rather than as a column on the row, because config is
 * free-form jsonb the server already accepts and a new field would otherwise mean another
 * migration to run before anything could be tried. Readers of each block type ignore keys they
 * do not know, so it costs nothing to carry.
 */
const blockAlone = (b: ProfileBlock) => b.config?.alone === true

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
  art: '🖼 Art',
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
      return (
        <SongBlock
          id={block.id ?? `song-${song.name}`}
          song={song}
          autoplay={cfg.autoplay === true}
        />
      )
    }
    case 'visualizer':
      return <VisualBlock cfg={cfg} />
    /* ⚠️ Strokes, not an image — the visitor's browser draws it. See ProfileArt. */
    case 'art':
      return <ArtBlock cfg={cfg} />
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
        /**
         * ⚠️ WRAPPED, exactly as the editor wraps. Blocks used to be the grid items themselves,
         * which meant every block type had to remember to put its own size class on — and the
         * song, art and visualiser blocks did not, so their width setting was quietly ignored.
         * One wrapper carries the span for all of them, the two views finally agree, and there is
         * a single place for a block that wants the line to itself.
         */
        <div
          key={b.id ?? i}
          className={'profile-slot is-' + b.size + (blockAlone(b) ? ' is-alone' : '')}
        >
          <BlockView
            block={b}
            activity={activity}
            trophies={trophies}
            snakeBest={snakeBest}
            username={username}
            isMe={isMe}
          />
        </div>
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

/** A block with nothing in it yet, so the canvas can say so instead of drawing a blank card. */
function isBlockEmpty(block: ProfileBlock): boolean {
  const txt = typeof block.config.text === 'string' ? block.config.text.trim() : ''
  if (block.block_type === 'bio') return !txt
  if (block.block_type === 'status') return !txt
  if (block.block_type === 'song') return !songFromConfig(block.config)
  if (block.block_type === 'art')
    return !(Array.isArray(block.config.art) && block.config.art.length)
  return false
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
  const tooBig = configSize(value) > CONFIG_LIMIT
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
      {/**
       * ⚠️ The label says "as soon as they let it", not "on load", because that is the truth. A
       * browser refuses sound until the visitor has interacted with the page, so this can only
       * mean "at the first moment it is allowed". Promising more would leave a setting that
       * appears to work on some visits and not others, with nothing to tell them apart.
       */}
      <label className="profile-song-auto">
        <input
          type="checkbox"
          checked={value.autoplay === true}
          onChange={(e) => onChange({ ...value, autoplay: e.target.checked || undefined })}
        />
        <span className="muted">Start playing as soon as the browser allows it</span>
      </label>
    </label>
  )
}

/**
 * Choosing which of your drawings go on the page, and whether they shuffle.
 *
 * ⚠️ The PACKED form goes into the block, and the running total is measured against the same
 * limit the server enforces. Several pictures in one block is exactly where a config gets big, so
 * what you can add is bounded by real size rather than by a guessed number of items — a few
 * simple doodles fit where two dense ones do not, and the line underneath says which case you are
 * in before a save can fail.
 */
function ArtPicker({
  value,
  onChange,
}: {
  value: Record<string, unknown>
  onChange: (config: Record<string, unknown>) => void
}) {
  const items = useSyncExternalStore(subscribeGallery, gallery, gallery)
  const chosen = Array.isArray(value.art) ? value.art : []
  /* the config as it would be SENT, not just the pictures in it — see configSize */
  const used = configSize({ ...value, art: chosen })
  const names = chosen.map((a) => readDrawing(a)?.name ?? '?')

  if (!items.length)
    return (
      <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
        Nothing in your gallery yet. Draw something in the Paint room and press{' '}
        <strong>Keep</strong>, then come back.
      </p>
    )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <div className="fx-style-row">
        {items.map((a: Art) => {
          const on = names.includes(a.name)
          return (
            <button
              key={a.id}
              className={'fx-style-btn' + (on ? ' is-on' : '')}
              aria-pressed={on}
              onClick={() =>
                onChange({
                  ...value,
                  art: on
                    ? chosen.filter((c) => readDrawing(c)?.name !== a.name)
                    : [...chosen, packDrawing(a.art)],
                })
              }
            >
              <span aria-hidden>🖼</span>
              <span className="fx-style-label">{a.name}</span>
            </button>
          )
        })}
      </div>
      <label className="inst-pick" style={{ display: 'flex', gap: '0.4rem' }}>
        <input
          type="checkbox"
          checked={value.shuffle !== false}
          onChange={(e) => onChange({ ...value, shuffle: e.target.checked })}
        />
        <span className="muted">Shuffle through them</span>
      </label>
      <span className="muted" style={{ fontSize: '0.75rem' }}>
        {chosen.length} chosen{' '}
        {used > CONFIG_LIMIT
          ? '— too much for one block, take one out'
          : `· ${Math.round((used / CONFIG_LIMIT) * 100)}% of the room a block has`}
      </span>
    </div>
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

/**
 * The fields for ONE block's content — no chrome, no preview, no toolbar.
 *
 * ⚠️ Pulled out of the old row so the same fields can sit in an inspector beside a live page, and
 * later beside a different page altogether. What a bio needs is a text box wherever it is being
 * edited; the surrounding arrangement is not its business.
 */
function BlockFields({
  block,
  username,
  onChange,
}: {
  block: ProfileBlock
  username: string
  onChange: (next: ProfileBlock) => void
}) {
  const setCfg = (patch: Record<string, unknown>) =>
    onChange({ ...block, config: { ...block.config, ...patch } })

  switch (block.block_type) {
    case 'song':
      return (
        <SongPicker value={block.config} onChange={(config) => onChange({ ...block, config })} />
      )
    case 'art':
      return (
        <ArtPicker value={block.config} onChange={(config) => onChange({ ...block, config })} />
      )
    case 'visualizer':
      return (
        <VisualPicker value={block.config} onChange={(config) => onChange({ ...block, config })} />
      )
    case 'bio':
      return (
        <textarea
          className="profile-editrow-textarea"
          placeholder="Say something about yourself…"
          value={typeof block.config.text === 'string' ? block.config.text : ''}
          onChange={(e) => setCfg({ text: e.target.value.slice(0, 2000) })}
          rows={4}
        />
      )
    case 'banner':
      return <BannerPicker config={block.config} username={username} onChange={setCfg} />
    case 'activity':
      return (
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
      )
    case 'status':
      return (
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
      )
    case 'stats':
      return (
        <p className="muted" style={{ margin: 0 }}>
          Fills in automatically from your Snake results — nothing to set here.
        </p>
      )
    case 'trophies':
      return (
        <p className="muted" style={{ margin: 0 }}>
          Fills in from the Snake rounds you&apos;ve won — nothing to set here.
        </p>
      )
    case 'guestbook':
      return (
        <p className="muted" style={{ margin: 0 }}>
          Friends can leave notes on your page. Whoever this block is visible to can write in it —
          you can remove anything left here.
        </p>
      )
    default:
      return null
  }
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
  /** the block type the server refused, so the rest of the page can still be saved without it */
  const [blocked, setBlocked] = useState<ProfileBlock['block_type'] | null>(null)
  /** which block is selected; its fields appear underneath the page rather than inside it */
  const [openIdx, setOpenIdx] = useState<number | null>(null)
  /**
   * ⚠️ THE BLOCK THAT HAS BEEN PICKED UP, waiting to be put down.
   *
   * Dragging was the only way to reorder, and it was unreliable in exactly the way pointer
   * dragging always is on a touchscreen: the browser wants to scroll, the block wants to move,
   * and whichever wins is a coin toss you have to lose a few times to learn. Tap to lift, tap to
   * place is one gesture, identical on a phone and a mouse, and it cannot be interrupted by a
   * scroll because it is not a gesture that lasts.
   */
  const [liftIdx, setLiftIdx] = useState<number | null>(null)
  /* dragging is offered to a pointer and not to a finger — see the grip below */
  const touch = useTouchOnly()
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
  /** drop `from` into `to`, closing the gap it leaves — the reorder a drag performs */
  const moveTo = (from: number, to: number) => {
    if (from === to || to < 0 || to >= blocks.length) return
    setOpenIdx(to)
    setBlocks((b) => {
      const next = [...b]
      const [taken] = next.splice(from, 1)
      next.splice(to, 0, taken)
      return next
    })
  }
  const setAloneAt = (i: number, alone: boolean) =>
    setBlocks((all) =>
      all.map((x, idx) =>
        idx === i ? { ...x, config: { ...x.config, alone: alone || undefined } } : x,
      ),
    )

  const setSizeAt = (i: number, size: ProfileBlock['size']) =>
    setBlocks((all) => all.map((x, idx) => (idx === i ? { ...x, size } : x)))

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

    /**
     * ⚠️ Caught HERE rather than by the server, because the server's answer for this is the same
     * "invalid block" it gives for an unknown type — and it refuses the entire payload, so one
     * over-long block stops the whole page saving. Checking first names the block, keeps the rest
     * of the page saveable the moment it is fixed, and spares a request that cannot succeed.
     */
    const overSized = blocks.find((b) => configSize(b.config) > CONFIG_LIMIT)
    if (overSized) {
      setBlocked(null)
      setErr(
        `the ${BLOCK_LABEL[overSized.block_type]} block holds too much — take something out of it`,
      )
      setStatus('idle')
      return
    }

    /**
     * ⚠️ Back in step with the server means there is nothing WRONG any more, so the warning has
     * to go with it. Taking out a block the server refused returns the page to exactly what was
     * last saved — so no save is needed, none runs, and without this the failure message from the
     * attempt before it stayed on screen accusing a page that is now perfectly fine. Measured:
     * one save attempted, one error shown, and the error still there afterwards.
     */
    if (json === savedJsonRef.current) {
      setErr(null)
      setBlocked(null)
      setStatus('idle')
      return
    }
    pendingRef.current = { json, payload, blocks }
    const t = window.setTimeout(() => {
      setStatus('saving')
      void getSupabaseClient()
        .rpc('save_my_profile_blocks', { p_blocks: payload })
        .then(({ error }) => {
          if (error) {
            /* name the block that did it, rather than repeating the server's one-word refusal */
            const culprit = /invalid block/i.test(error.message)
              ? (blocks.find((b) => NEEDS_SERVER_SUPPORT.includes(b.block_type))?.block_type ??
                null)
              : null
            setBlocked(culprit)
            setErr(
              culprit
                ? `the ${BLOCK_LABEL[culprit]} block needs a one-time database change that hasn’t been applied yet`
                : error.message,
            )
            setStatus('idle')
            return
          }
          setBlocked(null)
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

  const selected = openIdx != null ? blocks[openIdx] : null

  /**
   * Dragging a block to a new place.
   *
   * ⚠️ pointer events and elementFromPoint, not the HTML drag-and-drop API. That API does
   * not fire on touch at all, and rearranging your own page on a phone is exactly the case this
   * is for.
   *
   * ⚠️ from a HANDLE, not from the block. The block itself is a click target — it selects,
   * so its fields appear — and a surface that both selects on click and moves on drag turns
   * every imprecise tap into a small accident.
   */

  return (
    <div className="card profile-editor" data-username={username}>
      <div className="profile-editor-head">
        <h3>Your page</h3>
        <p className="muted">
          This is the page itself, at the widths it really uses. Click a block to change what is in
          it, drag the handle to move it.
        </p>
      </div>

      {/**
       * ⚠️ THE EDITOR IS THE PAGE.
       *
       * It was a vertical list of rows with up and down arrows, while the page it produced was a
       * six-column grid — so width was a word in a dropdown, position was an arrow press, and the
       * arrangement being made could not be seen until you left. That gap is the whole reason a
       * profile felt thrown together: there was nothing to compose ON. Same grid, same blocks, and
       * the same components a visitor is served.
       */}
      <div
        className="profile-blocks-grid profile-canvas"
        onPointerDown={(e) => {
          // a press on the gaps between blocks puts the inspector away
          if ((e.target as HTMLElement).closest('[data-cell]')) return
          setOpenIdx(null)
          setLiftIdx(null)
        }}
      >
        {blocks.map((b, i) => (
          <div
            key={i}
            data-cell={i}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes('text/block')) e.preventDefault()
            }}
            onDrop={(e) => {
              e.preventDefault()
              const from = Number(e.dataTransfer.getData('text/block'))
              if (Number.isInteger(from) && from !== i) moveTo(from, i)
              setLiftIdx(null)
            }}
            className={
              'profile-canvas-cell is-' +
              b.size +
              (openIdx === i ? ' is-selected' : '') +
              (liftIdx === i ? ' is-lifted' : '') +
              (blockAlone(b) ? ' is-alone' : '') +
              (liftIdx != null && liftIdx !== i ? ' is-drop' : '')
            }
          >
            <button
              type="button"
              className="profile-canvas-pick"
              aria-pressed={openIdx === i}
              aria-label={'Edit ' + BLOCK_LABEL[b.block_type]}
              onClick={() => {
                /* holding something? this is where it goes. Otherwise open it as before. */
                if (liftIdx != null && liftIdx !== i) {
                  moveTo(liftIdx, i)
                  setLiftIdx(null)
                  return
                }
                setLiftIdx(null)
                setOpenIdx((cur) => (cur === i ? null : i))
              }}
            />
            <span className="profile-canvas-tag">{BLOCK_LABEL[b.block_type]}</span>
            {/**
             * ⚠️ THE COMMON ACTIONS LIVE ON THE BLOCK, not in a panel somewhere else.
             *
             * Width and delete were at the bottom of the page, describing a block that was up
             * here — so every small change was a journey, and on a phone the panel and the thing
             * it described were never on screen together. These three are the ones reached most
             * and they need no room to explain themselves. Anything with more to say than a
             * button — the text of a bio, which drawings a gallery shows — is still the panel's
             * job.
             */}
            {openIdx === i && (
              <span className="profile-canvas-tools">
                <button
                  className="btn"
                  title="A third of the width"
                  aria-pressed={b.size === 'small'}
                  onClick={() => setSizeAt(i, 'small')}
                >
                  ▮
                </button>
                <button
                  className="btn"
                  title="Half the width"
                  aria-pressed={b.size === 'medium'}
                  onClick={() => setSizeAt(i, 'medium')}
                >
                  ▮▮
                </button>
                <button
                  className="btn"
                  title="The whole width"
                  aria-pressed={b.size === 'large'}
                  onClick={() => setSizeAt(i, 'large')}
                >
                  ▮▮▮
                </button>
                <button
                  className={'btn' + (blockAlone(b) ? ' is-on' : '')}
                  aria-pressed={blockAlone(b)}
                  title={
                    blockAlone(b)
                      ? 'Sharing its line with other blocks again'
                      : 'Give this block a line of its own, centred, with nothing beside it'
                  }
                  onClick={() => setAloneAt(i, !blockAlone(b))}
                >
                  ⇔
                </button>
                <button
                  className="btn btn-ghost"
                  title={'Remove this ' + BLOCK_LABEL[b.block_type]}
                  onClick={() => removeAt(i)}
                >
                  ✕
                </button>
              </span>
            )}
            <span
              className={'profile-canvas-grip' + (liftIdx === i ? ' is-holding' : '')}
              role="button"
              tabIndex={0}
              aria-label={'Move ' + BLOCK_LABEL[b.block_type]}
              /**
               * ⚠️ BOTH WAYS, and neither is the pointer-drag that was here before.
               *
               * Tap to lift is the reliable one and the only one a finger gets. But the handle
               * still LOOKS like something you drag, so people drag it — and when I replaced the
               * mechanism without replacing the affordance, the honest report was "drag and drop
               * doesn't work". HTML5 drag costs almost nothing here, is solid on a desktop, and
               * never starts under a finger, so it restores the muscle memory without bringing
               * back the flakiness that made pointer-dragging worth removing.
               */
              draggable={!touch}
              onDragStart={(e) => {
                e.dataTransfer.setData('text/block', String(i))
                e.dataTransfer.effectAllowed = 'move'
                setLiftIdx(i)
                setOpenIdx(i)
              }}
              onDragEnd={() => setLiftIdx(null)}
              title={
                liftIdx === i
                  ? 'Now tap where it should go'
                  : touch
                    ? 'Tap to pick this up, then tap where it should go'
                    : 'Drag me, or tap to pick up and tap where it should go'
              }
              onClick={(e) => {
                e.stopPropagation()
                setLiftIdx((cur) => (cur === i ? null : i))
                setOpenIdx(i)
              }}
              onKeyDown={(e) => {
                /* ⚠️ the arrow keys page between sections of this site, so they are stopped
                   here as well as prevented — the visualiser's pin hit the same trap */
                if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
                e.preventDefault()
                e.stopPropagation()
                move(i, e.key === 'ArrowLeft' ? -1 : 1)
              }}
            >
              ⠿
            </span>
            {isBlockEmpty(b) ? (
              <div className="profile-block profile-canvas-empty">
                <strong>{BLOCK_LABEL[b.block_type]}</strong>
                <span className="muted">Nothing in this one yet — click to fill it in.</span>
              </div>
            ) : (
              <BlockView
                block={b}
                activity={activity}
                trophies={trophies}
                snakeBest={snakeBest}
                username={username}
                isMe
              />
            )}
          </div>
        ))}

        {/* the add tile sits IN the grid, in the place a new block would appear */}
        <div className="profile-canvas-cell is-small profile-canvas-add">
          <button
            className="btn"
            onClick={() => setAdding((v) => !v)}
            disabled={blocks.length >= 20}
            aria-expanded={adding}
          >
            + Add a block
          </button>
        </div>
      </div>

      {adding && (
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
          <button className="btn btn-ghost" onClick={() => setAdding(false)}>
            Cancel
          </button>
        </div>
      )}

      {liftIdx != null && (
        /* ⚠️ a mode needs saying out loud. Something is held, every other block is a place to put
           it, and there is no way to tell that from the blocks alone. */
        <p className="profile-lift-hint">
          Holding <strong>{BLOCK_LABEL[blocks[liftIdx]?.block_type] ?? 'a block'}</strong> — tap
          another block to swap them
          <button className="btn btn-ghost" onClick={() => setLiftIdx(null)}>
            Cancel
          </button>
        </p>
      )}

      {/**
       * The inspector: everything about the ONE block you picked.
       *
       * ⚠️ underneath the page rather than inside the block. A panel that opens inside the
       * grid pushes every other block somewhere else, so you would be editing a layout that moves
       * while you edit it.
       */}
      {selected &&
        openIdx != null &&
        /**
         * ⚠️ THROUGH A PORTAL, and that is what makes `position: fixed` mean the viewport.
         *
         * A transformed ancestor becomes the containing block for anything fixed inside it — and
         * this editor lives in a `.card`, which grows a transform on hover. So the panel was
         * anchored to the card rather than to the screen, and drifted as the card lifted under
         * the pointer. No amount of correcting the offsets fixes that; the panel has to leave the
         * subtree. Portalling to the body puts it beyond the reach of any ancestor's transform,
         * filter or containment, now or later.
         */
        createPortal(
          <div className="profile-inspector">
            <div className="profile-inspector-head">
              <strong>{BLOCK_LABEL[selected.block_type]}</strong>
              <button
                className="btn btn-ghost"
                onClick={() => setOpenIdx(null)}
                aria-label="Close this block"
              >
                Done
              </button>
            </div>

            <BlockFields
              block={selected}
              username={username}
              onChange={(next) =>
                setBlocks((all) => all.map((x, idx) => (idx === openIdx ? next : x)))
              }
            />

            <div className="profile-editrow-settings">
              {/* ⚠️ three buttons rather than one that cycles. A cycling button cannot show
                which of the three you are on without being read, and cannot go back a step. */}
              <label className="profile-editrow-size">
                <span className="muted">Width of the page</span>
                <span className="profile-width-row">
                  {(['small', 'medium', 'large'] as const).map((sz) => (
                    <button
                      key={sz}
                      className={'btn' + (selected.size === sz ? ' is-on' : '')}
                      aria-pressed={selected.size === sz}
                      onClick={() =>
                        setBlocks((all) =>
                          all.map((x, idx) => (idx === openIdx ? { ...x, size: sz } : x)),
                        )
                      }
                    >
                      {sz === 'small' ? 'a third' : sz === 'medium' ? 'a half' : 'full width'}
                    </button>
                  ))}
                </span>
              </label>
              <label>
                <span className="muted">Who can see this</span>
                <select
                  className="btn"
                  value={selected.visibility}
                  onChange={(e) =>
                    setBlocks((all) =>
                      all.map((x, idx) =>
                        idx === openIdx ? { ...x, visibility: e.target.value as Tier } : x,
                      ),
                    )
                  }
                >
                  {(Object.keys(TIER_LABEL) as Tier[]).map((t) => (
                    <option key={t} value={t}>
                      {TIER_LABEL[t]}
                    </option>
                  ))}
                </select>
              </label>
              <button className="btn btn-ghost" onClick={() => removeAt(openIdx)}>
                Remove this block
              </button>
            </div>
          </div>,
          document.body,
        )}

      <div className="profile-editor-status" aria-live="polite">
        <span className={err ? 'profile-editor-err' : 'muted'}>
          {err
            ? 'Couldn\u2019t save \u2014 ' + err
            : status === 'saving'
              ? 'Saving\u2026'
              : status === 'saved'
                ? 'Saved \u2713'
                : 'Changes save themselves.'}
        </span>
        {blocked && (
          <button
            className="btn"
            onClick={() => {
              setBlocks((all) => all.filter((b) => b.block_type !== blocked))
              setOpenIdx(null)
              setBlocked(null)
            }}
          >
            Take the {BLOCK_LABEL[blocked]} block out and save the rest
          </button>
        )}
        {undo && (
          <button className="btn btn-ghost" onClick={undoRemove}>
            Undo removing {undo.label}
          </button>
        )}
      </div>
    </div>
  )
}
