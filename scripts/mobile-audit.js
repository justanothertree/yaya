/**
 * What a phone cannot do with this page, measured rather than eyeballed.
 *
 * Paste the whole file into the Browser pane's console (or devtools) on any room, then call
 * `mobileAudit()`. Set the viewport to 375 first — `resize_window` with preset "mobile", which
 * also emulates a touch device so `(pointer: coarse)` rules apply.
 *
 * ⚠️ IT EXISTS BECAUSE THE FIRST VERSION OF IT REPORTED MOSTLY NONSENSE. A naive sweep for
 * "small or overflowing" flagged 14 things on the home page and 27 in the instrument, and
 * almost all of them were correct by design: sr-only text is MEANT to be clipped to a pixel, a
 * piano keyboard is MEANT to scroll sideways and have adjacent keys, a palette is MEANT to be a
 * tight grid of swatches. A checker that cries wolf about a room's whole toolbar is one nobody
 * runs twice, so every exclusion below is one of those, and each is a rule rather than a
 * name-by-name skip list.
 *
 * ⚠️ AND THE BAR IS AN OUTSIDE ONE. 24×24 CSS pixels is WCAG 2.5.8 (AA), not a preference —
 * which matters because "that button looks small" is an argument and "that button is 21px tall
 * on every room of the site" is not. 44 is the comfortable size most platforms name, and it is
 * reported separately as `snug` so it never gets confused with a failure.
 */

const SPACING = 24
const COMFY = 44

const shown = (el) => {
  const cs = getComputedStyle(el)
  if (cs.display === 'none' || cs.visibility === 'hidden') return false
  if (!el.offsetParent && cs.position !== 'fixed') return false
  /* deliberately clipped for screen readers — not a layout fault */
  if (el.closest('.sr-only, .skip-link')) return false
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0
}

/** a scrolling ancestor means going past the edge is the design, not a bug */
const scrollsX = (el) => {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowX
    if (o === 'auto' || o === 'scroll') return true
  }
  return false
}

/**
 * ⚠️ WCAG exempts a target whose size is set by the text around it — a link in a sentence
 * cannot be made 24px tall without changing the line it sits in.
 */
const inProse = (el) => !!el.closest('p, li') && getComputedStyle(el).display.startsWith('inline')

export function mobileAudit() {
  const W = innerWidth
  const targets = [
    ...document.querySelectorAll(
      'button, a[href], input:not([type=hidden]), select, textarea, [role=button]',
    ),
  ].filter(shown)
  const out = {
    room: location.hash || '#home',
    width: W,
    sideways: document.documentElement.scrollWidth - W,
    tooSmall: [],
    snug: [],
    offEdge: [],
    clipped: [],
    wordless: [],
  }
  const once = new Set()
  const id = (el) =>
    el.tagName +
    '.' +
    (typeof el.className === 'string' ? el.className.split(' ').slice(0, 2).join('.') : '')
  const keep = (list, el, extra) => {
    const k = list === out.tooSmall ? 't' : list === out.snug ? 's' : 'w'
    const key = k + id(el) + (extra.name || '')
    if (once.has(key)) return
    once.add(key)
    list.push({ el: id(el), ...extra })
  }

  for (const el of targets) {
    const r = el.getBoundingClientRect()
    const name = (
      (el.textContent || '').trim() ||
      el.getAttribute('aria-label') ||
      el.getAttribute('title') ||
      '(none)'
    ).slice(0, 22)
    const size = Math.round(r.width) + 'x' + Math.round(r.height)
    if ((r.width < SPACING || r.height < SPACING) && !inProse(el))
      keep(out.tooSmall, el, { name, size })
    else if (r.width < COMFY || r.height < COMFY) keep(out.snug, el, { name, size })
    /* a control carrying no word, explained only by a tooltip nobody on a phone can open */
    const label = (el.textContent || '').trim()
    const meaning = el.getAttribute('title') || ''
    if (!/[a-z]{2}/i.test(label) && meaning.length > 3 && !el.getAttribute('aria-label'))
      keep(out.wordless, el, { name: label || '(nothing)', means: meaning.slice(0, 44) })
  }

  for (const el of document.querySelectorAll('body *')) {
    if (!shown(el)) continue
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    if (r.right > W + 1 && r.width < W * 3 && !scrollsX(el) && !once.has('o' + id(el))) {
      once.add('o' + id(el))
      out.offEdge.push({ el: id(el), right: Math.round(r.right) })
    }
    if (
      el.children.length === 0 &&
      el.clientWidth > 4 &&
      el.scrollWidth > el.clientWidth + 2 &&
      !scrollsX(el) &&
      cs.overflowX !== 'auto' &&
      cs.overflowX !== 'scroll' &&
      !once.has('c' + id(el))
    ) {
      once.add('c' + id(el))
      out.clipped.push({ el: id(el), text: (el.textContent || '').trim().slice(0, 30) })
    }
  }
  return out
}

/** Walk the rooms and report each. Hash navigation, so the page never reloads out from under it. */
export async function auditRooms(
  rooms = ['#home', '#paint', '#instrument', '#visualizer', '#games'],
) {
  const all = []
  for (const r of rooms) {
    location.hash = r
    await new Promise((go) => setTimeout(go, 1500))
    all.push(mobileAudit())
  }
  return all
}

/**
 * Where a thumb cannot scroll the page.
 *
 * ⚠️ REPORTED AS "SCROLLING PAST A DEMO IS TRICKY — YOU HAVE TO SWIPE FROM ABOVE OR BELOW".
 * Anything with `touch-action: none` swallows a vertical swipe, which is right for a surface you
 * came to draw on and wrong for everything else. The home page had five such bands, each 86-94%
 * of the screen and ~168px tall, because a rule reasoning about the scribble pad also listed
 * `.hag-art` — the shared class on EVERY tile picture, including decoration with no handler.
 *
 * ⚠️ SO THE TEST IS NOT "IS IT none", IT IS "IS IT none SOMEWHERE NOBODY MEANT". Judge each hit
 * by whether the thing under your thumb is the thing you came to touch: the paint canvas, the
 * piano and the scribble pad all report here and all should.
 */
export function deadBands() {
  const out = []
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') continue
    const ta = cs.touchAction
    if (ta === 'auto' || ta === 'manipulation' || ta.startsWith('pan-y')) continue
    const r = el.getBoundingClientRect()
    /* only wide, tall things on a page that actually scrolls can strand somebody */
    if (r.width < innerWidth * 0.5 || r.height < 40) continue
    out.push({
      el: el.tagName + '.' + (typeof el.className === 'string' ? el.className.split(' ')[0] : ''),
      size: Math.round(r.width) + 'x' + Math.round(r.height),
      shareOfWidth: Math.round((r.width / innerWidth) * 100) + '%',
      touchAction: ta,
    })
  }
  const once = new Set()
  return {
    scrolls: document.documentElement.scrollHeight > innerHeight + 40,
    bands: out.filter((x) => (once.has(x.el) ? false : (once.add(x.el), true))),
  }
}

/**
 * Which CSS rule actually sets a property on an element.
 *
 * ⚠️ `if (rule.cssRules)` IS NOT HOW YOU TELL A GROUP FROM A STYLE RULE, and believing it cost
 * two wrong diagnoses in one sitting. Chrome's CSSStyleRule implements CSSGroupingRule now, for
 * CSS nesting — so every plain rule HAS a `cssRules`, an empty list, which is truthy. A walker
 * branching on it recurses into nothing and never looks at the rule itself, then reports that
 * no rule sets the property while the computed value plainly says one does. Check `.length`.
 */
export function whoSets(el, prop) {
  const found = []
  const walk = (list, cond) => {
    for (const r of list) {
      if (r.selectorText && r.style && r.style.getPropertyValue(prop)) {
        for (const sel of r.selectorText.split(',')) {
          try {
            if (el.matches(sel.trim()))
              found.push({ sel: sel.trim(), cond, value: r.style.getPropertyValue(prop) })
          } catch {
            /* a selector this browser cannot parse cannot be the one that matched */
          }
        }
      }
      if (r.cssRules && r.cssRules.length) walk(r.cssRules, r.conditionText || cond)
    }
  }
  for (const sheet of document.styleSheets) {
    let rules
    try {
      rules = sheet.cssRules
    } catch {
      continue /* another origin's stylesheet is not readable, and is not ours */
    }
    walk(rules, '')
  }
  return {
    computed: getComputedStyle(el)[prop] ?? getComputedStyle(el).getPropertyValue(prop),
    inline: el.style.getPropertyValue(prop) || null,
    rules: found,
  }
}
