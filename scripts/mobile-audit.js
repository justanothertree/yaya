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
 * ⚠️ IT SEES A ROOM'S OPENING STATE AND NOTHING ELSE, WHICH IS THE EXPENSIVE THING TO FORGET.
 * `auditRooms` opens each room and measures what is on screen — so every control that appears
 * only after you do something is invisible to it, and the report says "clean" about them anyway.
 *
 * It has cost real work twice. Half the instrument — the bar ruler, the layer list, the
 * arrangement cells, the library panel — does not exist until a song is loaded, and a sweep of a
 * fresh room reporting `tooSmall: []` was taken as evidence that a known defect had been fixed.
 * It had not: the ruler cells were 12x14 against a row of 30px cells they were supposed to line
 * up with, and loading a song showed five failures where the sweep had shown none. The map maker
 * has five modes and the sweep sees one. The games room keeps the park, the scrap and the
 * playground behind buttons.
 *
 * ⚠️ SO AN EMPTY REPORT IS EVIDENCE ABOUT WHAT WAS ON SCREEN, AND NOTHING MORE. Put the room into
 * the state you care about first — load a song, place a stamp, walk into the park — and call
 * `mobileAudit()` directly, which measures the page as it stands. `auditRooms` is the sweep for
 * the opening states; it is not an answer about the site.
 *
 * ⚠️ AND IT FOLLOWS THE VIEWER, so signing in is worth doing before a sweep. The navigation it
 * reads offers ten rooms to a stranger and eighteen places exist — chat, people, admin and the
 * rest appear once there is somebody to show them to, and get measured without this file knowing
 * their names.
 *
 * ⚠️ AND THE BAR IS AN OUTSIDE ONE. 24×24 CSS pixels is WCAG 2.5.8 (AA), not a preference —
 * which matters because "that button looks small" is an argument and "that button is 21px tall
 * on every room of the site" is not. 44 is the comfortable size most platforms name, and it is
 * reported separately as `snug` so it never gets confused with a failure.
 *
 * ⚠️ BUT 2.5.8 HAS A SPACING EXCEPTION AND `tooSmall` DOES NOT MODEL IT. An undersized target
 * still conforms if a 24px circle centred on it touches no other target's circle — so a LONE
 * small control passes the criterion while appearing in this list. The investments ⓘ is the
 * worked example: 34×20 with a mouse, and 384px from the nearest other control, so raising it
 * was a comfort decision and calling it a failure would have been wrong.
 *
 * It is not modelled because the alternative is worse in the direction that matters. A dense row
 * of small buttons — a toolbar, a sort row, a picker strip — fails on spacing as well as size,
 * which is every real finding this script has produced; adding the exception would buy a few
 * fewer lines of report in exchange for the chance of hiding a 20px control nobody can hit. So
 * read `tooSmall` as "measure the spacing before claiming a violation", not as a verdict.
 */

const SPACING = 24
const COMFY = 44

/** What counts as a control. Named once because groupSays has to ask the same question. */
const CONTROLS = 'button, a[href], input:not([type=hidden]), select, textarea, [role=button]'

const shown = (el) => {
  const cs = getComputedStyle(el)
  if (cs.display === 'none' || cs.visibility === 'hidden') return false
  if (!el.offsetParent && cs.position !== 'fixed') return false
  /* deliberately clipped for screen readers — not a layout fault */
  if (el.closest('.sr-only, .skip-link')) return false
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0
}

/**
 * An ancestor that manages its own horizontal overflow means going past the edge is the design.
 *
 * ⚠️ `hidden` COUNTS, AND LEAVING IT OUT CRIED WOLF ON A WHOLE GAME. This asked only about
 * `auto` and `scroll` — a thing you can scroll to — and missed the other way a container owns its
 * own width: a camera. The playground's stage clips a world that is wider than the screen, so its
 * ledges and treats sit hundreds of pixels past the right edge ON PURPOSE and cannot be seen,
 * scrolled to, or made to overflow the page. Flagged, they are two findings on a main room at
 * every run, and this file's whole doctrine is that a checker nobody runs twice is no checker.
 *
 * ⚠️ AND IT COSTS NOTHING, because `sideways` is the backstop and does not go through here: if
 * anything ever DOES push the document wider than the window, that number says so whatever is
 * clipping what. This rule only decides whether to blame an individual element for it.
 */
const scrollsX = (el) => {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowX
    if (o === 'auto' || o === 'scroll' || o === 'hidden') return true
  }
  return false
}

/**
 * A PANEL THAT SCROLLS SIDEWAYS INSIDE ITSELF — which every rule above is built to miss.
 *
 * ⚠️ THIS IS THE BUG THAT WAS REPORTED AND THE REASON IT COULD NOT BE FOUND. The block settings
 * panel was `width: min(20rem, 32vw)` with `overflow-y: auto`, and a block's options were
 * reported as "3 page scroll to the right". Every probe written to find it answered zero:
 *
 *   - `sideways` is `documentElement.scrollWidth - W`, the DOCUMENT's own overflow. A panel that
 *     is `position: fixed` and portalled to the body never widens the document however far its
 *     contents run, so the backstop that catches everything else cannot see this at all.
 *   - `offEdge` and `clipped` both ask `scrollsX`, which answers "does an ancestor manage
 *     horizontal overflow" and treats yes as proof that going past the edge is the design.
 *     Inside a panel like this that is true of EVERY descendant, so the panel quietly exempts
 *     its entire contents from the two rules that would have named them.
 *
 * ⚠️ AND NOBODY ASKED FOR THAT SCROLLBAR, which is what makes this a check rather than a matter
 * of taste. Per the overflow spec, when one axis is not `visible` the other computes to `auto` —
 * so `overflow-y: auto` on its own silently makes an element scrollable SIDEWAYS as well. That
 * is never what anyone means by it, and there is nothing in the source to notice.
 *
 * So: the element is its own horizontal scroll container, it really is scrolling, and no rule
 * anywhere sets `overflow-x` on it. Something deliberately sideways — the piano keyboard, a chip
 * carousel — declares `overflow-x` or `overflow` and is silent here. That exclusion is the whole
 * value of the rule: without it this flags the instrument's keyboard on every run, which is how
 * a checker stops being a checker.
 *
 * ⚠️ `whoSets` IS THE EXPENSIVE PART, so it is only asked about the few elements that have
 * already passed both cheap tests. Walking every rule in the stylesheet once per element on the
 * page is not a check anybody waits around for.
 */
const scrollsXUnasked = (el, cs) => {
  if (cs.overflowX !== 'auto' && cs.overflowX !== 'scroll') return false
  if (el.scrollWidth <= el.clientWidth + 2) return false
  /* something narrower than this is a chip or an icon, where a stray pixel is not a finding */
  if (el.clientWidth < 40) return false
  if (el.style.getPropertyValue('overflow-x') || el.style.getPropertyValue('overflow')) return false
  /* a shorthand `overflow:` expands in the CSSOM, so this sees `overflow: auto` as well as
     `overflow-x: auto` — and does NOT see a lone `overflow-y`, which is exactly the distinction */
  return !whoSets(el, 'overflow-x').rules.length
}

/**
 * ⚠️ WCAG exempts a target whose size is set by the text around it — a link in a sentence
 * cannot be made 24px tall without changing the line it sits in.
 */
const inProse = (el) => !!el.closest('p, li') && getComputedStyle(el).display.startsWith('inline')

/**
 * What you actually have to hit.
 *
 * ⚠️ A CHECKBOX WRAPPED IN A `<label>` IS NOT THE TARGET — THE LABEL IS. Clicking anywhere in
 * the label toggles the box, which is the browser's own behaviour and not a nicety. Measured on
 * the block settings panel: a 13×13 box inside a 240×19 label, and tapping the label really does
 * toggle it. Reported as "INPUT 13x13", which names the wrong element and suggests the wrong fix
 * — nobody should be making the tick bigger. The row was the thing that was too short.
 *
 * ⚠️ IT STILL REPORTS, and that is the point of measuring rather than excusing. 240×19 misses
 * the 24px floor on its short side, so the finding survives with the right element and the right
 * number on it. A rule that had simply skipped wrapped checkboxes would have hidden a real one.
 */
/**
 * The word on the GROUP, when the control itself has none.
 *
 * ⚠️ WITHOUT THIS THE WORDLESS CHECK CRIED WOLF ABOUT NINETEEN CONTROLS AND SEVENTEEN OF THEM
 * WERE FINE. Measured at 375: two in Paint, ten in the instrument, seven in the visualiser — and
 * the kaleidoscope folds read "Mirror · Off 2 3 4 6 8" on screen and the quantise buttons read
 * "Snap · Off 1/4 1/8 1/16". A phone user sees the label; it is only the individual buttons that
 * are bare, and a row of numeric options under a word is how you write that control. Flagging
 * them is the exact failure the header of this file is about.
 *
 * ⚠️ TWO PLACES, AND NOT ONE MORE. A word loose inside the row (Snap, which sits beside its own
 * buttons) or a label element immediately before it (Mirror, which is the row's previous
 * sibling). Walking further up would excuse everything: the snap buttons' grandparent is the
 * whole transport row, whose text begins "▶ Play 1. How fast? Slow Steady Upbeat Fast" — a
 * heading somewhere above a toolbar does not explain a button in it.
 *
 * ⚠️ AND sr-only TEXT DOES NOT COUNT, which is the point of asking `shown`. This check is about
 * what a sighted person holding a phone can read, so a label clipped to a pixel for a screen
 * reader leaves the control just as unexplained as a tooltip does.
 *
 * ⚠️ AND IT ONLY LOOKS AT CONTROLS THAT HAVE A title, WHICH LEAVES A GAP ON PURPOSE. A control
 * explained NOWHERE — no word, no title, no aria-label — is strictly worse than one explained by
 * a tooltip, and nothing here reports it. Swept for deliberately before leaving it that way:
 * zero instances across all five rooms AND the park mid-walk, where every pad button turned out
 * to carry a real aria-label ("Walk left", "Quick swing", "Roll", "Jump"). A first sweep seemed
 * to find twenty-three, and all twenty-three were range sliders wrapped in a label — it had read
 * textContent on the input instead of asking hitBox, which is the whole reason hitBox exists.
 * So the gap is theoretical today, and a check for it would have to go through hitBox or it
 * would report every slider on the site.
 *
 * ⚠️ WHAT SURVIVES IS STILL A JUDGEMENT, AND THIS CHECK CANNOT MAKE IT. Nineteen hits became
 * five across three controls — a layer eye, and the floating collapse and fullscreen pair over
 * the canvas, which appears in two rooms. All three are wordless by every rule here and all
 * three were left alone, because each is a near-universal icon whose effect is immediate and
 * reversible, and no DOM rule can tell a convention from an obscurity. Unlike the 24px bar,
 * which is WCAG and settles itself, this list is for a person to read and dismiss. A SHORT list
 * is the goal; an empty one would mean the rules above had been widened until they said nothing.
 */
const looseWords = (node) => {
  let got = ''
  for (const n of node.childNodes) {
    if (n.nodeType === 3) {
      got += ' ' + n.textContent
      continue
    }
    if (n.nodeType !== 1) continue
    if (n.matches(CONTROLS) || n.querySelector(CONTROLS)) continue
    if (!shown(n)) continue
    got += ' ' + n.textContent
  }
  return got.trim()
}

const groupSays = (el) => {
  const row = el.parentElement
  if (!row) return ''
  const own = looseWords(row)
  if (/[a-z]{2}/i.test(own)) return own
  /* ⚠️ ONE LABEL GOVERNING ONE GROUP, or it is a heading over a list. Measured: the mirror
     folds sit in a parent with exactly two children — the word "Mirror" and the row of folds —
     while a paint layer row sits in a parent of three, beside the heading "Layers" AND a
     + layer button. Without the count, "Layers" excused six different actions in every layer
     row, which is the same crying wolf as before with the sign flipped. */
  const before = row.previousElementSibling
  const par = row.parentElement
  const alone = !!par && par.children.length === 2
  if (
    alone &&
    before &&
    shown(before) &&
    !before.matches(CONTROLS) &&
    !before.querySelector(CONTROLS)
  ) {
    const said = (before.textContent || '').trim()
    if (/[a-z]{2}/i.test(said)) return said
  }
  return ''
}

const hitBox = (el) => {
  if (el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio')) {
    const lab = el.closest('label')
    if (lab) return lab
  }
  return el
}

/**
 * Measure the page, or one part of it.
 *
 * ⚠️ `root` IS HOW THE SIGNED-IN SURFACES GET MEASURED AT ALL. Half the site needs a session and
 * the workbenches at `#dev-profile`, `#dev-admin`, `#dev-usage` and `#dev-investments` are the
 * only way to see them — but each one renders INSIDE the home page, so a whole-document sweep of
 * `#dev-investments` reports home's skill chips and navigation mixed in with the member card, and
 * the signal is lost in a room that was already measured and is already correct.
 *
 * Pass the bench and the report is about the bench:
 *   mobileAudit(document.querySelector('.dev-bench'))
 *
 * ⚠️ AND A WORKBENCH NEEDS A FULL RELOAD, not a hash change. `DEV_PREVIEW` in App.tsx is read at
 * module scope, so arriving at `#dev-investments` by changing the hash renders plain home —
 * `location.hash = '#dev-investments'; location.reload()`. The app then normalises the hash back
 * to `#home`, which is why `room` below reports the scope rather than trusting the URL.
 */
export function mobileAudit(root = document) {
  const W = innerWidth
  const targets = [...root.querySelectorAll(CONTROLS)].filter(shown)
  const out = {
    room:
      root === document
        ? location.hash || '#home'
        : (root.className && typeof root.className === 'string'
            ? '.' + root.className.split(' ')[0]
            : root.tagName) + ' (scoped)',
    width: W,
    sideways: document.documentElement.scrollWidth - W,
    tooSmall: [],
    snug: [],
    offEdge: [],
    clipped: [],
    insideOut: [],
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
    /* the thing a finger has to land on, which for a wrapped tickbox is its label — see hitBox */
    const hit = hitBox(el)
    const r = hit.getBoundingClientRect()
    const name = (
      (hit.textContent || '').trim() ||
      hit.getAttribute('aria-label') ||
      hit.getAttribute('title') ||
      '(none)'
    ).slice(0, 22)
    const size = Math.round(r.width) + 'x' + Math.round(r.height)
    if ((r.width < SPACING || r.height < SPACING) && !inProse(hit))
      keep(out.tooSmall, hit, { name, size })
    else if (r.width < COMFY || r.height < COMFY) keep(out.snug, hit, { name, size })
    /* a control carrying no word, explained only by a tooltip nobody on a phone can open */
    const label = (el.textContent || '').trim()
    const meaning = el.getAttribute('title') || ''
    if (
      !/[a-z]{2}/i.test(label) &&
      meaning.length > 3 &&
      !el.getAttribute('aria-label') &&
      !groupSays(el)
    )
      keep(out.wordless, el, { name: label || '(nothing)', means: meaning.slice(0, 44) })
  }

  /* the element itself counts when it is a scope — a bench whose own box runs off the edge is
     exactly the kind of thing this is for */
  const inside =
    root === document
      ? [...document.querySelectorAll('body *')]
      : [root, ...root.querySelectorAll('*')]
  for (const el of inside) {
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
    if (!once.has('i' + id(el)) && scrollsXUnasked(el, cs)) {
      once.add('i' + id(el))
      out.insideOut.push({
        el: id(el),
        wide: el.clientWidth,
        by: el.scrollWidth - el.clientWidth,
      })
    }
  }
  return out
}

/**
 * Which rooms there are, asked of the page rather than written down here.
 *
 * ⚠️ THE LIST USED TO BE FIVE NAMES IN THIS FILE AND THE SITE HAS TEN ROOMS. Circuit, Ratings,
 * Investments, Sign in and Contact were never swept by anything, and nothing said so — a sweep
 * that reports "all clean" while skipping half the site is worse than no sweep, because it is
 * believed. Investments turned out to be holding seven controls two pixels under the bar, found
 * only because something else sent me into that room by accident.
 *
 * ⚠️ SO IT READS THE NAV, which is the same rule the rest of this project follows about lists:
 * CLAUDE.md says the one thing that does not belong anywhere is "a list that has to be maintained
 * by hand to stay true", and names an inventory that drifted in four weeks as the reason. A list
 * taken from the navigation cannot drift from the navigation. It also follows the VIEWER — sign
 * in and the admin and usage rooms appear, and get swept too, without this file knowing they
 * exist.
 *
 * ⚠️ `#content` IS A SKIP LINK, NOT A ROOM. It is the first anchor on the page and it points at
 * the main element, so a naive sweep opens it first and audits whatever was already on screen.
 */
const navRooms = () => {
  const out = []
  for (const a of document.querySelectorAll('nav a[href^="#"]')) {
    const h = (a.getAttribute('href') || '').trim()
    if (!h || h === '#content' || h.startsWith('#content?') || out.includes(h)) continue
    out.push(h)
  }
  return out.length ? out : ['#home']
}

/** Walk the rooms and report each. Hash navigation, so the page never reloads out from under it. */
export async function auditRooms(rooms = navRooms()) {
  const all = []
  for (const r of rooms) {
    location.hash = r
    /* ⚠️ LONG ENOUGH FOR THE LAYOUT TO STOP MOVING, and 1500 was not. Swept at 375 the home page
       reported five piano keys at 23px wide; opening that page on its own and measuring it gave
       36.72. Nothing was wrong with the page — the row had not finished laying out when the
       reading was taken, and a false positive from this file costs exactly what the header says:
       a checker that cries wolf is one nobody runs twice. */
    await new Promise((go) => setTimeout(go, 2400))
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
