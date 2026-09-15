/**
 * What a person's page LOOKS like — their colour and their banner.
 *
 * Two problems this solves at once.
 *
 * 1. Every profile looked identical. The only visual identity was a first initial in a circle
 *    tinted `var(--accent)` — the SAME accent for everyone, because it's the site's colour, not
 *    theirs. Thirty-odd members, one look.
 * 2. The banner asked you to paste an image URL. The single banner anyone ever made has
 *    `url: "what"` saved in it — the field asked for something you can't guess, so it got a shrug
 *    and rendered nothing. Typing a URL is also the one customisation that can't be made safe or
 *    reliable: it loads a stranger's host (leaking every viewer's IP to it), and it 404s later.
 *
 * So: nothing is typed. A colour is DERIVED from who you are and is different for everyone before
 * anyone touches a setting, and a banner is PICKED from a set of generated looks. Both render from
 * CSS gradients alone — no uploads, no external requests, no storage, nothing to break.
 */

/** Stable small hash of a string — same input, same colour, on every device and every render. */
function hashOf(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h)
}

/**
 * Someone's own hue, derived from their username.
 *
 * Deterministic on purpose: it needs to be the same colour in the header, in a list and on
 * someone else's screen, without a lookup or a column. Derived rather than random so it never
 * changes under them either.
 *
 * ⚠️ QUANTISED TO 12 STOPS, not `hash % 360`. Raw hashes put real members 5° apart — measured
 * on the actual directory — and two hues that close don't read as "different colours", they read
 * as one colour rendered slightly wrong. With ~33 members you cannot hand out 33 distinguishable
 * hues anyway, so the honest choice is a repeat rather than a near-miss: any two people now
 * either clearly differ or plainly match.
 */
const HUE_STOPS = 12
export function hueFor(username: string): number {
  // offset so the stops aren't all dead-on primaries
  return (hashOf(username.toLowerCase()) % HUE_STOPS) * (360 / HUE_STOPS) + 15
}

/**
 * A second axis, so twelve hues don't mean twelve looks.
 *
 * Twelve stops across ~33 members collides constantly (three pairs in the first eight, measured).
 * Depth multiplies the distinct looks to 36 WITHOUT narrowing the hue gaps — the thing that made
 * raw hashes unreadable. Two people can still land identical; that's fine and honest. What this
 * avoids is the confusing middle ground.
 */
const DEPTHS = [
  { from: 62, to: 48 },
  { from: 52, to: 38 },
  { from: 42, to: 28 },
] as const

/**
 * The avatar circle's colours.
 *
 * Fixed high saturation rather than anything theme-derived: this circle carries white text in
 * both light and dark mode, so its contrast can't be allowed to drift with the palette. A
 * gradient rather than a flat fill because a flat circle of arbitrary hue looks like a default,
 * and this is meant to look chosen.
 */
export function avatarStyle(username: string): React.CSSProperties {
  const h = hueFor(username)
  // a different slice of the hash from the one picking the hue, so the two axes don't correlate
  const d = DEPTHS[Math.floor(hashOf(username.toLowerCase()) / 97) % DEPTHS.length]
  return {
    background: `linear-gradient(140deg, hsl(${h} 72% ${d.from}%), hsl(${(h + 40) % 360} 70% ${d.to}%))`,
    color: '#fff',
  }
}

/**
 * HOW THE PAGE IS LAID OUT, as opposed to how any block on it looks.
 *
 * ⚠️ THE AXIS ONLY RUNS ONE WAY. `.container` already caps every page at min(90rem, 100vw -
 * 2rem), so today's layout IS the wide one and there is nothing wider to offer. The three are
 * therefore column, page and wide — wide being exactly what every profile does now.
 *
 * ⚠️ SIX COLUMNS STAY SIX COLUMNS. The grid's own note argues for six because it divides by
 * two and three, so a block can be a half, a third, two thirds or the whole width and those
 * fractions mean the same thing at every size. Narrowing is a max-width, not fewer tracks: the
 * composition somebody arranged survives being read in a narrower column, and would not survive
 * being repacked into a different number of them.
 *
 * ⚠️ Clamped here as well as in set_my_page_style, because this is jsonb arriving from a
 * network payload and the reader cannot assume the writer was the only way in.
 */
export type PageWidth = 'column' | 'page' | 'wide'
export type PageGap = 'tight' | 'normal' | 'airy'
export type PageStyle = { width: PageWidth; gap: PageGap }

export const PAGE_WIDTHS: ReadonlyArray<{ id: PageWidth; label: string }> = [
  { id: 'column', label: 'Column' },
  { id: 'page', label: 'Page' },
  { id: 'wide', label: 'Wide' },
]

export const PAGE_GAPS: ReadonlyArray<{ id: PageGap; label: string }> = [
  { id: 'tight', label: 'Tight' },
  { id: 'normal', label: 'Normal' },
  { id: 'airy', label: 'Airy' },
]

export function readPageStyle(v: unknown): PageStyle {
  const o = (v ?? {}) as Record<string, unknown>
  const width = PAGE_WIDTHS.some((w) => w.id === o.width) ? (o.width as PageWidth) : 'wide'
  const gap = PAGE_GAPS.some((g) => g.id === o.gap) ? (o.gap as PageGap) : 'normal'
  return { width, gap }
}

/** The attributes a blocks grid needs to wear a page style, or nothing when it is the default. */
export function pageStyleAttrs(v: unknown): { 'data-page-w'?: PageWidth; 'data-page-g'?: PageGap } {
  const { width, gap } = readPageStyle(v)
  return {
    ...(width === 'wide' ? {} : { 'data-page-w': width }),
    ...(gap === 'normal' ? {} : { 'data-page-g': gap }),
  }
}

/**
 * A whole page, rolled.
 *
 * ⚠️ RANDOM IS NOT THE SAME AS SURPRISING, and getting that wrong is the difference between a
 * tool and a gimmick. Choosing every setting independently for every block gives twelve different
 * faces, twelve shapes and twelve hues — which is not a page anybody designed, it is noise, and
 * nobody keeps it. The combination space this rolls through is large precisely BECAUSE the
 * settings compose, so the roll has to compose them too.
 *
 * So it picks a small palette of decisions and then varies WITHIN it: one face for the page and
 * occasionally a second for emphasis, one shape with sometimes an accent shape, one edge, one
 * finish, and hues drawn from a family rather than from the whole wheel. What changes block to
 * block is which of those it got — which is roughly what a person does when they design one.
 *
 * ⚠️ IT IS SAFE TO PRESS BECAUSE UNDO EXISTS. This would have been a hostile button a day ago:
 * one press, every block changed, no way back. It costs one keystroke to reject now, and that is
 * the whole reason it is worth offering at all.
 */
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)]
const chance = (p: number) => Math.random() < p

export function surpriseMe(count: number): {
  page: PageStyle
  blocks: Array<Record<string, unknown>>
} {
  /* one hue family: a base and its neighbours, so two tinted blocks look related rather than
     like two people chose them */
  const baseIdx = Math.floor(Math.random() * TINT_HUES.length)
  const family = [0, 1, -1, 2].map(
    (d) => TINT_HUES[(baseIdx + d + TINT_HUES.length) % TINT_HUES.length],
  )

  const face = pick(BLOCK_FONTS.filter((f) => f.id !== 'page')).id
  const accentFace = chance(0.35) ? pick(BLOCK_FONTS.filter((f) => f.id !== 'page')).id : null
  const shape = pick(BLOCK_SHAPES).id
  const accentShape = chance(0.3) ? pick(BLOCK_SHAPES).id : null
  const edge = pick(BLOCK_EDGES).id
  const finish = pick(BLOCK_FINISHES).id
  /* a pattern on SOME blocks. On all of them it stops being an accent and becomes wallpaper */
  const pattern = chance(0.55) ? (Object.keys(BANNER_STYLES) as BannerStyle[]) : null
  const patternStyle = pattern ? pick(pattern) : null
  const tiltable = chance(0.4)

  const blocks: Array<Record<string, unknown>> = []
  for (let i = 0; i < count; i++) {
    blocks.push({
      font: accentFace && chance(0.25) ? accentFace : face,
      shape: accentShape && chance(0.3) ? accentShape : shape === 'round' ? null : shape,
      edge: edge === 'plain' ? null : edge,
      tint: chance(0.75) ? pick(family) : null,
      finish,
      backdrop: patternStyle && chance(0.4) ? patternStyle : null,
      tilt: tiltable && chance(0.35) ? pick([-2, -1, 1, 2]) : null,
    })
  }

  return {
    page: { width: pick(PAGE_WIDTHS).id, gap: pick(PAGE_GAPS).id },
    blocks,
  }
}

/**
 * Whether a viewer at one tier may see a block at another.
 *
 * ⚠️ A PREVIEW OF THE SERVER'S RULE, NOT A SECOND COPY OF IT. can_see() in Postgres decides
 * what anybody actually receives, and this decides nothing at all — it exists so an owner,
 * looking at their OWN page with every block already in hand, can be shown the subset somebody
 * else would have been sent. Nothing is protected by it and nothing may ever be.
 *
 * ⚠️ The ordering is by WIDTH, not by rank of person: 'public' is the widest audience and so
 * the lowest bar. A viewer clears a block when their own reach is at least as wide as the
 * audience the block was written for.
 */
const REACH: Record<Tier, number> = { public: 0, members: 1, friends: 2, private: 3 }

export type Tier = 'public' | 'friends' | 'members' | 'private'

export function tierSees(viewer: Tier, block: Tier): boolean {
  return REACH[block] <= REACH[viewer]
}

/**
 * WHAT ONE BLOCK WEARS.
 *
 * A page used to be the same grey card repeated eight times. Everything that made it yours —
 * your colour, your banner, your backdrop — was around the blocks, never in them, so two very
 * different people's pages read as the same page with different words in it.
 *
 * ⚠️ PICKED, NOT TYPED, and built from ONE hue like everything else here. That is not
 * timidity: a colour field lets somebody put grey text on a grey card and there is no undo for
 * a taste, whereas a swatch cannot produce a page that does not work. It is also why finishes
 * are a closed set — the wash, the outline and the solid panel are three different-in-kind
 * looks rather than three numbers to nudge.
 *
 * ⚠️ Stored in the block's own `config`, which is free-form jsonb the server already accepts
 * (the same reasoning as `alone`). No migration, nothing to run before this can be tried, and a
 * reader that does not know these keys ignores them.
 */
export type BlockFinish = 'soft' | 'edge' | 'solid'

export const BLOCK_FINISHES: ReadonlyArray<{ id: BlockFinish; label: string }> = [
  { id: 'soft', label: 'Wash' },
  { id: 'edge', label: 'Outline' },
  { id: 'solid', label: 'Solid' },
]

/**
 * WHAT SHAPE ONE BLOCK IS.
 *
 * ⚠️ Every block on every page has been the same 12px-rounded rectangle since the first one,
 * which is the single strongest reason a profile reads as a template even after its owner has
 * chosen colours, finishes, widths and a banner. Colour says whose page it is; shape says what
 * KIND of page it is, and there was only ever one kind.
 *
 * ⚠️ DIFFERENT IN KIND, not a radius slider — the same rule the finishes follow and for the
 * same reason. Four shapes that read as four decisions beat a number that produces five hundred
 * pages differing by two pixels, and none of these can produce a block that does not work.
 *
 * ⚠️ INDEPENDENT OF COLOUR, unlike the finish, which is a way of wearing a hue and means
 * nothing without one. A square grey card is a perfectly good thing to want, so this applies
 * whether or not a tint was picked — see blockLookAttrs, which used to return nothing at all for
 * an untinted block.
 */
export type BlockShape = 'round' | 'square' | 'pillow' | 'cut' | 'leaf' | 'arch' | 'pill'

export const BLOCK_SHAPES: ReadonlyArray<{ id: BlockShape; label: string }> = [
  { id: 'round', label: 'Rounded' },
  { id: 'square', label: 'Square' },
  { id: 'pillow', label: 'Pillow' },
  { id: 'cut', label: 'Cut' },
  /* ⚠️ The three added later are ASYMMETRIC, which is the point of adding them: four symmetric
     shapes differ only in how round they are, and a page of them still reads as a page of cards.
     A leaf and an arch have a top and a bottom, so two of them side by side look composed rather
     than repeated. */
  { id: 'leaf', label: 'Leaf' },
  { id: 'arch', label: 'Arch' },
  { id: 'pill', label: 'Pill' },
]

/**
 * HOW A BLOCK SITS ON THE PAGE — its edge and its shadow, as one choice.
 *
 * ⚠️ A SEPARATE AXIS FROM THE FINISH, which is about a colour: wash, outline and solid are
 * three ways of wearing a hue and all three are unavailable on a block with no hue. This is about
 * the card itself and applies to every block whether or not it is tinted — the same reasoning
 * that put shape outside the colour gate.
 *
 * ⚠️ ONE CHOICE RATHER THAN A BORDER CONTROL AND A SHADOW CONTROL. Border weight and
 * elevation are not independent in practice: a heavy border with a big shadow is two competing
 * claims about where the edge of the card is, and offering them separately mostly produces that.
 * Four ways a card can sit, each internally consistent.
 */
export type BlockEdge = 'plain' | 'hair' | 'heavy' | 'lift' | 'inset'

export const BLOCK_EDGES: ReadonlyArray<{ id: BlockEdge; label: string }> = [
  { id: 'plain', label: 'Plain' },
  { id: 'hair', label: 'Hairline' },
  { id: 'heavy', label: 'Heavy' },
  { id: 'lift', label: 'Lifted' },
  { id: 'inset', label: 'Inset' },
]

/**
 * WHAT A BLOCK IS SET IN.
 *
 * ⚠️ SYSTEM STACKS, NOT WEBFONTS, and that is a decision rather than a shortcut. A webfont is
 * a download before the page can be read correctly, a flash while it arrives, and a third party
 * watching who loaded it — three costs paid by every visitor to every page, for a choice one
 * person made once. These are faces already on the machine, so a page set in one renders in the
 * first frame, offline, with nobody told about it.
 *
 * ⚠️ The trade is honest and worth stating: a stack resolves to different actual faces on
 * Windows, a Mac and a phone. What survives everywhere is the CHARACTER — a serif stays a serif,
 * a slab stays heavy, mono stays fixed-width — which is what the choice is really about. A page
 * that must be identical on every machine cannot be built out of type at all without paying the
 * costs above.
 *
 * ⚠️ DIFFERENT IN KIND, the same rule the shapes and edges follow. Seven faces that read as
 * seven decisions, not a dropdown of every family installed.
 */
export type BlockFont = 'page' | 'serif' | 'slab' | 'mono' | 'round' | 'grotesk' | 'condensed'

export const BLOCK_FONTS: ReadonlyArray<{ id: BlockFont; label: string; stack: string }> = [
  { id: 'page', label: 'Page', stack: '' },
  {
    id: 'serif',
    label: 'Serif',
    stack: "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, 'Times New Roman', serif",
  },
  {
    id: 'slab',
    label: 'Slab',
    stack: "Rockwell, 'Roboto Slab', 'Bookman Old Style', Georgia, serif",
  },
  { id: 'mono', label: 'Mono', stack: "'Courier New', ui-monospace, SFMono-Regular, monospace" },
  {
    id: 'round',
    label: 'Rounded',
    stack:
      "'SF Pro Rounded', ui-rounded, 'Segoe UI Variable', 'Trebuchet MS', system-ui, sans-serif",
  },
  {
    id: 'grotesk',
    label: 'Grotesk',
    stack: "'Helvetica Neue', Helvetica, Arial, 'Liberation Sans', sans-serif",
  },
  {
    id: 'condensed',
    label: 'Condensed',
    stack:
      "'Haettenschweiler', 'Arial Narrow', 'Liberation Sans Narrow', 'Avenir Next Condensed', sans-serif",
  },
]

/**
 * HOW BIG THE WORDS ARE, and which way they sit.
 *
 * ⚠️ THIS IS WHAT TURNS A BIO INTO A FREEFORM BLOCK, which is why it exists rather than a new
 * block type. A new type means a migration before anything can be tried, and the bio is already
 * a box of text you write — the only reason it could not be a pull quote, a title card or a
 * three-word statement was that its type was fixed at one size, left-aligned. With a face, a
 * size and an alignment it is all of those, and somebody can put several on a page.
 *
 * ⚠️ Four sizes rather than a number, for the reason every other control here gives: a
 * slider produces five hundred pages differing by a pixel, and one of the five hundred is
 * unreadable.
 */
export type TextSize = 'normal' | 'small' | 'big' | 'huge'
export type TextAlign = 'left' | 'center' | 'right'

export const TEXT_SIZES: ReadonlyArray<{ id: TextSize; label: string; em: number }> = [
  { id: 'small', label: 'Small', em: 0.85 },
  { id: 'normal', label: 'Normal', em: 1 },
  { id: 'big', label: 'Big', em: 1.5 },
  { id: 'huge', label: 'Huge', em: 2.4 },
]

export const TEXT_ALIGNS: ReadonlyArray<{ id: TextAlign; label: string }> = [
  { id: 'left', label: '☰ Left' },
  { id: 'center', label: '☲ Centre' },
  { id: 'right', label: '☱ Right' },
]

export function textSize(config: Record<string, unknown> | null | undefined): TextSize {
  const v = config?.textSize
  return v === 'small' || v === 'big' || v === 'huge' ? v : 'normal'
}

export function textAlign(config: Record<string, unknown> | null | undefined): TextAlign {
  const v = config?.align
  return v === 'center' || v === 'right' ? v : 'left'
}

/**
 * A block that is MEANT to be empty.
 *
 * ⚠️ BLANK SPACE IS A DESIGN ELEMENT, and until now the page would not let anybody have any.
 * A bio and a status with nothing typed in them render as nothing at all — correct, because an
 * unfinished block showing a visitor an empty box is the failure this whole file keeps being
 * about. But it also means a tinted band, a coloured panel, a gap that pushes the next thing
 * onto its own line, and every layout built out of those, are impossible to ask for. The blocks
 * already have a colour, a shape, an edge and a width; the only thing stopping one being used as
 * a shape on a page was that it insisted on holding words first.
 *
 * ⚠️ SO IT IS EXPLICIT, rather than inferred from "it has a tint, so probably deliberate".
 * The two states look identical on screen and mean opposite things — one is somebody's design
 * and the other is somebody's unfinished sentence — and a guess that is wrong either publishes
 * a mistake or deletes an intention. A person pressing a switch cannot be misread.
 */
export function blockKeepEmpty(config: Record<string, unknown> | null | undefined): boolean {
  return config?.keep === true
}

/** The inline style a run of somebody's own words wears. */
export function textStyle(config: Record<string, unknown> | null | undefined): React.CSSProperties {
  const em = TEXT_SIZES.find((t) => t.id === textSize(config))?.em ?? 1
  return {
    fontSize: em === 1 ? undefined : `${em}em`,
    /* ⚠️ Big type needs tighter leading or it reads as separate lines rather than a phrase —
       the default 1.5 that suits body copy looks broken at 2.4em. */
    lineHeight: em >= 1.5 ? 1.15 : undefined,
    textAlign: textAlign(config),
  }
}

/**
 * A PATTERN BEHIND A BLOCK, from the same eight the banner already draws.
 *
 * ⚠️ REUSED, NOT INVENTED. aurora, dusk, rays, grid, bands, bubbles, rings and ember are
 * already written, already built from one hue so every one works in every colour, and already
 * deliberately different in kind rather than eight gradients. They were reachable by exactly one
 * block type, which is the whole reason a page could only be as varied as its cards were
 * coloured.
 *
 * ⚠️ AND THEY COST NOTHING TO STORE. A style id and the hue the block already has — no image,
 * no upload, nothing counted against the 16000-character cap a block's config lives under. That
 * cap is why a drawing cannot be a background here and a pattern can.
 *
 * ⚠️ THE HUE IS THE BLOCK'S OWN when it has one, so a pattern is not a second colour decision
 * fighting the first. A block with no tint falls back to its owner's colour, which is what the
 * banner has always done.
 */
export function blockBackdrop(
  config: Record<string, unknown> | null | undefined,
): BannerStyle | null {
  const v = config?.backdrop
  return isBannerStyle(v) ? v : null
}

/** A block's face, defaulting to whatever the page is set in. */
export function blockFont(config: Record<string, unknown> | null | undefined): BlockFont {
  const v = config?.font
  const hit = BLOCK_FONTS.find((f) => f.id === v)
  return hit && hit.id !== 'page' ? hit.id : 'page'
}

/** A block's edge, defaulting to whatever the card already looked like. */
export function blockEdge(config: Record<string, unknown> | null | undefined): BlockEdge {
  const v = config?.edge
  return v === 'hair' || v === 'heavy' || v === 'lift' || v === 'inset' ? v : 'plain'
}

/** A block's saved heading, or null for the one its type prints by default. */
export function blockHeading(config: Record<string, unknown> | null | undefined): string | null {
  const v = config?.heading
  if (typeof v !== 'string') return null
  const clean = v.trim().slice(0, 60)
  return clean || null
}

/** A block's shape, defaulting to the rounded rectangle every page has always had. */
export function blockShape(config: Record<string, unknown> | null | undefined): BlockShape {
  const v = config?.shape
  return BLOCK_SHAPES.some((x) => x.id === v && x.id !== 'round') ? (v as BlockShape) : 'round'
}

/**
 * A degree or two off square.
 *
 * ⚠️ TINY ON PURPOSE. The whole effect is "somebody placed this by hand" and it is gone by
 * about four degrees, where it stops reading as placed and starts reading as broken. Five steps,
 * none of them larger than two.
 *
 * ⚠️ IT GOES ON THE SLOT, NOT THE CARD. `.card:hover` already sets a transform to lift the
 * block, and two transforms on one element means the last one wins — a tilted block would have
 * snapped straight on hover, or never lifted. Rotating the wrapper leaves the card's own
 * transform entirely alone.
 */
export const BLOCK_TILTS: ReadonlyArray<{ id: number; label: string }> = [
  { id: -2, label: '↶↶' },
  { id: -1, label: '↶' },
  { id: 0, label: 'Straight' },
  { id: 1, label: '↷' },
  { id: 2, label: '↷↷' },
]

export function blockTilt(config: Record<string, unknown> | null | undefined): number {
  const v = config?.tilt
  return typeof v === 'number' && BLOCK_TILTS.some((t) => t.id === v) ? v : 0
}

/**
 * The swatches.
 *
 * ⚠️ The SAME twelve stops the identity colours use, for the same reason: hues any closer
 * together do not read as two colours, they read as one colour rendered slightly wrong. It also
 * means a block tinted "mine" sits in the same family as the picked ones rather than beside them.
 */
export const TINT_HUES: readonly number[] = Array.from(
  { length: HUE_STOPS },
  (_, i) => i * (360 / HUE_STOPS) + 15,
)

/**
 * What to CALL each swatch.
 *
 * ⚠️ "Colour 135" is not a colour to anybody. The swatches were labelled with their raw hue,
 * which reads out as a number to a screen reader and tells a sighted person nothing on hover
 * either — so the one control here that is purely visual had no non-visual form at all. Twelve
 * stops thirty degrees apart land close enough to the common names to just use them.
 */
const TINT_NAMES = [
  'Red',
  'Orange',
  'Yellow',
  'Lime',
  'Green',
  'Teal',
  'Cyan',
  'Blue',
  'Indigo',
  'Violet',
  'Magenta',
  'Pink',
]

/** The name of a swatch hue — index derived the same way TINT_HUES builds it. */
export function tintName(hue: number): string {
  const i = Math.round((hue - 15) / (360 / HUE_STOPS))
  return TINT_NAMES[((i % HUE_STOPS) + HUE_STOPS) % HUE_STOPS]
}

/**
 * Resolve a block's saved colour.
 *
 * `tint` is a hue, or the word 'mine' for the person's own derived hue, or absent for a plain
 * card — which stays the default, because a page where every block shouts is a page where
 * nothing does.
 */
export function blockLook(
  config: Record<string, unknown> | null | undefined,
  username: string,
): { hue: number | null; finish: BlockFinish } {
  const t = config?.tint
  const hue =
    t === 'mine' ? hueFor(username) : typeof t === 'number' && t >= 0 && t < 360 ? t : null
  const f = config?.finish
  const finish: BlockFinish = f === 'edge' || f === 'solid' ? f : 'soft'
  return { hue, finish }
}

/**
 * The two attributes a slot needs to wear that colour — or nothing at all when it wears none.
 *
 * ⚠️ On the SLOT rather than on the block, because there are ten block types and each one
 * builds its own card. Putting this on the wrapper is the same lesson the width setting already
 * learned here: the song, art and visualiser blocks silently ignored their own width for exactly
 * as long as each type was expected to remember to apply it.
 */
export function blockLookAttrs(
  config: Record<string, unknown> | null | undefined,
  username: string,
): {
  'data-finish'?: BlockFinish
  'data-shape'?: BlockShape
  'data-edge'?: BlockEdge
  'data-backdrop'?: BannerStyle
  'data-tilt'?: string
  style?: React.CSSProperties
} {
  const { hue, finish } = blockLook(config, username)
  const shape = blockShape(config)
  /* ⚠️ The shape survives the early return. This used to be `if (hue == null) return {}`,
     which was right while everything here was a way of wearing a colour — and would have made a
     square block silently impossible unless you also tinted it. */
  const edge = blockEdge(config)
  const font = blockFont(config)
  const backdrop = blockBackdrop(config)
  const tilt = blockTilt(config)
  /* ⚠️ The face rides as a CSS VARIABLE rather than a data attribute, because unlike shape
     and edge it is a value and not a switch — one rule reads it and every block type inherits,
     instead of seven selectors that would each have to be repeated for the slot and the cell. */
  const face = BLOCK_FONTS.find((f) => f.id === font)?.stack
  const vars: Record<string, string> = {}
  if (face) vars['--blk-font'] = face
  if (tilt) vars['--blk-tilt'] = `${tilt}deg`
  if (backdrop) {
    /* the block's own hue when it has one, so the pattern and the tint are one decision */
    const h = hue ?? hueFor(username)
    vars['--blk-bg'] = BANNER_STYLES[backdrop].css(h)
  }
  const shaped = {
    ...(shape === 'round' ? {} : { 'data-shape': shape }),
    ...(edge === 'plain' ? {} : { 'data-edge': edge }),
    ...(backdrop ? { 'data-backdrop': backdrop } : {}),
    ...(tilt ? { 'data-tilt': '1' } : {}),
  }
  /**
   * ⚠️ THE VARIABLES SURVIVE WHETHER OR NOT THERE IS A COLOUR, and this is the THIRD time that
   * has had to be said here. The function began as "how a block wears a hue", so it returned
   * nothing at all without one; shape had to be rescued from that early return, and then the
   * pattern was written straight back into it — a block with a pattern and no tint got its
   * data-backdrop attribute and none of the gradient the attribute exists to reveal.
   *
   * So the rule is now structural rather than remembered: collect what is set, attach it if there
   * is any. A fourth thing added here cannot repeat this.
   */
  if (hue != null) {
    vars['--blk-h'] = String(hue)
  }
  const style = Object.keys(vars).length ? (vars as React.CSSProperties) : undefined
  return {
    ...shaped,
    ...(hue == null ? {} : { 'data-finish': finish }),
    ...(style ? { style } : {}),
  }
}

/**
 * The banner looks.
 *
 * Each is a pure CSS background built from ONE hue, so every style works in every colour and the
 * set stays coherent instead of becoming a pile of unrelated images. They're deliberately
 * different in kind — soft blobs, hard geometry, rings, rays — so the choice is real rather than
 * eight variations on a gradient.
 */
export const BANNER_STYLES = {
  aurora: {
    label: 'Aurora',
    css: (h: number) =>
      `radial-gradient(60% 120% at 20% 20%, hsl(${h} 80% 60% / 0.85), transparent 60%),` +
      `radial-gradient(50% 110% at 80% 30%, hsl(${(h + 60) % 360} 85% 55% / 0.8), transparent 60%),` +
      `radial-gradient(70% 130% at 50% 90%, hsl(${(h + 300) % 360} 75% 50% / 0.7), transparent 60%),` +
      `linear-gradient(160deg, hsl(${h} 45% 18%), hsl(${(h + 40) % 360} 50% 12%))`,
  },
  dusk: {
    label: 'Dusk',
    css: (h: number) =>
      `linear-gradient(180deg, hsl(${h} 70% 55%), hsl(${(h + 25) % 360} 65% 38%) 45%, hsl(${(h + 45) % 360} 60% 18%))`,
  },
  rays: {
    label: 'Rays',
    css: (h: number) =>
      `repeating-conic-gradient(from 200deg at 50% 120%, hsl(${h} 80% 58% / 0.9) 0deg 6deg, transparent 6deg 14deg),` +
      `linear-gradient(180deg, hsl(${(h + 20) % 360} 60% 22%), hsl(${h} 55% 14%))`,
  },
  grid: {
    label: 'Grid',
    css: (h: number) =>
      `repeating-linear-gradient(0deg, hsl(${h} 70% 70% / 0.22) 0 1px, transparent 1px 22px),` +
      `repeating-linear-gradient(90deg, hsl(${h} 70% 70% / 0.22) 0 1px, transparent 1px 22px),` +
      `linear-gradient(140deg, hsl(${h} 55% 24%), hsl(${(h + 40) % 360} 60% 14%))`,
  },
  bands: {
    label: 'Bands',
    css: (h: number) =>
      `repeating-linear-gradient(115deg, hsl(${h} 75% 55%) 0 26px, hsl(${(h + 30) % 360} 70% 45%) 26px 52px, hsl(${(h + 60) % 360} 65% 35%) 52px 78px)`,
  },
  bubbles: {
    label: 'Bubbles',
    css: (h: number) =>
      `radial-gradient(circle at 15% 70%, hsl(${h} 85% 62% / 0.9) 0 10%, transparent 10.5%),` +
      `radial-gradient(circle at 42% 28%, hsl(${(h + 45) % 360} 85% 58% / 0.85) 0 7%, transparent 7.5%),` +
      `radial-gradient(circle at 68% 75%, hsl(${(h + 90) % 360} 80% 60% / 0.8) 0 12%, transparent 12.5%),` +
      `radial-gradient(circle at 88% 35%, hsl(${(h + 20) % 360} 85% 55% / 0.9) 0 6%, transparent 6.5%),` +
      `linear-gradient(150deg, hsl(${h} 50% 20%), hsl(${(h + 50) % 360} 55% 12%))`,
  },
  rings: {
    label: 'Rings',
    css: (h: number) =>
      `repeating-radial-gradient(circle at 30% 120%, hsl(${h} 80% 62% / 0.55) 0 14px, transparent 14px 34px),` +
      `linear-gradient(140deg, hsl(${(h + 30) % 360} 55% 22%), hsl(${h} 60% 12%))`,
  },
  ember: {
    label: 'Ember',
    css: (h: number) =>
      `radial-gradient(120% 100% at 50% 130%, hsl(${h} 95% 62%), hsl(${(h + 25) % 360} 85% 45%) 35%, hsl(${(h + 45) % 360} 70% 18%) 70%, hsl(${(h + 50) % 360} 60% 8%))`,
  },
} as const

export type BannerStyle = keyof typeof BANNER_STYLES

/** Not exported: the only thing that should ever read a raw config is bannerBackground below,
 *  which is what everything else calls. */
const isBannerStyle = (v: unknown): v is BannerStyle => typeof v === 'string' && v in BANNER_STYLES

/**
 * Resolve a banner block's saved config into a background.
 *
 * Falls back to the person's own derived hue when they never picked one, which is what makes
 * "add a banner" produce something that already looks like theirs with zero further choices.
 */
export function bannerBackground(
  config: Record<string, unknown>,
  username: string,
): { background: string; style: BannerStyle; hue: number } {
  const style: BannerStyle = isBannerStyle(config.style) ? config.style : 'aurora'
  const hue =
    typeof config.hue === 'number' && config.hue >= 0 && config.hue < 360
      ? config.hue
      : hueFor(username)
  return { background: BANNER_STYLES[style].css(hue), style, hue }
}
