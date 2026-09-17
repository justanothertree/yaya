import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  applyLookNow,
  canApplyLook,
  myLooks,
  readLook,
  subscribeLooks,
  type Look,
} from '../ui/looks'
import { createPortal } from 'react-dom'
import { getSupabaseClient } from '../finance/client'
import { useTouchOnly } from '../ui/pointerKind'
import {
  BANNER_STYLES,
  BLOCK_EDGES,
  BLOCK_FINISHES,
  BLOCK_FONTS,
  BLOCK_SHAPES,
  BLOCK_TILTS,
  TEXT_ALIGNS,
  TEXT_SIZES,
  blockBackdrop,
  blockEdge,
  blockFont,
  blockHeading,
  blockKeepEmpty,
  blockShape,
  blockTilt,
  textAlign,
  tierSees,
  pageStyleAttrs,
  PAGE_WIDTHS,
  PAGE_GAPS,
  readPageStyle,
  surpriseMe,
  type PageWidth,
  type PageGap,
  textSize,
  textStyle,
  TINT_HUES,
  bannerBackground,
  hueFor,
  blockLook,
  blockLookAttrs,
  tintName,
  type BannerStyle,
} from '../profile/look'
import { SongBlock, VisualBlock } from '../profile/ProfileMusic'
import {
  applyLookPreset,
  looksFromConfig,
  setLook,
  songFromConfig,
  songsFromConfig,
} from '../profile/songBlockConfig'
import { readPresets } from '../audio/vizPresets'

import { packSong } from '../audio/songFile'
import { ArtBlock } from '../profile/ProfileArt'
import { CONFIG_LIMIT, PROFILE_LIMIT, configSize } from '../profile/blockSize'
import { PetBlock, PetPicker } from '../pets/PetBlock'
import { gallery, subscribeGallery, type Art } from '../draw/gallery'
import { frameCount, packDrawing, readDrawing } from '../draw/strokes'
import { library, subscribeLibrary, type LibraryItem } from '../audio/library'
import { ART_STYLES, VISUALS } from '../audio/visualModes'
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

/**
 * One achievement, earned or not, as the server derives it.
 *
 * ⚠️ `goal` and `have` rather than a boolean, because the locked ones are the point. An
 * achievement you cannot see is a surprise, not a goal — and "3/25" is what makes the earned
 * ones mean something.
 */
export type Achievement = {
  module: string
  code: string
  label: string
  note: string
  goal: number
  have: number
}

/** one glyph per module, so an achievement says where it came from without spelling it out */
const MODULE_ICON: Record<string, string> = {
  circuit: '🏆',
  snake: '🎮',
  reviewer: '⭐',
  profile: '🪪',
  paint: '🎨',
  instrument: '🎹',
  visual: '🎚️',
}

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
    | 'pet'
    | 'looks'
    | 'free'
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
const NEEDS_SERVER_SUPPORT: Array<ProfileBlock['block_type']> = ['art', 'looks', 'pet']

/**
 * Does this block get a line to itself?
 *
 * ⚠️ Stored in the block's own config rather than as a column on the row, because config is
 * free-form jsonb the server already accepts and a new field would otherwise mean another
 * migration to run before anything could be tried. Readers of each block type ignore keys they
 * do not know, so it costs nothing to carry.
 */
const blockAlone = (b: ProfileBlock) => b.config?.alone === true

/**
 * The block types that print a heading, and so can be given a different one.
 *
 * ⚠️ Not every type has one. A bio is its text, a banner is a picture, a song is a player —
 * offering a heading field for those would be a control that types into nothing.
 */
/** Blocks whose content is a run of words somebody typed, and so can be set in type. */
/**
 * The keys that are a block's LOOK, as opposed to its content or its place on the page.
 *
 * ⚠️ THE LINE HAS TO BE DRAWN SOMEWHERE AND THIS IS WHERE. A heading and the text are what
 * the block SAYS; a section, a width and ⇔ are where it SITS; everything here is how it appears,
 * and appearance is the only one of the three you would ever want to move between two blocks that
 * say different things in different places. Copying a width along with a colour would make the
 * second block change size, which is not what anybody means by "make it look like that one".
 */
const LOOK_KEYS = [
  'font',
  'shape',
  'edge',
  'tint',
  'finish',
  'textSize',
  'align',
  'backdrop',
  'tilt',
] as const

const HAS_OWN_WORDS = new Set<ProfileBlock['block_type']>(['bio', 'status', 'free'])

const HAS_HEADING = new Set<ProfileBlock['block_type']>([
  'stats',
  'trophies',
  'activity',
  'guestbook',
  /* ⚠️ A free block has no heading of its own to replace, so this is the one type where the
     field ADDS a line rather than renaming one — which is what lets it be a titled panel. */
  'free',
])

/**
 * Which blocks are worth offering a colour for.
 *
 * ⚠️ Left out: the three whose card is ENTIRELY filled by their own artwork. A banner is a
 * generated gradient edge to edge, and a wash underneath it is a control that appears to do
 * nothing — which is worse than not offering it, because the reader concludes the feature is
 * broken rather than inapplicable.
 */
const CAN_TINT: ReadonlySet<ProfileBlock['block_type']> = new Set([
  'bio',
  /* ⚠️ A free block above all: a coloured band with no words in it is most of what one is
     FOR, and without a tint the only blank block you could make was grey. */
  'free',
  'stats',
  'activity',
  'guestbook',
  'status',
  'trophies',
  'song',
])

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
  free: '🧩 Free',
  banner: '🖼️ Banner',
  stats: '📊 Stats',
  activity: '🕓 Activity',
  guestbook: '💬 Guestbook',
  status: '💭 Status',
  trophies: '🏆 Trophies',
  song: '🎵 Song',
  visualizer: '◉ Visualiser',
  art: '🖼 Art',
  pet: '🐾 Minion',
  looks: '🎭 Looks',
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
  achievements,
  snakeBest,
  username,
  isMe,
  guest,
}: {
  block: ProfileBlock
  activity: ActivityItem[]
  trophies: ProfileTrophy[]
  achievements?: Achievement[]
  snakeBest: { score: number; game_mode: string | null } | null
  /** whose page this is — a banner with no colour picked falls back to their own */
  username: string
  /** the guestbook's compose box addresses you differently on your own page */
  isMe: boolean
  /**
   * ⚠️ THE VIEWER IS NOT SIGNED IN, which several blocks have to know because their contents
   * come from RPCs granted to `authenticated` and theirs alone. A public block reaches a stranger
   * — get_demo_profile hands it over — and then fetches nothing, so it renders as an empty shell
   * of itself. Saying which of "there is nothing here" and "you cannot see what is here" is true
   * is the difference between a page that looks unfinished and one that looks shut.
   */
  guest?: boolean
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
      const songs = songsFromConfig(cfg)
      if (!songs.length) return null
      return (
        <SongBlock
          id={block.id ?? `song-${songs[0].name}`}
          songs={songs}
          /* aligned with `songs` by position — see looksFromConfig */
          looks={looksFromConfig(cfg)}
          autoplay={cfg.autoplay === true}
        />
      )
    }
    case 'visualizer':
      return <VisualBlock cfg={cfg} />
    /* ⚠️ Strokes, not an image — the visitor's browser draws it. See ProfileArt. */
    case 'art':
      return <ArtBlock cfg={cfg} />
    /* ⚠️ The same, and moving: a pet is a drawing whose layer names say how it moves, read
       and animated in the visitor's own tab. See pets/rig.ts. */
    case 'pet':
      return <PetBlock cfg={cfg} />
    case 'looks':
      return <LooksBlock block={block} />
    case 'bio': {
      const text = typeof cfg.text === 'string' ? cfg.text : ''
      /* ⚠️ Empty and KEPT is a panel — see blockKeepEmpty. Empty and not kept is still
         nothing, because that is a block somebody has not finished. */
      if (!text.trim() && !blockKeepEmpty(cfg)) return null
      return (
        <div className={'card profile-block is-' + block.size}>
          {/* ⚠️ STILL A PLAIN TEXT NODE. A bio can say anything and can never RENDER anything —
              which is exactly why it is safe to let it choose a face, a size and an alignment:
              those are attributes of the box, chosen from closed lists, and none of them is a
              way to put markup on somebody else's page. */}
          <p style={{ margin: 0, whiteSpace: 'pre-wrap', ...textStyle(cfg) }}>{text}</p>
        </div>
      )
    }
    /**
     * Anything you like, in a box.
     *
     * ⚠️ ITS OWN TYPE RATHER THAN A BIO WEARING A HAT, and the difference is entirely the
     * name. A bio already grew a face, a size, an alignment and the option to hold no words at
     * all, so the CAPABILITY has been there — and nobody hunting for a way to put a title, a pull
     * quote or a coloured band on their page was ever going to look under "📝 Bio". A block is
     * found by what it is called, so the thing that was missing was a name.
     *
     * ⚠️ Still a plain text node, like the bio. It can say anything and can never RENDER
     * anything; everything else it wears comes from closed lists.
     */
    case 'free': {
      const text = typeof cfg.text === 'string' ? cfg.text : ''
      const head = blockHeading(cfg)
      if (!text.trim() && !head && !blockKeepEmpty(cfg)) return null
      return (
        <div className={'card profile-block is-' + block.size}>
          {head && <h3 style={{ marginTop: 0, ...textStyle(cfg) }}>{head}</h3>}
          {text.trim() && (
            <p style={{ margin: 0, whiteSpace: 'pre-wrap', ...textStyle(cfg) }}>{text}</p>
          )}
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
          {/* ⚠️ YOUR WORDS IF YOU WROTE ANY, the type's name otherwise. A guestbook that says
              "leave me something rude" is a different invitation from one that says "Guestbook",
              and the heading is the cheapest place on a page to sound like a person. */}
          <h3 style={{ marginTop: 0 }}>{blockHeading(cfg) ?? '📊 Stats'}</h3>
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
            {/* ⚠️ "0 trophies" to a signed-out reader is a LIE, not a lock — the list arrives as
                props and a stranger is handed an empty one, so a shelf full of them counts as
                none. The snake score above it is real, because the payload carries that. */}
            {guest ? 'Sign in to see trophies' : `${trophies.length} trophies`}
          </p>
        </div>
      )
    case 'status': {
      const text = typeof cfg.text === 'string' ? cfg.text.trim() : ''
      const emoji = typeof cfg.emoji === 'string' && cfg.emoji ? cfg.emoji : '💭'
      if (!text && !blockKeepEmpty(cfg)) return null
      // One line, big, no heading — a status IS the sentence, and a "Status" label above it
      // would just be a word taking up the space the sentence should have.
      return (
        <div className={'card profile-block profile-status is-' + block.size}>
          <span className="profile-status-emoji" aria-hidden>
            {emoji}
          </span>
          <p style={{ margin: 0, ...textStyle(cfg) }}>{text}</p>
        </div>
      )
    }
    case 'trophies': {
      // Snake trophies already existed and were only ever COUNTED (the stats block says "3
      // trophies"). Naming them is the difference between a number and something worth showing.
      const won = trophies
      const acts = achievements ?? []
      const got = acts.filter((a) => a.have >= a.goal)
      /* ⚠️ the nearest few, not every locked one. Fifteen greyed-out rows is a chore list; the
         three you are closest to is a nudge. Sorted by how far along you are. */
      const near = acts
        .filter((a) => a.have < a.goal)
        .sort((x, y) => y.have / y.goal - x.have / x.goal)
        .slice(0, 3)
      return (
        <div className={'card profile-block is-' + block.size}>
          {/* ⚠️ YOUR WORDS IF YOU WROTE ANY, the type's name otherwise. A guestbook that says
              "leave me something rude" is a different invitation from one that says "Guestbook",
              and the heading is the cheapest place on a page to sound like a person. */}
          <h3 style={{ marginTop: 0 }}>{blockHeading(cfg) ?? '🏆 Trophies'}</h3>
          {got.length > 0 && (
            <div className="profile-acts">
              {got.map((a) => (
                <span key={a.code} className="profile-act" title={a.note}>
                  <span aria-hidden>{MODULE_ICON[a.module] ?? '★'}</span> {a.label}
                </span>
              ))}
            </div>
          )}
          {near.length > 0 && (
            <div className="profile-acts is-near">
              {near.map((a) => (
                <span key={a.code} className="profile-act is-locked" title={a.note}>
                  <span aria-hidden>{MODULE_ICON[a.module] ?? '★'}</span> {a.label}
                  <span className="muted">
                    {' '}
                    {a.have}/{a.goal}
                  </span>
                </span>
              ))}
            </div>
          )}
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
              {guest
                ? 'Sign in to see these.'
                : isMe
                  ? 'No trophies yet — go win a round.'
                  : 'None yet.'}
            </p>
          )}
        </div>
      )
    }
    case 'guestbook':
      return (
        <Guestbook
          username={username}
          isMe={isMe}
          guest={guest}
          heading={blockHeading(cfg) ?? undefined}
        />
      )
    case 'activity': {
      const limit = typeof cfg.limit === 'number' ? cfg.limit : 10
      const items = activity.slice(0, limit)
      return (
        <div className={'card profile-block is-' + block.size}>
          {/* ⚠️ YOUR WORDS IF YOU WROTE ANY, the type's name otherwise. A guestbook that says
              "leave me something rude" is a different invitation from one that says "Guestbook",
              and the heading is the cheapest place on a page to sound like a person. */}
          <h3 style={{ marginTop: 0 }}>{blockHeading(cfg) ?? '🕓 Activity'}</h3>
          {items.length ? (
            <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
              {items.map((a, i) => (
                <li key={i}>{activityLine(a)}</li>
              ))}
            </ul>
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              {/* ⚠️ A GUEST CAN NOW HAVE ACTIVITY, so this stopped being "you are locked out"
                  and became genuinely ambiguous: get_public_activity returns [] both for a feed
                  that is members-only and for one that is public and empty, and the client cannot
                  tell those apart. So the wording is true either way rather than picking one. */}
              {guest ? 'Nothing public here — sign in to see more.' : 'Nothing to show yet.'}
            </p>
          )}
        </div>
      )
    }
  }
}

/**
 * Which section of the page a block belongs to.
 *
 * ⚠️ IN THE BLOCK'S OWN CONFIG, like `alone`, `shape`, `edge` and `heading` before it —
 * free-form jsonb the server already accepts, so a tabbed page needs no migration and a reader
 * that has never heard of tabs ignores the key and renders one long page, exactly as it does now.
 *
 * ⚠️ EMPTY MEANS THE FIRST SECTION rather than "no section". A page that is half sorted is the
 * normal state of a page being sorted, and blocks that have not been filed anywhere yet have to
 * live somewhere visible while you work — dropping them into a hidden "other" is how you lose
 * track of the thing you were in the middle of.
 */
function blockTab(b: ProfileBlock): string {
  const v = b.config?.tab
  return typeof v === 'string' ? v.trim().slice(0, 24) : ''
}

/**
 * The sections a page has, in the order their first block appears.
 *
 * ⚠️ DERIVED, NEVER STORED. Tab order is block order, so arranging the page arranges its
 * tabs and there is no second list to keep in step — no reorder controls, nothing that can
 * disagree with the grid, and ⇅ Arrange rearranges both at once without knowing tabs exist.
 *
 * ⚠️ COMPUTED FROM THE BLOCKS THIS VIEWER GETS, which is why it takes a list rather than
 * reading one. A stranger is served only public blocks, so a section whose blocks are all
 * members-only must not appear as an empty tab with their name on it — that would publish the
 * shape of a page nobody can see.
 */
function tabsOf(blocks: ProfileBlock[]): string[] {
  const seen: string[] = []
  for (const b of blocks) {
    const t = blockTab(b)
    if (t && !seen.includes(t)) seen.push(t)
  }
  return seen
}

/** Read-only display of every block, in order. Used for everyone, including the owner outside edit mode. */
export function ProfileBlocksView({
  blocks,
  activity,
  trophies,
  achievements,
  snakeBest,
  username,
  isMe = false,
  guest = false,
  asTier,
  page,
}: {
  blocks: ProfileBlock[]
  activity: ActivityItem[]
  trophies: ProfileTrophy[]
  achievements?: Achievement[]
  snakeBest: { score: number; game_mode: string | null } | null
  username: string
  isMe?: boolean
  /** nobody is signed in — see BlockView */
  guest?: boolean
  /** the page shape its owner chose, straight off the profile payload — see readPageStyle */
  page?: unknown
  /**
   * ⚠️ THE OWNER LOOKING THROUGH SOMEBODY ELSE'S EYES. Absent means "show me everything I was
   * sent", which is what every visitor gets — the server already filtered for them. It is only
   * ever set on your OWN page, where the server sent you all of your own blocks and the question
   * "what would a stranger have got?" has no other way to be answered.
   */
  asTier?: Tier
}) {
  /**
   * ⚠️ NO TAB BAR UNTIL SOMEBODY MAKES A SECOND SECTION. A page with everything in one place
   * is the overwhelming majority of pages and a single tab above it is a control that does
   * nothing — so tabs cost exactly nothing until they are used, and the page below is
   * byte-for-byte what it was before.
   */
  /**
   * ⚠️ WHAT WILL ACTUALLY DRAW, not what was served.
   *
   * A block can be public, arrive intact, and render nothing: a song block with no song, a bio
   * with no words that was not kept on purpose. Counting those produced an empty SLOT holding
   * space in the grid — and, once sections existed, a TAB with somebody's name on it that led to
   * a blank page. Found on the live site: a section called "page1" whose only block was an empty
   * song.
   *
   * isBlockEmpty already knows which types can come to nothing, and already answers false for a
   * block kept blank deliberately, so this is the same question the editor asks when it offers to
   * fill one in.
   */
  /* the pretend audience first, then the blocks that actually draw something — in that order,
     so a section does not keep its tab on the strength of a block this viewer cannot see */
  const visible = asTier ? blocks.filter((b) => tierSees(asTier, b.visibility)) : blocks
  const live = visible.filter((b) => !isBlockEmpty(b))
  const tabs = tabsOf(live)
  /* an unnamed leading section exists only while something is still unfiled — see blockTab */
  const hasUnfiled = live.some((b) => !blockTab(b))
  const sections = !tabs.length ? [] : hasUnfiled ? ['', ...tabs] : tabs
  const [openTab, setOpenTab] = useState<string | null>(null)
  const active = openTab != null && sections.includes(openTab) ? openTab : (sections[0] ?? '')
  const shown = sections.length ? live.filter((b) => blockTab(b) === active) : live

  if (!live.length) return null
  return (
    <>
      {sections.length > 1 && (
        <div className="profile-tabs" role="tablist" aria-label="Sections of this page">
          {sections.map((t) => (
            <button
              key={t || '~unfiled'}
              role="tab"
              aria-selected={t === active}
              className={'btn profile-tab' + (t === active ? ' is-on' : '')}
              onClick={() => setOpenTab(t)}
            >
              {/* an unfiled block's section has no name of its own — see blockTab */}
              {t || 'Page'}
            </button>
          ))}
        </div>
      )}
      <div className="profile-blocks-grid" {...pageStyleAttrs(page)}>
        {shown.map((b, i) => (
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
            {...blockLookAttrs(b.config, username)}
          >
            <BlockView
              guest={guest}
              block={b}
              activity={activity}
              trophies={trophies}
              achievements={achievements}
              snakeBest={snakeBest}
              username={username}
              isMe={isMe}
            />
          </div>
        ))}
      </div>
    </>
  )
}

/**
 * Themes you found, for somebody else to wear.
 *
 * ⚠️ THE POINT IS THAT THEY ARE PRESSABLE. A screenshot of a theme is a screenshot; the site
 * already knows how to put one on, so a look on a profile should be one press away from being
 * yours. Fourteen million combinations exist and nobody clicks their way to a good one —
 * somebody else having already found it is the realistic way most of them ever get seen.
 *
 * ⚠️ AND IT IS NOT PERMANENT. Pressing one changes the visitor's own settings, which is a real
 * change to their site and has to be undoable in the obvious place — the appearance dialog, where
 * every one of these settings already lives. Saying so is the whole of the warning it needs.
 *
 * ⚠️ Falls back to showing them UNPRESSABLE where nothing has registered an applier, rather
 * than rendering a button that silently does nothing.
 */
function LooksBlock({ block }: { block: ProfileBlock }) {
  const raw = Array.isArray(block.config?.looks) ? (block.config.looks as unknown[]) : []
  const looks = raw.map(readLook).filter((l): l is Look => !!l)
  const live = canApplyLook()
  const [worn, setWorn] = useState<string | null>(null)
  if (!looks.length) return null
  return (
    <div className={'card profile-block is-' + block.size}>
      <h3 style={{ marginTop: 0 }}>{BLOCK_LABEL.looks}</h3>
      <div className="plooks">
        {looks.map((l) => (
          <button
            key={l.name}
            className={'plook' + (worn === l.name ? ' is-on' : '')}
            disabled={!live}
            title={live ? `Put ${l.name} on` : l.name}
            onClick={() => {
              if (!applyLookNow(l)) return
              setWorn(l.name)
            }}
          >
            <span
              className="plook-chip"
              aria-hidden
              style={
                l.palette
                  ? {
                      background: l.palette.bg,
                      color: l.palette.text,
                      borderColor: l.palette.accent,
                    }
                  : undefined
              }
            >
              {l.palette ? 'Aa' : l.theme === 'light' ? '☀' : l.theme === 'alt' ? '◐' : '🌙'}
            </span>
            <span className="plook-name">{l.name}</span>
          </button>
        ))}
      </div>
      <p className="muted plook-note">
        {worn
          ? `That is ${worn} — change it back under the cog, in Appearance.`
          : live
            ? 'Press one to put it on. Everything in Appearance, under the cog, changes it back.'
            : 'Themes I found and kept.'}
      </p>
    </div>
  )
}

/**
 * Choosing which of your saved looks go on the page.
 *
 * ⚠️ IT PUBLISHES COPIES, not references. A look lives in the author's own localStorage, so a
 * profile that pointed at one would show nothing to anybody else — the whole point is that a
 * visitor can wear it. The copy is what gets stored, which also means editing a look later does
 * not silently change what is already published; re-pick it.
 *
 * ⚠️ AND IT COUNTS THE BYTES. config is capped at 16000 characters by the server, and it
 * refuses the WHOLE page when one block is over — so the cap is reached here, with a sentence,
 * rather than as "invalid block" on the next autosave.
 */
function LooksPicker({
  value,
  onChange,
}: {
  value: Record<string, unknown>
  onChange: (config: Record<string, unknown>) => void
}) {
  const mine = useSyncExternalStore(subscribeLooks, myLooks, myLooks)
  const chosen = Array.isArray(value.looks) ? (value.looks as unknown[]) : []
  const names = new Set(chosen.map((l) => readLook(l)?.name).filter(Boolean) as string[])

  const toggle = (l: Look) => {
    const next = names.has(l.name)
      ? chosen.filter((c) => readLook(c)?.name !== l.name)
      : [...chosen, l]
    const cfg = { ...value, looks: next }
    if (configSize(cfg) > CONFIG_LIMIT) return
    onChange(cfg)
  }

  if (!mine.length)
    return (
      <p className="muted">
        No saved looks yet — make one under the cog, in Appearance → Looks, and it will appear here.
      </p>
    )

  return (
    <div className="plooks-pick">
      <p className="muted" style={{ margin: '0 0 0.4rem', fontSize: '0.82rem' }}>
        Pick the ones to show. Visitors can press any of them to put it on.
      </p>
      {mine.map((l) => (
        <label key={l.name} className="plooks-pick-row">
          <input type="checkbox" checked={names.has(l.name)} onChange={() => toggle(l)} />
          <span
            className="plook-chip"
            aria-hidden
            style={
              l.palette
                ? { background: l.palette.bg, color: l.palette.text, borderColor: l.palette.accent }
                : undefined
            }
          >
            {l.palette ? 'Aa' : l.theme === 'light' ? '☀' : l.theme === 'alt' ? '◐' : '🌙'}
          </span>
          <span>{l.name}</span>
        </label>
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
function Guestbook({
  username,
  isMe,
  guest,
  heading,
}: {
  username: string
  isMe: boolean
  guest?: boolean
  heading?: string
}) {
  const [notes, setNotes] = useState<ProfileNote[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  /**
   * ⚠️ NOT ATTEMPTED WHEN SIGNED OUT. list_profile_notes is granted to `authenticated` and
   * nobody else, so a stranger's call is refused — and the refusal was thrown away, leaving an
   * empty list that the box below then described as "be the first to write something". To
   * somebody who cannot write. The block is public, its CONTENTS are not, and those are two
   * different facts that were being reported as one.
   */
  const load = useCallback(async () => {
    if (guest) {
      setLoaded(true)
      return
    }
    const { data, error } = await getSupabaseClient().rpc('list_profile_notes', {
      p_username: username,
    })
    if (!error) setNotes((data as ProfileNote[]) ?? [])
    setLoaded(true)
  }, [username, guest])

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
      <h3 style={{ marginTop: 0 }}>{heading ?? '💬 Guestbook'}</h3>
      {/* Writing on your own page is allowed — it's your page, and a first note stops a new
          guestbook from looking broken. */}
      {!guest && (
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
      )}
      {err && <p style={{ color: '#f46b6b', margin: '0 0 0.5rem', fontSize: '0.82rem' }}>{err}</p>}
      {notes.length === 0 && loaded && (
        <p className="muted" style={{ margin: 0, fontSize: '0.88rem' }}>
          {guest
            ? 'Notes here are between members — sign in to read them or leave one.'
            : isMe
              ? 'Nothing yet — your friends can write here.'
              : 'Be the first to write something.'}
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
  /* ⚠️ A block kept on purpose is not unfinished, and telling its owner to "click to fill it
     in" is the editor arguing with a decision they already made. */
  if (blockKeepEmpty(block.config)) return false
  if (block.block_type === 'bio' || block.block_type === 'free') return !txt
  if (block.block_type === 'status') return !txt
  if (block.block_type === 'song') return !songFromConfig(block.config)
  if (block.block_type === 'art')
    return !(Array.isArray(block.config.art) && block.config.art.length)
  if (block.block_type === 'pet')
    return !(Array.isArray(block.config.pets) && block.config.pets.length)
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
/**
 * ⚠️ A LIBRARY LIVES IN ONE BROWSER; A BLOCK DOES NOT.
 *
 * Songs, drawings and looks are kept in localStorage (see library.ts and gallery.ts) while what
 * goes ON a block is COPIED into its config and stored on the server. So the two disagree the
 * moment you open the editor anywhere but the machine you made the thing on — and every picker
 * here used to answer that disagreement by bailing out with "nothing in your library yet", before
 * it had looked at the block at all.
 *
 * Reported exactly that way: a song made in Firefox plays perfectly on the profile in Chrome, and
 * the editor in Chrome says the block is empty. It is not empty and nothing has been lost — the
 * editor was describing the wrong thing. What is in the block is always shown; the local library
 * is only what you can ADD FROM, and when it is empty that is what gets said.
 */
function SongPicker({
  value,
  onChange,
}: {
  value: Record<string, unknown>
  onChange: (config: Record<string, unknown>) => void
}) {
  const items = useSyncExternalStore(subscribeLibrary, library, library)
  /**
   * ⚠️ Say so BEFORE the save fails.
   *
   * The server caps a block's config, and a song past that cap came back as "invalid block" —
   * a message about the shape of the data for a problem that is really "this piece is long".
   * Checking here means the answer arrives while you are choosing, not after you press Done.
   */
  const tooBig = configSize(value) > CONFIG_LIMIT
  /* whatever is already in the block, as one list — a block written before playlists holds its
     single song under `song`, so the two are folded together here and written back as `songs` */
  const queue = [
    ...(value.song ? [value.song] : []),
    ...(Array.isArray(value.songs) ? value.songs : []),
  ]
  const picked = songsFromConfig(value).map((x) => x.name)
  /* aligned with `picked` by position — see looksFromConfig */
  const looks = looksFromConfig(value)
  /* ⚠️ Read once per render rather than held in state: the only thing that changes this list is
     saving a look in the visualiser, which happens on a different page and therefore a different
     mount of this editor. Somebody's own browser, somebody's own looks. */
  const savedLooks = readPresets()
  if (!items.length && !picked.length)
    return (
      <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
        Nothing in your library yet. Make something in the Instrument room and press{' '}
        <strong>Keep song</strong>, then come back.
      </p>
    )
  return (
    <label className="inst-pick" style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
      <span className="muted">Songs</span>
      {/**
       * ⚠️ ADD rather than replace. One song in a block is a loop and several are a playlist,
       * and the only difference in the data is how many there are — so the control is a list you
       * add to, and choosing a second one is how a loop becomes a playlist. There is no mode to
       * switch and nothing to explain.
       */}
      {picked.length > 0 && (
        <ol className="profile-song-picked">
          {picked.map((n, at) => (
            <li key={at}>
              <span className="profile-song-trackname">{n}</span>
              {/**
               * ⚠️ THE LOOK BELONGS TO THE TRACK, which is the whole point of putting it here
               * rather than on the visualiser block. That block has one setting, so a playlist
               * of six played all six through it.
               *
               * ⚠️ Mode and palette only. Every dial the visual block has could go here and it
               * would be unusable — twelve tracks times seven sliders is not an editor. These
               * two are what change the look; the rest stay the page's design, and the merge is
               * per field, so a track saying only "green" keeps everything else.
               *
               * ⚠️ Blank means "leave it alone", not a value. That is what keeps this additive:
               * every existing block has no looks at all and plays exactly as it did.
               */}
              {savedLooks.length > 0 && (
                /* ⚠️ Sets every field at once, which is why it sits BEFORE the two below: the
                   usual gesture is "this track looks like that saved arrangement", and the mode
                   and palette pickers are then there to adjust it rather than to build it from
                   nothing. */
                <select
                  className="viz-select"
                  aria-label={`Apply a saved look to ${n}`}
                  title="Use one of the looks you saved in the visualiser"
                  value=""
                  onChange={(e) => {
                    const hit = savedLooks.find((x) => x.id === e.target.value)
                    if (hit) onChange(applyLookPreset(value, at, hit.s))
                  }}
                >
                  <option value="">From a saved look…</option>
                  {savedLooks.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
              )}
              <select
                className="viz-select"
                aria-label={`Look for ${n}`}
                title="Play this track through a particular visualiser mode"
                value={(looks[at]?.mode as string) ?? ''}
                onChange={(e) => onChange(setLook(value, at, 'mode', e.target.value))}
              >
                <option value="">Block's look</option>
                {VISUALS.map(([id, icon, label]) => (
                  <option key={id} value={id}>
                    {icon} {label}
                  </option>
                ))}
              </select>
              <select
                className="viz-select"
                aria-label={`Colours for ${n}`}
                title="Play this track in a particular palette"
                value={(looks[at]?.palette as string) ?? ''}
                onChange={(e) => onChange(setLook(value, at, 'palette', e.target.value))}
              >
                <option value="">Block's colours</option>
                {PALETTES.map((pal) => (
                  <option key={pal.id} value={pal.id}>
                    {pal.label}
                  </option>
                ))}
              </select>
              <button
                className="btn btn-ghost"
                title="Take this one out"
                onClick={() => {
                  const rest = queue.filter((_, k) => k !== at)
                  /* ⚠️ the looks move with the tracks. They are joined by POSITION, so dropping
                     a track without dropping its look shifts every later track onto the wrong
                     one — silently, and only visibly once something plays. */
                  const restLooks = looks.filter((_, k) => k !== at)
                  onChange({
                    ...value,
                    song: undefined,
                    songs: rest.length ? rest : undefined,
                    looks: restLooks.some(Boolean) ? restLooks : undefined,
                  })
                }}
              >
                ✕
              </button>
            </li>
          ))}
        </ol>
      )}
      {!items.length ? (
        <span className="muted" style={{ fontSize: '0.75rem' }}>
          Added from another browser — they play fine, but this one&apos;s library is empty so there
          is nothing here to add.
        </span>
      ) : (
        <select
          className="viz-select"
          value=""
          onChange={(e) => {
            const add = items.find((i: LibraryItem) => i.song.name === e.target.value)
            if (!add) return
            // ⚠️ the COMPACT form goes into the block — see packSong. The readable one is roughly
            // five times larger and a normal four-layer song does not fit in a profile block at all
            onChange({ ...value, song: undefined, songs: [...queue, packSong(add.song)] })
          }}
        >
          <option value="">{picked.length ? 'Add another…' : 'Pick one…'}</option>
          {items.map((i: LibraryItem) => (
            <option key={i.id} value={i.song.name}>
              {i.kind === 'loop' ? '🔁' : '🎵'} {i.name}
            </option>
          ))}
        </select>
      )}
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

  if (!items.length && !chosen.length)
    return (
      <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
        Nothing in your gallery yet. Draw something in the Paint room and press{' '}
        <strong>Keep</strong>, then come back.
      </p>
    )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {/* what the block HOLDS, which is not the same list as what this browser can offer */}
      {!items.length && (
        <span className="muted" style={{ fontSize: '0.75rem' }}>
          {names.join(', ')} — added from another browser. They show fine; this one&apos;s gallery
          is empty so there is nothing here to add.
        </span>
      )}
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
      {/**
       * ⚠️ Only offered when one of the chosen drawings actually HAS frames. A switch for
       * "play the animation" on a page of still pictures is a control that does nothing, and a
       * control that does nothing is worse than one that is missing — it invites you to go
       * looking for the animation you were promised.
       *
       * Defaults ON, unlike the song block's autoplay, because motion is not sound: it does not
       * interrupt anything, it is the point of a drawing that has frames, and a visitor who does
       * not want it has already said so through prefers-reduced-motion, which ArtBlock obeys.
       */}
      {chosen.some((a) => {
        const d = readDrawing(a)
        return d ? frameCount(d) > 1 : false
      }) && (
        <label className="inst-pick" style={{ display: 'flex', gap: '0.4rem' }}>
          <input
            type="checkbox"
            checked={value.autoplay !== false}
            onChange={(e) => onChange({ ...value, autoplay: e.target.checked ? undefined : false })}
          />
          <span className="muted">Play the animation</span>
        </label>
      )}
      {/**
       * ⚠️ OFFERED ONLY FOR A PICTURE THAT CAN DO IT, the same rule as the animation switch
       * above: a drawing made in the frame editor already has motion and plays it, and a
       * one-stroke picture has nothing to watch. A switch for "draw itself" on a block where
       * nothing would move is a promise the page cannot keep.
       *
       * ⚠️ OFF BY DEFAULT, unlike the animation switch. Frames exist to be played — a drawing
       * with them is already a moving thing and showing it still is the surprising choice. A flat
       * picture is a picture; making every art block on the site start redrawing itself because
       * the feature arrived is a change to pages nobody asked to change.
       */}
      {chosen.some((a) => {
        const d = readDrawing(a)
        return d ? frameCount(d) < 2 && d.strokes.length > 1 : false
      }) && (
        <>
          <label className="inst-pick" style={{ display: 'flex', gap: '0.4rem' }}>
            <input
              type="checkbox"
              checked={value.replay === true}
              onChange={(e) => onChange({ ...value, replay: e.target.checked || undefined })}
            />
            <span className="muted">Draw themselves, stroke by stroke</span>
          </label>
          {value.replay === true && (
            <label className="appearance-slider" style={{ display: 'flex', gap: '0.4rem' }}>
              <span className="muted">Strokes a second</span>
              <input
                type="range"
                min={1}
                max={60}
                step={1}
                value={typeof value.replaySpeed === 'number' ? value.replaySpeed : 12}
                onChange={(e) => onChange({ ...value, replaySpeed: Number(e.target.value) })}
              />
              <span className="appearance-slider-val">
                {typeof value.replaySpeed === 'number' ? value.replaySpeed : 12}
              </span>
            </label>
          )}
        </>
      )}
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
  const items = useSyncExternalStore(subscribeGallery, gallery, gallery)
  const [tooBig, setTooBig] = useState<string | null>(null)
  const chosenName = value.art ? (readDrawing(value.art)?.name ?? null) : null
  const artStyle = typeof value.artStyle === 'string' ? value.artStyle : 'swarm'
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
      {/**
       * ⚠️ WHICH DRAWING, and only when Your art is the style — the same rule the visualiser
       * page follows. Picking Your art here used to be a dead end: the mode needs a picture and
       * there was nowhere to name one, so the block rendered the style with nothing in it.
       *
       * ⚠️ THE STROKES ARE COPIED IN, not referenced by id. A visitor cannot read your gallery
       * — it is yours — so an id would resolve to nothing on every machine but your own. The art
       * block settled this the same way, and it is why a chosen drawing keeps working after you
       * delete it from the gallery.
       */}
      {mode === 'art' &&
        (items.length === 0 ? (
          <span className="muted" style={{ fontSize: '0.8rem' }}>
            {chosenName
              ? `“${chosenName}” — added from another browser. It shows fine; this one's gallery is empty so there is nothing here to swap to.`
              : 'Nothing in your gallery — draw something in Paint and press Keep.'}
          </span>
        ) : (
          <>
            <label className="inst-pick" style={{ display: 'flex', gap: '0.4rem' }}>
              <span className="muted">Drawing</span>
              <select
                className="viz-select"
                value={chosenName ?? ''}
                onChange={(e) => {
                  const hit = items.find((a: Art) => a.name === e.target.value)
                  const next = { ...value, art: hit ? packDrawing(hit.art) : undefined }
                  /* ⚠️ Checked HERE rather than left to the save. The server measures the same
                     thing and refuses the whole block with "invalid block" — a message about the
                     wrong layer, arriving after you pressed Done, about a drawing you would have
                     to guess at. A detailed picture is the one that trips it. */
                  if (configSize(next) > CONFIG_LIMIT) {
                    setTooBig(hit?.name ?? '')
                    return
                  }
                  setTooBig(null)
                  onChange(next)
                }}
              >
                <option value="">Choose one…</option>
                {items.map((a: Art) => (
                  <option key={a.id} value={a.name}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            {ART_STYLES.map(([id, label]) => (
              <button
                key={id}
                className={'btn' + (artStyle === id ? ' is-on' : '')}
                aria-pressed={artStyle === id}
                onClick={() => onChange({ ...value, artStyle: id })}
              >
                {label}
              </button>
            ))}
            {tooBig !== null && (
              <span className="muted" style={{ fontSize: '0.75rem' }}>
                “{tooBig}” has too many strokes for one block — try a simpler drawing.
              </span>
            )}
          </>
        ))}
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
    case 'pet':
      return (
        <PetPicker value={block.config} onChange={(config) => onChange({ ...block, config })} />
      )
    case 'looks':
      return (
        <LooksPicker value={block.config} onChange={(config) => onChange({ ...block, config })} />
      )
    case 'visualizer':
      return (
        <VisualPicker value={block.config} onChange={(config) => onChange({ ...block, config })} />
      )
    case 'free':
    case 'bio':
      return (
        <textarea
          className="profile-editrow-textarea"
          placeholder={
            block.block_type === 'free'
              ? 'Anything at all — or nothing, and let it be a shape…'
              : 'Say something about yourself…'
          }
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

/**
 * Who a new block is visible to before anybody chooses.
 *
 * 'members' means anyone with ANY account on the site — fine for a bio or a status, but
 * activity and stats surface circuit-flavoured detail (workout logs, trophies) to people who may
 * have signed up for an unrelated module and have no context for it. 'friends' at least requires
 * an accepted mutual friendship first. The circuit_log rows themselves are separately restricted
 * to viewers who actually share that circuit (get_member_activity checks membership per row) —
 * this default is about avoiding an accidentally-broad START, not a gap in what the row-level
 * check already covers.
 *
 * ⚠️ One function, because the layouts add blocks too and a second copy of this rule is a
 * second place for it to be wrong.
 */
function defaultTier(type: ProfileBlock['block_type']): Tier {
  return type === 'activity' || type === 'stats' ? 'friends' : 'members'
}

/**
 * Pages you can start from.
 *
 * ⚠️ THE BLANK PAGE IS THE PROBLEM, the same one the drum patterns answer in the instrument
 * room, and it fails the same way. "+ Add a block" eleven times is not a page, it is a list of
 * decisions taken before you know what any of them look like — and the person who most needs a
 * profile is exactly the person with no picture in their head of what one should contain. Filling
 * the page first and pulling it apart afterwards is a far easier job than composing it empty, and
 * with ⇅ Arrange the pulling apart is now one screen rather than a mile of scrolling.
 *
 * ⚠️ EACH ONE IS A DIFFERENT SHAPE, not a different name. Four variations on "banner, bio,
 * guestbook" would be a longer menu that helps nobody choose. These differ in what the page is
 * FOR — which block is the biggest, and what a visitor is meant to do when they arrive.
 *
 * ⚠️ NOTHING FROM NEEDS_SERVER_SUPPORT. A layout carrying an art or looks block would be
 * refused whole by a server that has not had that migration yet, so a starting point would fail
 * to start. Both are one press to add afterwards.
 */
type Starter = {
  id: string
  name: string
  /** what the page is FOR, in the words somebody choosing would use */
  about: string
  /**
   * ⚠️ THE SHAPE OF THE PAGE, not just what is on it. Page width and gap were added after
   * these were written and live in a row nobody has a reason to look at — so every starter
   * produced the same silhouette and the axis was effectively invisible. A starting point that
   * does not start you anywhere new is half a starting point.
   */
  page?: { width: PageWidth; gap: PageGap }
  blocks: Array<{
    type: ProfileBlock['block_type']
    size: ProfileBlock['size']
    alone?: true
  }>
}

const STARTERS: Starter[] = [
  {
    id: 'intro',
    page: { width: 'page', gap: 'normal' },
    name: 'Introduction',
    about: 'Who you are, and somewhere to say hello',
    blocks: [
      { type: 'banner', size: 'large' },
      { type: 'bio', size: 'medium' },
      { type: 'status', size: 'small' },
      { type: 'guestbook', size: 'large' },
    ],
  },
  {
    id: 'stage',
    page: { width: 'wide', gap: 'tight' },
    name: 'Stage',
    about: 'A page that plays something when you land on it',
    blocks: [
      { type: 'banner', size: 'large' },
      { type: 'song', size: 'medium' },
      { type: 'visualizer', size: 'medium' },
      { type: 'bio', size: 'small' },
      { type: 'guestbook', size: 'medium' },
    ],
  },
  {
    id: 'scoreboard',
    page: { width: 'wide', gap: 'normal' },
    name: 'Scoreboard',
    about: 'What you have been doing and what you have won',
    blocks: [
      { type: 'status', size: 'small' },
      { type: 'stats', size: 'medium' },
      { type: 'trophies', size: 'medium' },
      { type: 'activity', size: 'large', alone: true },
    ],
  },
  {
    id: 'plain',
    page: { width: 'column', gap: 'airy' },
    name: 'Just the basics',
    about: 'Three blocks. Nothing to tidy up later',
    blocks: [
      { type: 'bio', size: 'large' },
      { type: 'status', size: 'small' },
      { type: 'guestbook', size: 'medium' },
    ],
  },
]

/**
 * Every arrow, mapped to one step along the page's reading order.
 *
 * ⚠️ ALL FOUR MEAN THE SAME MOVE, because the grid is not always a grid. At Column width the
 * page is one block per row and left/right is the wrong word for what you want; at Wide it is
 * six across and up/down is. Both are "one step along the order the blocks are saved in", which
 * is the only order that exists — a 2D walk would need rows, and blocks of three different
 * widths do not sit in rows you could walk.
 */
const ARROW_STEP: Record<string, -1 | 1 | undefined> = {
  ArrowLeft: -1,
  ArrowUp: -1,
  ArrowRight: 1,
  ArrowDown: 1,
}

/** The "arrange your page" panel — owner only, shown behind an Edit toggle in Profile.tsx. */
export function ProfileBlocksEditor({
  initial,
  username,
  activity,
  trophies,
  achievements,
  snakeBest,
  onSaved,
  page,
  onPage,
}: {
  initial: ProfileBlock[]
  username: string
  /** passed straight through to the previews, so editing shows the page and not a description */
  activity: ActivityItem[]
  trophies: ProfileTrophy[]
  achievements?: Achievement[]
  snakeBest: { score: number; game_mode: string | null } | null
  onSaved: (blocks: ProfileBlock[]) => void
  /** the page shape, so the canvas composes at the width the page really uses */
  page?: unknown
  onPage?: (next: { width: string; gap: string }) => void
}) {
  const [blocks, setBlocksRaw] = useState<ProfileBlock[]>(initial)
  const [err, setErr] = useState<string | null>(null)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle')

  /**
   * EVERY change to the page, undoable.
   *
   * ⚠️ BECAUSE EXPERIMENTING WAS NOT SAFE, AND THAT IS WHAT MADE THIS A SETTINGS SCREEN RATHER
   * THAN SOMETHING TO PLAY WITH. There were seven controls on a block — face, shape, edge, colour,
   * finish, width, alignment — and one way back from any of them: remember what it was and put it
   * back by hand. So the honest move was to change nothing, which is the opposite of the reason
   * all those controls exist. A page you can always get back from is a page worth trying things on.
   *
   * ⚠️ THE WRAPPER KEEPS setBlocks' SIGNATURE, so all fifteen existing call sites work
   * unchanged and simply gain a history entry; the ones worth naming pass a label. Rewriting
   * fifteen call sites to thread a new argument would have been fifteen chances to miss one, and
   * a missed one is a change that silently cannot be undone.
   *
   * ⚠️ COALESCED BY TIME AND LABEL. Dragging a hue slider is one intention and hundreds of
   * setStates; without this, undo would walk back through a drag one pixel at a time and never
   * reach the thing before it.
   */
  /**
   * ⚠️ THE PAGE SHAPE IS IN HERE TOO, and leaving it out was worse than having no undo for it.
   * "Surprise me" rolls the blocks AND the page; a starter sets both. Undo restored the blocks and
   * quietly left the page at whatever the roll had chosen — which is the failure mode that makes
   * an undo button untrustworthy, because it covers enough of a change that you stop checking.
   */
  type Step = { blocks: ProfileBlock[]; page: unknown; label: string }
  const [past, setPast] = useState<Step[]>([])
  const [future, setFuture] = useState<Step[]>([])
  const blocksRef = useRef(blocks)
  blocksRef.current = blocks
  const pastRef = useRef<Step[]>(past)
  pastRef.current = past
  const pageRef = useRef<unknown>(page)
  pageRef.current = page
  const onPageRef = useRef(onPage)
  onPageRef.current = onPage
  const lastPush = useRef(0)

  /** record where we are, coalescing a run of the same gesture into one step */
  const pushStep = useCallback((label: string) => {
    const now = Date.now()
    const top = pastRef.current[pastRef.current.length - 1]
    const coalesce = now - lastPush.current < 600 && top?.label === label
    lastPush.current = now
    if (!coalesce)
      setPast((p) => [...p.slice(-49), { blocks: blocksRef.current, page: pageRef.current, label }])
    setFuture([])
  }, [])

  const setBlocks = useCallback(
    (next: ProfileBlock[] | ((b: ProfileBlock[]) => ProfileBlock[]), label = 'that change') => {
      /* ⚠️ Computed from refs and pushed OUTSIDE the updater. Calling setState inside another
         setState's updater is the "cannot update a component while rendering" trap, and React is
         free to run an updater twice — which would file two history entries for one press. */
      const value = typeof next === 'function' ? next(blocksRef.current) : next
      pushStep(label)
      setBlocksRaw(value)
    },
    [pushStep],
  )

  /** the page's own shape, recorded the same way so one Undo covers a change that touched both */
  const changePage = useCallback(
    (next: { width: string; gap: string }, label: string) => {
      pushStep(label)
      onPageRef.current?.(next)
    },
    [pushStep],
  )

  const stepBack = useCallback(() => {
    const p = pastRef.current
    if (!p.length) return
    const step = p[p.length - 1]
    setPast(p.slice(0, -1))
    setFuture((f) => [
      ...f,
      { blocks: blocksRef.current, page: pageRef.current, label: step.label },
    ])
    setBlocksRaw(step.blocks)
    onPageRef.current?.(readPageStyle(step.page))
    lastPush.current = 0
    setOpenIdx(null)
    setLiftIdx(null)
  }, [])

  const stepForward = useCallback(() => {
    setFuture((f) => {
      if (!f.length) return f
      const step = f[f.length - 1]
      setPast((p) => [
        ...p,
        { blocks: blocksRef.current, page: pageRef.current, label: step.label },
      ])
      setBlocksRaw(step.blocks)
      onPageRef.current?.(readPageStyle(step.page))
      lastPush.current = 0
      return f.slice(0, -1)
    })
  }, [])
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
  /**
   * ⚠️ WHICH EDGE THE PANEL LIVES ON, remembered. There is no right answer — it depends which
   * side of the page the block you are editing happens to be on, and that changes as you work. So
   * it is a preference rather than a layout decision, and it is kept, because moving it back
   * every visit would be worse than it being on the wrong side occasionally.
   */
  const [anchor, setAnchor] = useState<'left' | 'right'>(() => {
    try {
      return localStorage.getItem('profile_panel_side') === 'right' ? 'right' : 'left'
    } catch {
      return 'left'
    }
  })
  const anchorTo = (side: 'left' | 'right') => {
    setAnchor(side)
    try {
      localStorage.setItem('profile_panel_side', side)
    } catch {
      /* private mode: it holds for this visit */
    }
  }
  /** on a phone the panel is a tray, and a tray can be pushed out of the way */
  const [trayOpen, setTrayOpen] = useState(true)
  /**
   * ⚠️ ARRANGING IS A DIFFERENT JOB FROM FILLING IN, and the editor showing the real page is
   * what makes them fight.
   *
   * Showing the page at its real widths is right for deciding what goes IN a block — you see
   * what you are making. It is wrong for deciding WHERE a block goes: a page of real blocks is
   * several screens tall, so moving something from the bottom to the top means picking it up,
   * scrolling past everything with it held, and putting it down somewhere you cannot see from
   * where you started. The arrangement is the one thing the editor could not show you all of.
   *
   * So this collapses every block to a labelled tile at the same width it really has. Nothing
   * about the layout changes — same grid, same spans, same order, same move gestures — it is
   * the same page with the contents turned off, which is what makes it fit on one screen.
   */
  const [arranging, setArranging] = useState(false)
  /** the starting-points menu — open by itself on a page with nothing on it */
  const [starters, setStarters] = useState(false)
  /**
   * ⚠️ A LOOK PICKED UP, waiting to be put down — deliberately the same gesture as lifting a
   * block, because it is the same kind of act and a second mechanism would be a second thing to
   * learn. Tap to take, tap to give.
   *
   * ⚠️ "Use this look everywhere" already existed and is all-or-nothing; a page where every
   * block is identical is the only page it can make. This is what lets two styles alternate, or
   * one block stay deliberately different — which is the difference between a setting and
   * composition.
   */
  const [heldLook, setHeldLook] = useState<Record<string, unknown> | null>(null)
  /** whether this page is published — decides what the word "Anyone" currently reaches */
  const [pagePublic, setPagePublic] = useState(false)
  useEffect(() => {
    let live = true
    void getSupabaseClient()
      .rpc('get_my_public_page')
      .then(({ data }) => {
        if (live) setPagePublic(data === true)
      })
    return () => {
      live = false
    }
  }, [])

  /**
   * ⚠️ FOCUS IS THE SELECTION, once a keyboard is involved. The arrow keys read which cell the
   * press came from, so moving the selection without moving the focus moves it exactly once and
   * then stops dead. It is deferred to an effect rather than done in the handler because the
   * button being focused often does not exist yet: Delete is the obvious case, and after a move
   * the button at that index belongs to a different block.
   */
  const gridRef = useRef<HTMLDivElement | null>(null)
  const wantFocus = useRef<number | null>(null)
  const focusCell = (i: number) => {
    wantFocus.current = i
  }
  useEffect(() => {
    const i = wantFocus.current
    if (i == null) return
    wantFocus.current = null
    if (i < 0) return
    /* ⚠️ Not preventScroll. Arrowing along a long page is exactly when you want the page to
       follow the selection — a selection you cannot see is one you cannot use. */
    gridRef.current?.querySelector<HTMLElement>(`[data-cell="${i}"] .profile-canvas-pick`)?.focus()
  })

  /* dragging is offered to a pointer and not to a finger — see the grip below */
  const touch = useTouchOnly()
  /** the add-a-block palette, which is seven buttons you are mostly not pressing */
  const [adding, setAdding] = useState(false)

  /**
   * The look the page mostly has, for a block that has just arrived.
   *
   * ⚠️ BECAUSE "USE THIS LOOK EVERYWHERE" ONLY REACHES THE BLOCKS THAT EXIST. Square off a
   * page of ten, add an eleventh, and it arrives rounded — so every addition quietly undoes the
   * consistency you just pressed a button for, and you have to press it again forever. A new
   * block joining the majority is what somebody means by "my page is square".
   *
   * ⚠️ The MOST COMMON value, not the first block's. A page with one deliberate odd block out
   * would otherwise hand its oddity to everything added afterwards.
   */
  const prevailing = (key: string, fallback: string) => {
    const counts = new Map<string, number>()
    for (const b of blocks) {
      const v = typeof b.config?.[key] === 'string' ? (b.config[key] as string) : fallback
      counts.set(v, (counts.get(v) ?? 0) + 1)
    }
    let best = fallback
    let most = 0
    for (const [v, n] of counts) if (n > most) [best, most] = [v, n]
    return best === fallback ? null : best
  }

  const addBlock = (type: ProfileBlock['block_type']) => {
    // Straight into editing it: you added a block because you have something to put in it.
    setOpenIdx(blocks.length)
    setAdding(false)
    const inherited: Record<string, unknown> = {}
    for (const [key, dflt] of [
      ['font', 'page'],
      ['shape', 'round'],
      ['edge', 'plain'],
    ] as const) {
      const v = prevailing(key, dflt)
      if (v) inherited[key] = v
    }
    setBlocks((b) => [
      ...b,
      {
        block_type: type,
        size: 'medium',
        config: inherited,
        visibility: defaultTier(type),
      },
    ])
  }

  /**
   * Fill the page from a starting point.
   *
   * ⚠️ THE SAME UNDO REMOVING A BLOCK USES. This replaces everything, which is the only other
   * action here that can lose work — so it gets the same way back, and it is offered rather than
   * confirmed through a dialog, because a dialog asks you to predict what a layout looks like
   * while a way back lets you simply look.
   */
  const applyStarter = (st: Starter) => {
    if (st.page) changePage(st.page, `the ${st.name} layout`)
    setOpenIdx(null)
    setLiftIdx(null)
    setAdding(false)
    setBlocks(
      st.blocks.map((b) => ({
        block_type: b.type,
        size: b.size,
        config: b.alone ? { alone: true } : {},
        visibility: defaultTier(b.type),
      })),
      `the ${st.name} layout`,
    )
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
    }, `moving ${BLOCK_LABEL[blocks[from].block_type]}`)
  }
  const setAloneAt = (i: number, alone: boolean) =>
    setBlocks((all) =>
      all.map((x, idx) =>
        idx === i ? { ...x, config: { ...x.config, alone: alone || undefined } } : x,
      ),
    )

  /**
   * The same choice, on every block at once.
   *
   * ⚠️ A PRESS, NOT AN INHERITED DEFAULT, and the difference is what keeps this simple. A
   * page-level default means every reader has to resolve "the block's value, or the page's, or
   * the built-in", and every block needs a third state meaning "not set" that looks identical to
   * the default until the page changes under it. Writing the value onto each block instead means
   * there is one place a block's look comes from — its own config — and "make the page
   * consistent" is a thing you do rather than a rule the code enforces forever.
   *
   * Overriding one afterwards is then just editing that one, which is what anybody would expect
   * and is the part an inheritance system makes surprising.
   */
  const setEveryCfg = (patch: Record<string, unknown>) =>
    setBlocks(
      (all) => all.map((x) => ({ ...x, config: { ...x.config, ...patch } })),
      'that look everywhere',
    )

  /** merge into the open block's config — shared, because two rows of the inspector write it */
  const setOpenCfg = (patch: Record<string, unknown>, label?: string) =>
    setBlocks(
      (all) =>
        all.map((x, idx) => (idx === openIdx ? { ...x, config: { ...x.config, ...patch } } : x)),
      label ?? Object.keys(patch)[0] ?? 'that change',
    )

  const setSizeAt = (i: number, size: ProfileBlock['size']) =>
    setBlocks((all) => all.map((x, idx) => (idx === i ? { ...x, size } : x)), 'the width')

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= blocks.length) return
    // The open block travels with its content. Rows are keyed by position, so without this
    // moving a block would leave the panel open on whatever swapped into its old slot.
    setOpenIdx((cur) => (cur === i ? j : cur === j ? i : cur))
    /* ⚠️ NAMED, like every other step. It was the generic "that change" for as long as moving
       meant finding a grip and pressing an arrow on it — rare enough that nobody had to check
       what Undo was about to take back. The keyboard makes it the easiest thing on the page to
       do by accident, so it now says which block it would put back. A held key coalesces into
       one step, which is right: you want the block where it started, not one hop back. */
    setBlocks((b) => {
      const next = [...b]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    }, `moving ${BLOCK_LABEL[blocks[i].block_type]}`)
  }
  /**
   * Removing is the one thing here that can lose work, and it now persists on its own — so it
   * is the one thing that keeps an explicit way back rather than an explicit way forward.
   */
  /**
   * One more of that, exactly as it is.
   *
   * ⚠️ THE WAY PEOPLE ACTUALLY BUILD A PAGE, once anything on it looks right. Getting a bio
   * to a serif, huge, centred, square, wine-tinted panel takes seven decisions; wanting a second
   * one below it should take zero, and without this it took seven more and they would not quite
   * match. It lands NEXT to its original rather than at the end, because a copy belongs beside
   * the thing it was copied from — finding it at the bottom of a long page is the same journey
   * arrange mode exists to remove.
   *
   * ⚠️ The id is dropped. It names a row the server owns; a copy is a new block and asking
   * for it to be saved under the original's name is asking for one of them to disappear.
   */
  const duplicateAt = (i: number) => {
    if (blocks.length >= 20) return
    const src = blocks[i]
    const copy: ProfileBlock = {
      block_type: src.block_type,
      size: src.size,
      config: JSON.parse(JSON.stringify(src.config ?? {})),
      visibility: src.visibility,
    }
    setOpenIdx(i + 1)
    setBlocks(
      (all) => [...all.slice(0, i + 1), copy, ...all.slice(i + 1)],
      `copying ${BLOCK_LABEL[src.block_type]}`,
    )
  }

  const takeLook = (i: number) => {
    const cfg = blocks[i]?.config ?? {}
    const look: Record<string, unknown> = {}
    /* ⚠️ Absent keys are carried as null rather than skipped, or pasting a plain look onto a
       decorated block would leave the decoration behind and produce a third thing neither block
       had. "Make it look like that one" includes the parts where that one is plain. */
    for (const k of LOOK_KEYS) look[k] = cfg[k] ?? null
    setHeldLook(look)
    setLiftIdx(null)
  }

  const giveLook = (i: number) => {
    if (!heldLook) return
    setBlocks(
      (all) =>
        all.map((x, idx) => (idx === i ? { ...x, config: { ...x.config, ...heldLook } } : x)),
      'that look',
    )
  }

  const removeAt = (i: number) => {
    const gone = blocks[i]
    setOpenIdx((cur) => (cur === i ? null : cur != null && cur > i ? cur - 1 : cur))
    setBlocks(
      (all) => all.filter((_, idx) => idx !== i),
      `removing ${BLOCK_LABEL[gone.block_type]}`,
    )
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
     * ⚠️ AND THE PAGE AS A WHOLE, checked here for the same reason and in the same breath: the
     * server refuses the entire payload either way, so finding out from it means one over-full
     * page stops every later edit saving with a message about nothing in particular. The two
     * limits say different things and so does this — the block one is "this block holds too
     * much", and this one is "everything together is too much", which is fixed by taking a
     * different thing out.
     */
    const weight = blocks.reduce((n, b) => n + configSize(b.config), 0)
    if (weight > PROFILE_LIMIT) {
      setBlocked(null)
      setErr('the page holds too much altogether — take something out of one of the blocks')
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

  /**
   * ⚠️ The shortcut everybody's hands already know, and it has to not fire while they are
   * typing — a textarea has its own undo, and stealing it mid-sentence would throw away a
   * paragraph to get back a colour.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return
      const el = e.target as HTMLElement | null
      const tag = el?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable) return
      e.preventDefault()
      if (e.shiftKey) stepForward()
      else stepBack()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [stepBack, stepForward])

  /**
   * ⚠️ ESCAPE IS THE ONE THAT BELONGS ON THE WINDOW. Holding a look and holding a block are
   * MODES — while one is on, every block on the page means something different — and the way out
   * of a mode cannot depend on where the focus happens to have landed. Both have a Cancel button
   * on their hint, and both hints are below the page they are about, which is the wrong end of a
   * long page from wherever you just decided against it.
   *
   * One press is one step out: put down what is held before letting go of what is picked.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const el = e.target as HTMLElement | null
      const tag = el?.tagName
      /* a field gets Escape for its own reasons, and cancelling the page's mode from inside a
         half-typed bio is not what that press meant */
      if (tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable) return
      if (heldLook) setHeldLook(null)
      else if (liftIdx != null) setLiftIdx(null)
      else setOpenIdx(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [heldLook, liftIdx])

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
          {arranging
            ? 'Every block, small enough to see at once. Move them around, then go back to filling them in.'
            : 'This is the page itself, at the widths it really uses. Click a block to change what is in it, drag the handle to move it.'}
        </p>
        {/* ⚠️ Only worth offering once there is something to arrange. One block has no order. */}
        {/* ⚠️ NAMED, not just arrows. "Undo" is a promise you have to take on trust; "Undo
            colour" is one you can check before you press it, which is the difference between
            being able to experiment and being willing to. */}
        <button
          className="btn btn-ghost"
          onClick={stepBack}
          disabled={!past.length}
          title={past.length ? `Undo ${past[past.length - 1].label}` : 'Nothing to undo yet'}
        >
          ↶ Undo{past.length ? ` ${past[past.length - 1].label}` : ''}
        </button>
        {future.length > 0 && (
          <button
            className="btn btn-ghost"
            onClick={stepForward}
            title={`Redo ${future[future.length - 1].label}`}
          >
            ↷ Redo
          </button>
        )}
        {!arranging && (
          <button
            className={'btn' + (starters ? ' is-on' : '')}
            aria-pressed={starters}
            onClick={() => setStarters((v) => !v)}
            title={
              blocks.length
                ? 'Replace the page with a starting point — you can undo it'
                : 'Fill the page with a starting point instead of building it up block by block'
            }
          >
            ▦ {blocks.length ? 'Start over from a layout' : 'Start from a layout'}
          </button>
        )}
        {/**
         * ⚠️ WORTH OFFERING ONLY BECAUSE UNDO EXISTS. Seven shapes, five edges, thirteen tints,
         * seven faces, eight patterns, five tilts and nine page shapes is a space nobody clicks
         * their way through — and a button that changed all of it with no way back would be a
         * button nobody dared press. It costs one keystroke to reject, which is what makes the
         * space worth having at all.
         */}
        {!arranging && blocks.length > 0 && onPage && (
          <button
            className="btn"
            title="Roll a whole look for the page — undo puts it back"
            onClick={() => {
              const rolled = surpriseMe(blocks.length)
              /* ⚠️ One step for both halves: changePage records it, and setBlocks coalesces into
                 that entry on the same label rather than filing a second. Two steps would mean
                 Undo had to be pressed twice to take back one press. */
              changePage(rolled.page, 'the surprise')
              setBlocks(
                (all) =>
                  all.map((b, i) => ({ ...b, config: { ...b.config, ...rolled.blocks[i] } })),
                'the surprise',
              )
            }}
          >
            🎲 Surprise me
          </button>
        )}
        {/**
         * ⚠️ THE PAGE'S OWN SHAPE, and the only setting here that is not about one block. It
         * lives in the head rather than in a block's inspector because there is no block it
         * belongs to — putting it on whichever one happened to be selected would make it look
         * like that block's setting and be found by nobody.
         */}
        {onPage && (
          <span className="profile-pageshape">
            <span className="muted">Page</span>
            {PAGE_WIDTHS.map((w) => (
              <button
                key={w.id}
                className={'btn' + (readPageStyle(page).width === w.id ? ' is-on' : '')}
                aria-pressed={readPageStyle(page).width === w.id}
                onClick={() =>
                  changePage({ width: w.id, gap: readPageStyle(page).gap }, 'the page width')
                }
              >
                {w.label}
              </button>
            ))}
            {PAGE_GAPS.map((g) => (
              <button
                key={g.id}
                className={'btn' + (readPageStyle(page).gap === g.id ? ' is-on' : '')}
                aria-pressed={readPageStyle(page).gap === g.id}
                onClick={() =>
                  changePage({ width: readPageStyle(page).width, gap: g.id }, 'the spacing')
                }
              >
                {g.label}
              </button>
            ))}
          </span>
        )}
        {blocks.length > 1 && (
          <button
            className={'btn' + (arranging ? ' is-on' : '')}
            aria-pressed={arranging}
            onClick={() => {
              setArranging((v) => !v)
              setLiftIdx(null)
            }}
            title={
              arranging
                ? 'Back to the real page, with everything in it'
                : 'Shrink every block so the whole arrangement fits on one screen'
            }
          >
            {arranging ? '✓ Done arranging' : '⇅ Arrange'}
          </button>
        )}
      </div>

      {/**
       * ⚠️ OPEN BY ITSELF ON AN EMPTY PAGE, because that is the only moment somebody has no way
       * to picture what they are being asked to build. Once there are blocks it is a button,
       * since by then choosing one throws work away.
       */}
      {(starters || !blocks.length) && !arranging && (
        <div className="profile-starters">
          <p className="muted profile-starters-lead">
            {blocks.length
              ? 'Pick one and the page becomes it. What you have now is one press from coming back.'
              : 'Start from one of these and change anything you like — or add blocks one at a time below.'}
          </p>
          <div className="profile-starters-row">
            {STARTERS.map((st) => (
              <button
                key={st.id}
                className="btn profile-starter"
                onClick={() => {
                  applyStarter(st)
                  setStarters(false)
                }}
              >
                <strong>{st.name}</strong>
                <span className="muted">{st.about}</span>
                {/* ⚠️ The SHAPE, at the same widths the layout uses. A list of block names is a
                    list of words; the thing being chosen is an arrangement. */}
                <span className="profile-starter-shape" aria-hidden>
                  {st.blocks.map((b, i) => (
                    <i key={i} className={'is-' + b.size} />
                  ))}
                </span>
                <span className="profile-starter-count">{st.blocks.length} blocks</span>
              </button>
            ))}
            {blocks.length > 0 && (
              <button className="btn btn-ghost" onClick={() => setStarters(false)}>
                Cancel
              </button>
            )}
          </div>
        </div>
      )}

      {/**
       * ⚠️ A SHORTCUT IS THE ONE CONTROL A TOOLTIP CANNOT TEACH, because the thing you would
       * hover to learn it is the thing it exists to save you reaching for. So it is written
       * down, once, immediately above the grid it works on — and only where there is a keyboard,
       * since on a phone this is four lines of instructions for keys that are not there.
       */}
      {!touch && (
        <p className="muted profile-keys">
          <kbd>←</kbd> <kbd>→</kbd> pick a block · <kbd>Shift</kbd> and an arrow moves it ·{' '}
          <kbd>Delete</kbd> removes it · <kbd>Esc</kbd> backs out
        </p>
      )}

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
        ref={gridRef}
        className={'profile-blocks-grid profile-canvas' + (arranging ? ' is-arranging' : '')}
        {...pageStyleAttrs(page)}
        /**
         * ⚠️ ON THE GRID, NOT ON THE WINDOW, and that is the whole reason this works. The site
         * already pages between sections from a window listener of its own, so a second window
         * listener here would move the selection AND leave the page — and it would lose, because
         * the site's listener is mounted first and has already run by the time this one could
         * prevent anything. Handling the press where it starts and stopping it there is the only
         * version that can win. It is the same trick the grip's note describes.
         *
         * ⚠️ SHIFT MOVES THE BLOCK, and Alt does not, which is the opposite of the editor
         * idiom most hands know. Alt+Left and Alt+Right are the browser's own Back and Forward:
         * preventDefault does stop them, but a page editor where one mis-timed press can navigate
         * away from unsaved work is not worth matching an idiom for.
         */
        onKeyDown={(e) => {
          if (e.ctrlKey || e.metaKey || e.altKey) return
          /* ⚠️ THE EDITOR RENDERS THE REAL BLOCKS, so a block can contain a text field — the
             guestbook has one, and it is inside this grid. Without this, typing a message and
             correcting a typo would delete the guestbook: Backspace would bubble out of the
             input, find a cell around it, and mean something else entirely. */
          const el = e.target as HTMLElement
          const tag = el.tagName
          if (tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable) return
          const cell = el.closest('[data-cell]')
          const i = cell ? Number(cell.getAttribute('data-cell')) : NaN
          if (!Number.isInteger(i) || i < 0 || i >= blocks.length) return

          const step = ARROW_STEP[e.key]
          if (step) {
            const j = i + step
            if (j < 0 || j >= blocks.length) return
            e.preventDefault()
            e.stopPropagation()
            if (e.shiftKey) move(i, step)
            else setOpenIdx(j)
            focusCell(j)
            return
          }
          if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault()
            e.stopPropagation()
            removeAt(i)
            /* whatever slides into the gap — or the new last block, when the gap was the end */
            focusCell(Math.min(i, blocks.length - 2))
          }
        }}
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
            /* the editor shows the page, so a colour has to show up here as you pick it */
            {...blockLookAttrs(b.config, username)}
          >
            <button
              type="button"
              className="profile-canvas-pick"
              aria-pressed={openIdx === i}
              aria-label={'Edit ' + BLOCK_LABEL[b.block_type]}
              onClick={() => {
                /* holding something? this is where it goes. Otherwise open it as before. */
                if (heldLook) {
                  giveLook(i)
                  setHeldLook(null)
                  return
                }
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
                  className="btn profile-tool-wide"
                  title="A third of the width"
                  aria-pressed={b.size === 'small'}
                  onClick={() => setSizeAt(i, 'small')}
                >
                  ▮
                </button>
                <button
                  className="btn profile-tool-wide"
                  title="Half the width"
                  aria-pressed={b.size === 'medium'}
                  onClick={() => setSizeAt(i, 'medium')}
                >
                  ▮▮
                </button>
                <button
                  className="btn profile-tool-wide"
                  title="The whole width"
                  aria-pressed={b.size === 'large'}
                  onClick={() => setSizeAt(i, 'large')}
                >
                  ▮▮▮
                </button>
                <button
                  className={'btn profile-tool-wide' + (blockAlone(b) ? ' is-on' : '')}
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
                  className="btn"
                  title="Copy how this one looks, then tap another block to give it the same"
                  aria-pressed={!!heldLook}
                  onClick={() => takeLook(i)}
                >
                  🎨
                </button>
                <button
                  className="btn"
                  title={'Make another ' + BLOCK_LABEL[b.block_type] + ' just like this one'}
                  disabled={blocks.length >= 20}
                  onClick={() => duplicateAt(i)}
                >
                  ⧉
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
                const step = ARROW_STEP[e.key]
                if (!step) return
                e.preventDefault()
                e.stopPropagation()
                move(i, step)
              }}
            >
              ⠿
            </span>
            {arranging ? (
              /* ⚠️ The LABEL, not the block. Rendering the real thing shorter would still mount
                 every canvas, every audio graph and every visualiser on the page — the cost of
                 the full editor is exactly what makes a long page unpleasant to rearrange. */
              <div className="profile-block profile-canvas-tile">
                <strong>{BLOCK_LABEL[b.block_type]}</strong>
                {/* ⚠️ Arrange mode is where a page gets sorted into sections, so a tile that
                    does not say which one it is in is the one thing you cannot sort by. */}
                {blockTab(b) && <span className="profile-canvas-tab">{blockTab(b)}</span>}
                {blockKeepEmpty(b.config) && <span className="muted">blank on purpose</span>}
                {isBlockEmpty(b) && <span className="muted">empty</span>}
              </div>
            ) : isBlockEmpty(b) ? (
              <div className="profile-block profile-canvas-empty">
                <strong>{BLOCK_LABEL[b.block_type]}</strong>
                <span className="muted">Nothing in this one yet — click to fill it in.</span>
              </div>
            ) : (
              <BlockView
                block={b}
                activity={activity}
                trophies={trophies}
                achievements={achievements}
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

      {heldLook && (
        /* ⚠️ the same shape as the lift hint below, because it is the same mode: something is
           held, every other block is somewhere to put it, and nothing on screen says so */
        <p className="profile-lift-hint">
          Holding a look — tap a block to give it the same
          <button className="btn btn-ghost" onClick={() => setHeldLook(null)}>
            Cancel
          </button>
        </p>
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
      {/* ⚠️ Not while arranging. The tray is for what is IN a block, and it covers a third of
          the screen — the one thing arrange mode exists to keep whole. The width and remove
          buttons are on the tile itself, and those are the only settings this job needs. */}
      {selected &&
        !arranging &&
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
          <div className={'profile-inspector is-' + anchor + (trayOpen ? ' is-open' : ' is-shut')}>
            <div className="profile-inspector-head">
              {/* ⚠️ a tray you have to hit a small chevron to close is a tray that stays open and
                  covers the thing you are editing, so the pull is a proper target */}
              <button
                className="btn btn-ghost profile-inspector-pull"
                onClick={() => setTrayOpen((v) => !v)}
                aria-expanded={trayOpen}
                title={trayOpen ? 'Slide these out of the way' : 'Bring the settings back'}
              >
                {trayOpen ? '▾' : '▴'}
              </button>
              <strong>{BLOCK_LABEL[selected.block_type]}</strong>
              <span className="profile-inspector-side">
                {(['left', 'right'] as const).map((side) => (
                  <button
                    key={side}
                    className={'btn' + (anchor === side ? ' is-on' : '')}
                    aria-pressed={anchor === side}
                    onClick={() => anchorTo(side)}
                    title={'Move these settings to the ' + side}
                  >
                    {side === 'left' ? '⇤' : '⇥'}
                  </button>
                ))}
              </span>
              <button
                className="btn btn-ghost"
                onClick={() => setOpenIdx(null)}
                aria-label="Close this block"
              >
                Done
              </button>
            </div>
            {/**
             * ⚠️ THE BODY IS NOT RENDERED WHILE THE TRAY IS SHUT, rather than hidden by CSS.
             *
             * Collapsing it with a transform and then with a max-height both failed here —
             * something in the cascade was defeating rules that were more specific and later,
             * and hunting it would have cost more than it was worth. Not rendering cannot be
             * overridden by any stylesheet, does not depend on a transform surviving a
             * reduced-motion setting, and has the honest side effect of taking the settings out
             * of the tab order while they are out of the way.
             */}
            {trayOpen && (
              <>
                <BlockFields
                  block={selected}
                  username={username}
                  onChange={(next) =>
                    setBlocks((all) => all.map((x, idx) => (idx === openIdx ? next : x)))
                  }
                />

                {/**
                 * ⚠️ EVERY BLOCK TYPE, unlike the colour below it.
                 *
                 * CAN_TINT leaves out the three whose card is entirely filled by their own
                 * artwork — a banner, a drawing, a visualiser — because a tint has nowhere to go
                 * on them. Shape is the opposite case: those three ARE the rectangle, so squaring
                 * one off is the most visible thing on the page, and gating it behind the colour
                 * rule would have hidden it exactly where it does the most.
                 */}
                {/**
                 * ⚠️ WHICH SECTION IT IS IN, as a name you type rather than a list you manage.
                 *
                 * Typing the same word on two blocks is what makes a section — there is no "new
                 * tab" button, nothing to create before it can be used and nothing left over when
                 * the last block leaves. The datalist offers the names already in use so the
                 * second block is a pick rather than a spelling test, which is the only part of
                 * free text that actually goes wrong here.
                 */}
                <div className="profile-editrow-settings">
                  <label className="profile-editrow-look">
                    <span className="muted">Section</span>
                    <input
                      list="profile-tab-names"
                      value={blockTab(selected)}
                      placeholder="Page"
                      maxLength={24}
                      onChange={(e) => setOpenCfg({ tab: e.target.value.trim() || null })}
                    />
                    <datalist id="profile-tab-names">
                      {tabsOf(blocks).map((t) => (
                        <option key={t} value={t} />
                      ))}
                    </datalist>
                  </label>
                </div>

                {/* ⚠️ WHAT THIS BLOCK IS CALLED, for the four types that print a heading.
                    Placeholder shows the default, so leaving it empty is a visible choice rather
                    than a blank that might mean anything. */}
                {HAS_HEADING.has(selected.block_type) && (
                  <div className="profile-editrow-settings">
                    <label className="profile-editrow-look">
                      <span className="muted">Heading</span>
                      <input
                        value={blockHeading(selected.config) ?? ''}
                        placeholder={BLOCK_LABEL[selected.block_type]}
                        maxLength={60}
                        onChange={(e) => setOpenCfg({ heading: e.target.value || null })}
                      />
                    </label>
                  </div>
                )}

                <div className="profile-editrow-settings">
                  <label className="profile-editrow-look">
                    <span className="muted">Type</span>
                    <span className="profile-width-row">
                      {BLOCK_FONTS.map((f) => (
                        <button
                          key={f.id}
                          className={'btn' + (blockFont(selected.config) === f.id ? ' is-on' : '')}
                          aria-pressed={blockFont(selected.config) === f.id}
                          /* ⚠️ the button is SET IN the face it sets — seven words in a row say
                             nothing about what a slab is */
                          style={f.stack ? { fontFamily: f.stack } : undefined}
                          onClick={() => setOpenCfg({ font: f.id === 'page' ? null : f.id })}
                        >
                          {f.label}
                        </button>
                      ))}
                    </span>
                  </label>
                  {/* ⚠️ One press to make the page agree with itself — see setEveryCfg. Offered
                      for the three that are about the page rather than about this block; a
                      heading or a section applied to everything would be nonsense. */}
                  <span className="profile-apply-all">
                    <button
                      className="btn btn-ghost"
                      title="Give every block on the page this type, shape and edge"
                      onClick={() =>
                        setEveryCfg({
                          font:
                            blockFont(selected.config) === 'page'
                              ? null
                              : blockFont(selected.config),
                          shape:
                            blockShape(selected.config) === 'round'
                              ? null
                              : blockShape(selected.config),
                          edge:
                            blockEdge(selected.config) === 'plain'
                              ? null
                              : blockEdge(selected.config),
                        })
                      }
                    >
                      Use this look everywhere
                    </button>
                  </span>
                </div>

                {/* ⚠️ ONLY WHERE THE WORDS ARE SOMEBODY'S OWN. A size and an alignment on a
                    trophy shelf or a visualiser would be two controls acting on nothing — these
                    style a run of text that was typed, which is the bio and the status. */}
                {HAS_OWN_WORDS.has(selected.block_type) && (
                  <div className="profile-editrow-settings">
                    <label className="profile-editrow-look">
                      <span className="muted">Words</span>
                      <span className="profile-width-row">
                        {TEXT_SIZES.map((t) => (
                          <button
                            key={t.id}
                            className={'btn' + (textSize(selected.config) === t.id ? ' is-on' : '')}
                            aria-pressed={textSize(selected.config) === t.id}
                            onClick={() =>
                              setOpenCfg({ textSize: t.id === 'normal' ? null : t.id })
                            }
                          >
                            {t.label}
                          </button>
                        ))}
                      </span>
                    </label>
                    <label className="profile-editrow-look">
                      <span className="muted">Sits</span>
                      <span className="profile-width-row">
                        {TEXT_ALIGNS.map((a) => (
                          <button
                            key={a.id}
                            className={
                              'btn' + (textAlign(selected.config) === a.id ? ' is-on' : '')
                            }
                            aria-pressed={textAlign(selected.config) === a.id}
                            onClick={() => setOpenCfg({ align: a.id === 'left' ? null : a.id })}
                          >
                            {a.label}
                          </button>
                        ))}
                      </span>
                    </label>
                    {/**
                     * ⚠️ THE ONE THAT MAKES BLANK SPACE POSSIBLE. With it on, a block with
                     * nothing typed in it is still a card — so a tint, a shape and a width become
                     * a band, a panel or a gap, and layouts nobody designed a block for can be
                     * built out of the blocks that already exist.
                     *
                     * Explicit rather than inferred from "it has a colour, so it is probably
                     * meant": an unfinished sentence and a deliberate panel look identical and
                     * mean opposite things, and a guess that is wrong either publishes a mistake
                     * or deletes an intention.
                     */}
                    <label className="inst-pick" style={{ display: 'flex', gap: '0.4rem' }}>
                      <input
                        type="checkbox"
                        checked={blockKeepEmpty(selected.config)}
                        onChange={(e) => setOpenCfg({ keep: e.target.checked || null })}
                      />
                      <span className="muted">Keep it on the page with no words in it</span>
                    </label>
                  </div>
                )}

                {/**
                 * ⚠️ NOT ON A BANNER, which has had its own picker for these since it was built —
                 * two pattern controls on one block, disagreeing about which pattern it wears, is
                 * worse than the feature is good.
                 *
                 * ⚠️ THE EIGHT THE BANNER ALREADY HAD, now reachable from every other block. They cost a
                 * style id to store rather than an image, which is the only reason a pattern can
                 * live inside a block's 16000-character config where a drawing cannot.
                 */}
                {selected.block_type !== 'banner' && (
                  <div className="profile-editrow-settings">
                    <label className="profile-editrow-look">
                      <span className="muted">Pattern</span>
                      <span className="profile-width-row">
                        <button
                          className={'btn' + (blockBackdrop(selected.config) ? '' : ' is-on')}
                          aria-pressed={!blockBackdrop(selected.config)}
                          onClick={() => setOpenCfg({ backdrop: null }, 'the pattern')}
                        >
                          None
                        </button>
                        {(Object.keys(BANNER_STYLES) as BannerStyle[]).map((id) => (
                          <button
                            key={id}
                            className={
                              'btn profile-backdrop-btn' +
                              (blockBackdrop(selected.config) === id ? ' is-on' : '')
                            }
                            aria-pressed={blockBackdrop(selected.config) === id}
                            title={BANNER_STYLES[id].label}
                            onClick={() => setOpenCfg({ backdrop: id }, 'the pattern')}
                            /* ⚠️ the chip wears the pattern in the hue this block would use, so the
                             choice is made by looking rather than by reading eight words */
                            style={{
                              backgroundImage: BANNER_STYLES[id].css(
                                typeof selected.config?.tint === 'number'
                                  ? (selected.config.tint as number)
                                  : hueFor(username),
                              ),
                            }}
                          >
                            <span className="sr-only">{BANNER_STYLES[id].label}</span>
                          </button>
                        ))}
                      </span>
                    </label>
                  </div>
                )}

                <div className="profile-editrow-settings">
                  <label className="profile-editrow-look">
                    <span className="muted">Edge</span>
                    <span className="profile-width-row">
                      {BLOCK_EDGES.map((ed) => (
                        <button
                          key={ed.id}
                          className={
                            'btn profile-edge-btn is-' +
                            ed.id +
                            (blockEdge(selected.config) === ed.id ? ' is-on' : '')
                          }
                          aria-pressed={blockEdge(selected.config) === ed.id}
                          onClick={() => setOpenCfg({ edge: ed.id === 'plain' ? null : ed.id })}
                        >
                          {ed.label}
                        </button>
                      ))}
                    </span>
                  </label>
                </div>

                <div className="profile-editrow-settings">
                  <label className="profile-editrow-look">
                    <span className="muted">Shape</span>
                    <span className="profile-width-row">
                      {BLOCK_SHAPES.map((sh) => (
                        <button
                          key={sh.id}
                          className={
                            'btn profile-shape-btn is-' +
                            sh.id +
                            (blockShape(selected.config) === sh.id ? ' is-on' : '')
                          }
                          aria-pressed={blockShape(selected.config) === sh.id}
                          onClick={() => setOpenCfg({ shape: sh.id === 'round' ? null : sh.id })}
                        >
                          {sh.label}
                        </button>
                      ))}
                    </span>
                  </label>
                  {/* ⚠️ Beside the shape, because it is the same question — what outline does this
                      have — and because a tilt is the one setting whose effect you cannot judge
                      from the control, only from the page behind it. */}
                  <label className="profile-editrow-look">
                    <span className="muted">Tilt</span>
                    <span className="profile-width-row">
                      {BLOCK_TILTS.map((t) => (
                        <button
                          key={t.id}
                          className={'btn' + (blockTilt(selected.config) === t.id ? ' is-on' : '')}
                          aria-pressed={blockTilt(selected.config) === t.id}
                          onClick={() => setOpenCfg({ tilt: t.id === 0 ? null : t.id }, 'the tilt')}
                        >
                          {t.label}
                        </button>
                      ))}
                    </span>
                  </label>
                </div>

                {/**
                 * ⚠️ COLOUR, AND WHAT THE COLOUR DOES — two rows, not one.
                 *
                 * A page was the same grey card eight times over. The swatch decides WHICH colour
                 * and the finish decides HOW MUCH of it, and they have to be separate: one row of
                 * "blue wash / blue outline / blue solid / green wash / ..." is thirty-six buttons
                 * saying the same two things badly.
                 *
                 * ⚠️ The finish row is not rendered at all while the block wears no colour.
                 * Greyed-out it would be three controls that look available and do nothing, which
                 * is the exact thing this page is being rid of.
                 */}
                {CAN_TINT.has(selected.block_type) &&
                  (() => {
                    const look = blockLook(selected.config, username)
                    const setCfg = (patch: Record<string, unknown>) =>
                      setBlocks((all) =>
                        all.map((x, idx) =>
                          idx === openIdx ? { ...x, config: { ...x.config, ...patch } } : x,
                        ),
                      )
                    return (
                      <div className="profile-editrow-settings">
                        <label className="profile-editrow-look">
                          <span className="muted">Colour</span>
                          <span className="profile-tint-row">
                            <button
                              className={
                                'btn profile-tint-none' + (look.hue == null ? ' is-on' : '')
                              }
                              aria-pressed={look.hue == null}
                              title="No colour — a plain card"
                              onClick={() => setCfg({ tint: null })}
                            >
                              None
                            </button>
                            <button
                              className={
                                'btn profile-tint-mine' +
                                (selected.config?.tint === 'mine' ? ' is-on' : '')
                              }
                              aria-pressed={selected.config?.tint === 'mine'}
                              title="Your own colour — follows you if it ever changes"
                              onClick={() => setCfg({ tint: 'mine' })}
                            >
                              Mine
                            </button>
                            {TINT_HUES.map((h) => (
                              <button
                                key={h}
                                className={
                                  'profile-tint-swatch' +
                                  (selected.config?.tint === h ? ' is-on' : '')
                                }
                                aria-label={tintName(h)}
                                title={tintName(h)}
                                aria-pressed={selected.config?.tint === h}
                                style={{ ['--blk-h']: String(h) } as React.CSSProperties}
                                onClick={() => setCfg({ tint: h })}
                              />
                            ))}
                          </span>
                        </label>
                        {look.hue != null && (
                          <label className="profile-editrow-look">
                            <span className="muted">How much of it</span>
                            <span className="profile-width-row">
                              {BLOCK_FINISHES.map((f) => (
                                <button
                                  key={f.id}
                                  className={'btn' + (look.finish === f.id ? ' is-on' : '')}
                                  aria-pressed={look.finish === f.id}
                                  onClick={() => setCfg({ finish: f.id })}
                                >
                                  {f.label}
                                </button>
                              ))}
                            </span>
                          </label>
                        )}
                      </div>
                    )
                  })()}

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
                  {/**
                   * ⚠️ "ANYONE" CHANGED MEANING AND THE WORD DID NOT.
                   *
                   * While a profile could only be loaded by a member, the public tier was a
                   * ceiling something else enforced: "Anyone" honestly meant "any member", and
                   * everybody who ever picked it picked it under that meaning. Publishing a page
                   * makes the same word mean the open internet, for blocks chosen months ago
                   * against the old one. So the word is left alone — it is the right word — and
                   * what it currently reaches is said underneath it, where it can be true in both
                   * states instead of being a guess baked into a label.
                   */}
                  {selected.visibility === 'public' && (
                    <p className="muted" style={{ margin: 0, fontSize: '0.75rem' }}>
                      {pagePublic
                        ? '● Your page is published, so “Anyone” means anyone at all — signed in or not.'
                        : '“Anyone” means any member, until you publish your page in Account.'}
                    </p>
                  )}
                  <button className="btn btn-ghost" onClick={() => removeAt(openIdx)}>
                    Remove this block
                  </button>
                </div>
              </>
            )}
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
      </div>
    </div>
  )
}
