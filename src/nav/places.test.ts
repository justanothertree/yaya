import { describe, expect, it } from 'vitest'
import {
  ALL_SECTIONS,
  navFor,
  PLACES,
  SECTION_ALIASES,
  SECTION_TITLES,
  sectionOf,
  type Section,
  type Viewer,
} from './places'

/**
 * The file this tests exists because Paint was missing from the phone for its entire life — a
 * fact written down in six places with one copy wrong. It had no test, which left the thing that
 * prevents the sixth list resting on nobody forgetting.
 *
 * ⚠️ WHAT THIS DELIBERATELY DOES NOT DO IS RESTATE THE LIST. A test that holds its own array of
 * room ids is the seventh copy, and it rots the same way the other six did. So every assertion
 * below is either a RULE quantified over PLACES, or a claim about one named room and why it is
 * where it is.
 */

const viewer = (over: Partial<Viewer> = {}): Viewer => ({
  financeOn: true,
  authed: false,
  suspended: false,
  isAdmin: false,
  canFinance: false,
  ...over,
})

/** nobody signed in — the state a first-time visitor is in */
const visitor = viewer()
/** signed in, in good standing, nothing special granted */
const memberV = viewer({ authed: true })
const suspendedV = viewer({ authed: true, suspended: true })
/** a build with no members' side at all */
const noFinanceV = viewer({ authed: true, financeOn: false })

const offered = (v: Viewer) => navFor(v).map((p) => p.id)

/** the rooms a plain member is offered and a visitor is not — derived, never typed out */
const membersOnly = PLACES.filter((p) => p.nav(memberV) && !p.nav(visitor)).map((p) => p.id)

describe('chronicle has a place', () => {
  it('is offered to a member', () => {
    expect(offered(memberV)).toContain('chronicle')
  })

  /**
   * Signed out it renders an explainer and a Sign in button rather than bouncing, which is right
   * for a member who opens a link while logged out — but it is not advertised to a visitor, the
   * same as Chat and People. The "What's here" index is built from navFor, so this is also what
   * keeps that dialog honest in both directions.
   */
  it('is not offered to a visitor, a suspended member, or a build with no members side', () => {
    expect(offered(visitor)).not.toContain('chronicle')
    expect(offered(suspendedV)).not.toContain('chronicle')
    expect(offered(noFinanceV)).not.toContain('chronicle')
  })

  it('is routable, titled and spelled the one way', () => {
    expect(ALL_SECTIONS).toContain('chronicle')
    expect(sectionOf('#chronicle')).toBe('chronicle')
    expect(SECTION_TITLES.chronicle).toBeTruthy()
  })
})

/**
 * Pictures is the one room deliberately taken OFF the nav while staying reachable, so both
 * halves are worth pinning: re-listing it would undo a decision, and dropping the route would
 * break a bookmark. "i dont want pictures as its own module but more so just a function to be
 * used with other things" — the function is AddPicture; what is left is a gallery, and its door
 * is in Account.
 */
describe('pictures is routable and unlisted', () => {
  it('is offered to nobody, not even an admin', () => {
    for (const v of [
      visitor,
      memberV,
      suspendedV,
      noFinanceV,
      viewer({ authed: true, isAdmin: true }),
    ])
      expect(offered(v)).not.toContain('pictures')
  })

  it('still answers to its own link', () => {
    expect(ALL_SECTIONS).toContain('pictures')
    expect(sectionOf('#pictures')).toBe('pictures')
    expect(SECTION_TITLES.pictures).toBeTruthy()
  })
})

describe('who is offered what', () => {
  /**
   * The rule, not a list: whatever is behind the members' door stays behind it when the door is
   * shut. Suspension and a build without the members' side are the two ways it shuts, and a room
   * that answered only one of them would be the Paint bug wearing a different hat.
   */
  it('withholds every members-only room from a suspended member', () => {
    expect(membersOnly.length).toBeGreaterThan(0)
    for (const id of membersOnly) expect(offered(suspendedV)).not.toContain(id)
  })

  it('withholds every members-only room where there is no members side', () => {
    for (const id of membersOnly) expect(offered(noFinanceV)).not.toContain(id)
  })

  /** an invite you were sent and somebody's profile are routable and never advertised */
  it('never offers a place that answers false to everyone', () => {
    const everyone = [
      visitor,
      memberV,
      suspendedV,
      noFinanceV,
      viewer({ authed: true, isAdmin: true }),
    ]
    const unlisted = PLACES.filter((p) => everyone.every((v) => !p.nav(v))).map((p) => p.id)
    expect(unlisted).toContain('invite')
    expect(unlisted).toContain('profile')
    for (const v of everyone) for (const id of unlisted) expect(offered(v)).not.toContain(id)
  })

  it('keeps Admin to admins', () => {
    expect(offered(memberV)).not.toContain('admin')
    expect(offered(viewer({ authed: true, isAdmin: true }))).toContain('admin')
  })
})

describe('the list itself', () => {
  it('names each place once', () => {
    expect(new Set(ALL_SECTIONS).size).toBe(ALL_SECTIONS.length)
  })

  it('gives every place a word, a glyph and a title', () => {
    for (const p of PLACES) {
      expect(p.label.trim(), p.id).not.toBe('')
      expect(p.icon.trim(), p.id).not.toBe('')
      expect(p.title.trim(), p.id).not.toBe('')
    }
  })
})

describe('old links still land', () => {
  /**
   * ⚠️ THE CHAIN THE FILE'S OWN COMMENT SAYS NOTHING TESTS. `#pets` was pointed at `games`
   * rather than at `minions` precisely so that no alias resolves through another one, and until
   * now that was a decision kept by hand.
   */
  it('resolves every alias to a real section, and never to another alias', () => {
    for (const [from, to] of Object.entries(SECTION_ALIASES)) {
      expect(ALL_SECTIONS, from).toContain(to)
      expect(Object.keys(SECTION_ALIASES), from).not.toContain(to)
      expect(sectionOf('#' + from)).toBe(to)
    }
  })

  /**
   * ⚠️ NAMED, THOUGH THE LOOP ABOVE ALREADY WALKS IT, and the difference is the regression that
   * matters. The loop checks that every alias which EXISTS resolves; delete the `now:` line and
   * it passes, because there is nothing left to walk. Now was a tab in the nav for weeks before
   * it folded into Chronicle's Day half, so the word is in people's history and in any link
   * already sent — and a word that quietly stops being a door is the failure this file was
   * written after.
   */
  it('still lands #now on Chronicle, which is where the room went', () => {
    expect(sectionOf('#now')).toBe('chronicle')
    expect(ALL_SECTIONS).not.toContain('now')
  })

  it('keeps the query a challenge link carries', () => {
    expect(sectionOf('#snake?room=abc')).toBe('games')
  })

  it('reads a Circuit link that means Chat', () => {
    expect(sectionOf('#circuit?tab=chat')).toBe('chat')
    expect(sectionOf('#circuit')).toBe('circuit')
  })

  it('falls back to home rather than nowhere', () => {
    expect(sectionOf('')).toBe('home')
    expect(sectionOf('#')).toBe('home')
    expect(sectionOf('#nothing-by-this-name')).toBe('home')
  })

  it('routes every section it lists', () => {
    for (const id of ALL_SECTIONS) expect(sectionOf('#' + id), id).toBe(id as Section)
  })
})

/**
 * ⚠️ THE SPELLING ON SCREEN MUST BE A DOOR, which is the general form of a real miss: the
 * visualiser's id is `visualizer` and every word the site shows for it is "Visualiser", so the one
 * spelling anybody could read was the one the URL refused — it landed on home, silently, which is
 * indistinguishable from a typo on the reader's part.
 *
 * Asked of every room with a ONE-WORD label rather than of that room by name, so the next rename
 * that changes a label without changing an id is caught by the same line. Multi-word labels are
 * excluded deliberately: nobody types `#acceptinvite`.
 */
describe('a room can be reached by the name it shows', () => {
  it('resolves every one-word label as a hash', () => {
    const missed: string[] = []
    for (const p of PLACES) {
      const word = p.label.trim()
      if (/\s/.test(word)) continue
      if (sectionOf('#' + word.toLowerCase()) !== p.id) missed.push(`${word} → ${p.id}`)
    }
    expect(missed).toEqual([])
  })

  /** the one that was wrong, named, so the reason this test exists stays legible */
  it('takes the visualiser by its British spelling and its American id', () => {
    expect(sectionOf('#visualiser')).toBe('visualizer')
    expect(sectionOf('#visualizer')).toBe('visualizer')
  })

  /** an alias must point at a real room, never at another alias */
  it('resolves every alias in one hop', () => {
    for (const [from, to] of Object.entries(SECTION_ALIASES)) {
      expect(ALL_SECTIONS).toContain(to)
      expect(SECTION_ALIASES[to]).toBeUndefined()
      expect(sectionOf('#' + from)).toBe(to)
    }
  })
})
