import { describe, expect, it } from 'vitest'
import {
  decodeLook,
  encodeLook,
  looksLikeCode,
  randomLook,
  readLook,
  STARTERS,
  type Look,
} from './looks'
import { CURSOR_IDS, cursorMark } from './cursorSkin'
import { parseHex } from '../theme/customTheme'

/**
 * A Look, and the code people paste to each other.
 *
 * ⚠️ A CODE IS THE ONE PATH INTO A LOOK THAT A STRANGER CONTROLS, which is the reason readLook
 * validates instead of casting — its own comment says so. Somebody pastes a string a friend sent
 * them, and every field in it goes on to drive a theme, a backdrop, a click effect, a cursor and
 * a set of sizes. Nothing in there may be taken at its word.
 *
 * ⚠️ AND THE FAILURE MODE IS NOT A CRASH. A bad id does not throw; it sits in the page as a
 * class nobody styled or a cursor the browser cannot draw, and the site quietly looks broken to
 * the person who trusted the link. So what these ask is that everything comes back as something
 * the site actually has.
 */

const anyLook = (): Look => STARTERS[0]

describe('a code round-trips', () => {
  it('and comes back as the Look that went in', () => {
    for (const look of STARTERS) {
      const back = decodeLook(encodeLook(look))
      expect(back, `${look.name} did not survive`).not.toBeNull()
      expect(back!.name).toBe(look.name)
      expect(back!.theme).toBe(look.theme)
      expect(back!.background).toBe(look.background)
      expect(back!.cursor).toBe(look.cursor)
      expect(back!.trail).toBe(look.trail)
      expect(back!.click).toBe(look.click)
    }
  })

  it('and a custom palette survives with it', () => {
    const look: Look = {
      ...anyLook(),
      name: 'Mine',
      palette: { bg: '#101018', text: '#eeeef8', accent: '#22c55e' },
    }
    expect(decodeLook(encodeLook(look))!.palette).toEqual(look.palette)
  })

  it('and no palette stays no palette', () => {
    expect(decodeLook(encodeLook({ ...anyLook(), palette: null }))!.palette).toBeNull()
  })

  /* ⚠️ base64url, so a code survives being pasted into a URL or a chat box */
  it('and the code itself is safe to paste anywhere', () => {
    for (const look of STARTERS) {
      const code = encodeLook(look)
      expect(code).toMatch(/^look1\.[A-Za-z0-9\-_]+$/)
      expect(code).not.toContain('+')
      expect(code).not.toContain('/')
      expect(code).not.toContain('=')
    }
  })

  it('and a code is recognisable as one before it is opened', () => {
    expect(looksLikeCode(encodeLook(anyLook()))).toBe(true)
    expect(looksLikeCode('  ' + encodeLook(anyLook()))).toBe(true)
    expect(looksLikeCode('Midnight')).toBe(false)
    expect(looksLikeCode('')).toBe(false)
  })
})

describe('a code from a stranger', () => {
  it('is refused outright when it is not a code', () => {
    for (const junk of ['', 'hello', 'look2.abc', 'look1', 'data:text/html,<script>']) {
      expect(decodeLook(junk), `${junk} got through`).toBeNull()
    }
  })

  it('and refused when the tag is right but the rest is rubbish', () => {
    for (const junk of ['look1.', 'look1.!!!!', 'look1.' + 'z'.repeat(500)]) {
      expect(decodeLook(junk), `${junk.slice(0, 20)} got through`).toBeNull()
    }
  })

  it('and refused when it decodes to something that is not a Look', () => {
    const wrap = (v: unknown) => {
      const bytes = new TextEncoder().encode(JSON.stringify(v))
      let bin = ''
      for (const b of bytes) bin += String.fromCharCode(b)
      return 'look1.' + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    }
    expect(decodeLook(wrap(null))).toBeNull()
    expect(decodeLook(wrap('a look'))).toBeNull()
    expect(decodeLook(wrap(42))).toBeNull()
    expect(decodeLook(wrap({}))).toBeNull()
    /* a Look with no name is not a Look — it would have nothing to be called in the list */
    expect(decodeLook(wrap({ theme: 'dark', cursor: 'ghost' }))).toBeNull()
  })

  /**
   * ⚠️ THIS IS THE ONE THAT MATTERS. A hand-edited code must not be able to put an id on the
   * page that the site does not have — a backdrop nobody styled, a cursor the browser cannot
   * draw, a click effect with no implementation. None of those throw; they just leave the site
   * looking broken to whoever trusted the link.
   */
  it('and an id the site does not have comes back as one it does', () => {
    const nasty = readLook({
      name: 'Trouble',
      theme: 'neon-cyberpunk',
      background: '../../etc/passwd',
      click: 'rm -rf',
      trail: { toString: () => 'sneaky' },
      cursor: '<script>alert(1)</script>',
      palette: { bg: 'javascript:void', text: 'red', accent: 'expression(x)' },
      amounts: { spark: 'infinite' },
      size: { spark: 1e9 },
      speed: { spark: -1e9 },
    })
    expect(nasty).not.toBeNull()
    expect(nasty!.theme).toBe('dark')
    expect(nasty!.background).toBe('none')
    expect(nasty!.click).toBe('sparks')
    expect(nasty!.trail).toBe('none')
    expect(nasty!.cursor).toBe('system')
    /* not a hex triple, so no palette at all rather than a palette of nonsense */
    expect(nasty!.palette).toBeNull()
  })

  it('and a cursor from a code is always one that can actually be drawn', () => {
    const back = readLook({ name: 'x', cursor: 'definitely-not-a-cursor' })!
    expect(CURSOR_IDS).toContain(back.cursor)
    /* and whatever it is, the thing that draws it agrees — system has no picture, by design */
    const mark = cursorMark(back.cursor, '#22c55e')
    expect(mark === null || mark.startsWith('data:image/svg+xml,')).toBe(true)
  })

  it('and sizes and speeds are pulled back into a range that renders', () => {
    const wild = readLook({
      name: 'x',
      size: { spark: 1e9, trail: -4, cursor: Number.NaN },
      speed: { spark: 1e9, trail: -4, cursor: 'fast' },
    })!
    for (const v of [...Object.values(wild.size), ...Object.values(wild.speed)]) {
      expect(Number.isFinite(v), `got ${v}`).toBe(true)
      expect(v).toBeGreaterThanOrEqual(0.4)
      expect(v).toBeLessThanOrEqual(2.2)
    }
  })

  it('and a name is trimmed rather than allowed to be a paragraph', () => {
    const long = readLook({ name: 'n'.repeat(500) })!
    expect(long.name.length).toBeLessThanOrEqual(40)
  })

  /**
   * ⚠️ A PALETTE IS ALL THREE OR NONE. Two good colours and one bad one must not become a
   * palette with a hole in it — those three go straight into CSS custom properties.
   */
  it('and a palette missing one good colour is no palette at all', () => {
    expect(readLook({ name: 'x', palette: { bg: '#000000', text: '#ffffff' } })!.palette).toBeNull()
    expect(
      readLook({ name: 'x', palette: { bg: '#000000', text: '#ffffff', accent: 'red' } })!.palette,
    ).toBeNull()
    expect(
      readLook({ name: 'x', palette: { bg: '#000', text: '#fff', accent: '#0f0' } })!.palette,
      'short hex is not the long form this expects',
    ).toBeNull()
  })

  it('and any palette that does get through is three real colours', () => {
    const ok = readLook({
      name: 'x',
      palette: { bg: '#101018', text: '#EEEEF8', accent: '#22c55e' },
    })!
    expect(ok.palette).not.toBeNull()
    for (const c of Object.values(ok.palette!)) expect(parseHex(c)).not.toBeNull()
  })
})

describe('the Looks that ship', () => {
  it('are all readable back as themselves', () => {
    for (const look of STARTERS) {
      const back = readLook(look)
      expect(back, `${look.name} does not survive its own reader`).not.toBeNull()
      expect(back!.name).toBe(look.name)
      expect(back!.cursor).toBe(look.cursor)
      expect(back!.background).toBe(look.background)
    }
  })

  /**
   * ⚠️ AND THAT IS NOT A GIVEN. One of these is written with `'nib' as CursorSkin` — a cast
   * rather than a real id — so if `nib` is not a cursor the site has, that starter quietly
   * loads with the system pointer and nobody finds out. A cast is a promise the compiler stops
   * checking; this is the test that keeps checking it.
   */
  it('and every starter names a cursor that exists', () => {
    for (const look of STARTERS) {
      expect(CURSOR_IDS, `${look.name} wants the "${look.cursor}" cursor`).toContain(look.cursor)
    }
  })

  it('and no two share a name', () => {
    const names = STARTERS.map((l) => l.name.toLowerCase())
    expect(new Set(names).size).toBe(names.length)
  })

  it('and a random one is a real Look every time', () => {
    for (let i = 0; i < 40; i++) {
      const look = randomLook(`Surprise ${i}`)
      const back = readLook(look)
      expect(back, 'a random Look did not survive its own reader').not.toBeNull()
      expect(back!.cursor).toBe(look.cursor)
      expect(back!.background).toBe(look.background)
      expect(decodeLook(encodeLook(look))).not.toBeNull()
    }
  })
})
