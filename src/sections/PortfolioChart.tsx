// Interactive portfolio-over-time chart: worth / net in / promised lines with
// week / month / year / all ranges, a hover (or touch) crosshair readout, and a
// clickable legend that shows or hides each line. Hand-rolled SVG to match the
// Circuit's charts — no chart library.
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { buildDailySeries, type Timeline } from '../finance/timeline'
import { fundToday } from '../finance/fundDay'
import { usd } from '../finance/portfolio'

const RANGES = [
  { key: '1W', days: 7, label: 'Week' },
  { key: '1M', days: 30, label: 'Month' },
  { key: '1Y', days: 365, label: 'Year' },
  { key: 'ALL', days: null, label: 'All' },
] as const
type RangeKey = (typeof RANGES)[number]['key']

/**
 * ⚠️ THE BOX IS MEASURED, BECAUSE A FIXED viewBox SHRINKS THE TEXT ALONG WITH IT. This was
 * `720 × 260` with `width: 100%`, which on a phone is drawn into 299 × 108 CSS pixels — every
 * SVG unit scaled by 0.415, so `fontSize="10"` reached the screen at **4px** and the axis was
 * decorative. No font size would have fixed it: the whole coordinate system was being divided.
 *
 * One SVG unit = one CSS pixel instead, so 10 means 10. The side padding holds the widest y
 * label, which is narrower on a phone because there is less room and the figures are smaller.
 *
 * ⚠️ AND THE HEIGHT IS A RATIO WITH BOUNDS, not a constant. At 299px wide a 260-tall chart is
 * nearly square and reads as a blob; at 1,000 wide a 260-tall one is a strip. 0.42 keeps the
 * shape between the two, and the bounds stop it from becoming either.
 */
const MIN_W = 260
const MAX_W = 1000
const padFor = (w: number) => ({ top: 12, right: 12, bottom: 22, left: w < 420 ? 40 : 52 })
const heightFor = (w: number) => Math.round(Math.max(150, Math.min(300, w * 0.42)))
const DAY = 86_400_000

const LINES = [
  {
    key: 'value' as const,
    label: 'Worth',
    // ⚠️ "plus cash" is not a detail. The hint used to stop at "at each day's prices", which
    // stopped being true when cash was folded into this line — and the summary card above the
    // chart excludes cash from its own worth figure on purpose.
    hint: 'What the holdings are worth at each day’s prices, plus cash from any sales',
    color: 'var(--gain)',
  },
  {
    key: 'invested' as const,
    /* ⚠️ "Net in" is accountancy. The same quantity, in words somebody reads once: this is the
       figure the headline card calls "Money put in", and the two must keep the same name — they
       are the same walk, which is why timeline.ts says it follows finance.account_ledger. */
    label: 'Money put in',
    hint: 'Money put in for you, not counting a sale’s proceeds being re-invested',
    color: 'var(--accent, #7c6af7)',
  },
  {
    key: 'promised' as const,
    /* "Promised" reads like a thing somebody said; this is the arithmetic of the plan to date. */
    label: 'Planned so far',
    hint: 'What the $-a-day plan adds up to by each day',
    color: 'rgba(150,150,170,0.9)',
  },
]
type LineKey = (typeof LINES)[number]['key']

/**
 * An axis tick, as short as it can be and still be the number.
 *
 * ⚠️ NO CENTS. Ticks land on round money by construction — see `niceStep` — so the two trailing
 * zeros in "$150.00" are never information, and three of them stacked down the side of a 299px
 * chart is the widest thing in the drawing. `usd()` is right everywhere a figure is a FIGURE;
 * here it is a gridline's name.
 */
const compact = (n: number) =>
  Math.abs(n) >= 1000
    ? `${n < 0 ? '−' : ''}$${(Math.abs(n) / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })}k`
    : `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: Number.isInteger(n) ? 0 : 2 })}`

/**
 * The nearest "round" step at or above a target: 1, 2, 2.5 or 5 times a power of ten.
 *
 * This is what turns an axis into something readable — every tick lands on a number somebody
 * would actually say, so $0 / $10k / $20k rather than −$850.45 / $7.2k / $15.3k.
 */
function niceStep(target: number): number {
  if (!(target > 0)) return 1
  const mag = Math.pow(10, Math.floor(Math.log10(target)))
  const norm = target / mag
  // 1 / 2 / 5 / 10 only. 2.5 was on this ladder and produced mid-ticks like $6.25 — round in
  // the arithmetic sense, not in the sense of a number anybody says.
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10
  return step * mag
}

export function PortfolioChart({ timeline, title }: { timeline: Timeline; title?: string }) {
  const [range, setRange] = useState<RangeKey>('1M')
  const [hover, setHover] = useState<number | null>(null)
  /**
   * ⚠️ ONE LINE BY DEFAULT. Three lines, a three-chip legend and a four-figure readout is a
   * trading screen, and the person this page is for asked one question: what is it worth. Money
   * put in and the plan are the answer to a second question, which is why they are behind a
   * chip — not removed, because the gap between worth and plan is the whole point of the fund.
   */
  const [details, setDetails] = useState(false)
  const [show, setShow] = useState<Record<LineKey, boolean>>({
    value: true,
    invested: true,
    promised: true,
  })
  const svgRef = useRef<SVGSVGElement | null>(null)
  const boxRef = useRef<HTMLDivElement | null>(null)

  /**
   * The drawing box, in CSS pixels.
   *
   * ⚠️ 520 IS A FIRST GUESS THAT IS NEVER PAINTED. `useLayoutEffect` runs before the browser
   * paints, so the measured width is in place for the first frame the reader sees; the initial
   * value only decides what React lays out internally.
   */
  const [boxW, setBoxW] = useState(520)
  useLayoutEffect(() => {
    const el = boxRef.current
    if (!el) return
    const read = () => {
      const next = Math.round(el.getBoundingClientRect().width)
      if (next > 0) setBoxW(Math.max(MIN_W, Math.min(MAX_W, next)))
    }
    read()
    /**
     * ⚠️ AND THE OBSERVER IS THE RIGHT TOOL, BECAUSE THIS BOX CHANGES WIDTH WITHOUT THE WINDOW.
     * At 900px the room's grid goes to two columns and this card loses a third of its width in
     * one step; a `window` resize listener would hear that only by coincidence.
     *
     * ⚠️ CLAUDE.md SAID RESIZE OBSERVERS NEVER FIRE IN THE BROWSER PANE. Measured on 28 Oct
     * 2026, they do — the initial callback and an element-only resize both arrive — so this
     * path is verified rather than assumed. The note is corrected there; it is recorded here
     * too, because this is the first thing written against it.
     */
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const W = boxW
  const H = heightFor(boxW)
  /* memoised so the paths memo below has a stable dependency — all three are pure in `boxW` */
  const PAD = useMemo(() => padFor(boxW), [boxW])

  /**
   * What is actually drawn. `show` is the reader's per-line choice; `vis` is that choice AFTER
   * the details chip has its say, and every path below asks `vis` — a line that is hidden must
   * also be out of the y-axis bounds, out of the readout and out of the crosshair, or the chart
   * leaves room for something nobody can see.
   */
  const vis: Record<LineKey, boolean> = details
    ? show
    : { value: true, invested: false, promised: false }

  /* ⚠️ the fund's day, matching the server's promised figure and the summary card — see
     finance/fundDay.ts. This was toISOString(), so the axis ran a day past the reader's
     calendar all evening and the caption under it said "prices through" a date in the future. */
  const today = fundToday()

  // "All" means the fund era (earliest account start), not the whole trade history —
  // pre-fund churn from years past would drown the story otherwise.
  const fundStart = useMemo(() => {
    const starts = timeline.accounts.map((a) => a.startDate).filter((s): s is string => !!s)
    if (starts.length) return starts.sort()[0]
    return timeline.events[0]?.date ?? today
  }, [timeline, today])

  const series = useMemo(() => {
    const r = RANGES.find((x) => x.key === range)!
    const from =
      r.days == null
        ? fundStart
        : new Date(Date.parse(today + 'T00:00:00Z') - (r.days - 1) * DAY).toISOString().slice(0, 10)
    return buildDailySeries(timeline, from, today)
  }, [timeline, range, today, fundStart])

  const spansYears =
    series.length > 1 && series[0].date.slice(0, 4) !== series[series.length - 1].date.slice(0, 4)

  const { paths, yMin, yMax, xFor, yFor } = useMemo(() => {
    let lo = Infinity
    let hi = -Infinity
    for (const p of series) {
      const candidates: Array<number | null> = [
        vis.invested ? p.invested : null,
        vis.promised ? p.promised : null,
        vis.value ? p.value : null,
      ]
      for (const v of candidates) {
        if (v == null) continue
        if (v < lo) lo = v
        if (v > hi) hi = v
      }
    }
    if (!Number.isFinite(lo)) {
      lo = 0
      hi = 1
    }
    if (hi - lo < 1) hi = lo + 1
    /**
     * Round the axis to numbers a person would say out loud.
     *
     * It used to be raw data bounds plus 8% padding, which produced labels like
     * "−$850.45 / $7.2k / $15.3k" — three arbitrary figures that tell you nothing and make the
     * chart look like it is hiding a decimal. Snapping to a 1 / 2 / 2.5 / 5 × 10ⁿ step gives
     * ticks that land on round money, so the gridlines mean something at a glance.
     */
    // Four intervals' worth of step, then snap. No extra padding: rounding UP to the next round
    // number already leaves headroom, and padding first only pushes it a whole step further —
    // which is how a $14k chart ended up with a $20k ceiling and half the height unused.
    // Five intervals, not four: at four, a $21.4k fund asked for a 5.4k step, rounded to 10k, and
    // drew a $30k ceiling with 29% of the height empty. Five asks for 4.3k, rounds to 5k, and
    // lands at $25k.
    const step = niceStep((hi - Math.min(0, lo)) / 5)
    // Don't invent negative space. The floor is 0 unless something actually goes below it.
    const yMin = lo >= 0 ? 0 : Math.floor(lo / step) * step
    const yMax = Math.max(Math.ceil(hi / step) * step, yMin + step)
    const innerW = W - PAD.left - PAD.right
    const innerH = H - PAD.top - PAD.bottom
    const xFor = (i: number) =>
      PAD.left + (series.length <= 1 ? innerW / 2 : (i / (series.length - 1)) * innerW)
    const yFor = (v: number) => PAD.top + innerH - ((v - yMin) / (yMax - yMin)) * innerH

    const line = (get: (p: (typeof series)[number]) => number | null) => {
      let d = ''
      let pen = false
      series.forEach((p, i) => {
        const v = get(p)
        if (v == null) {
          pen = false
          return
        }
        d += `${pen ? 'L' : 'M'}${xFor(i).toFixed(1)},${yFor(v).toFixed(1)}`
        pen = true
      })
      return d
    }
    return {
      paths: {
        value: vis.value ? line((p) => p.value) : '',
        invested: vis.invested ? line((p) => p.invested) : '',
        promised: vis.promised ? line((p) => p.promised) : '',
      },
      yMin,
      yMax,
      xFor,
      yFor,
    }
  }, [series, vis.value, vis.invested, vis.promised, W, H, PAD])

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current
    if (!svg || series.length === 0) return
    const rect = svg.getBoundingClientRect()
    const frac = (e.clientX - rect.left) / rect.width
    const x = frac * W
    const innerW = W - PAD.left - PAD.right
    const i = Math.round(((x - PAD.left) / innerW) * (series.length - 1))
    setHover(Math.max(0, Math.min(series.length - 1, i)))
  }

  /**
   * ⚠️ THE READING HAPPENS FIRST AND THE CAPTURE IS ALLOWED TO FAIL — the same order as
   * HoldButton, and for the same reason. Capture is an enhancement: it keeps the crosshair
   * following a finger that has slid off the chart, which is most of a drag on a phone. It is
   * not what the control is FOR, so it cannot be allowed to take the control down with it.
   *
   * It does fail: `setPointerCapture` throws `NotFoundError` for every synthetic `pointerId`
   * except 1, so any probe that invents an id would kill whatever ran after the call. A real
   * finger always has a live pointer, which is exactly why this would never show up from use.
   */
  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    onMove(e)
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* no capture; the crosshair simply stops at the edge of the chart */
    }
  }

  const hp = hover != null ? series[hover] : null
  const ticks = [0, 0.5, 1].map((f) => yMin + (yMax - yMin) * f)
  // readout carries weekday + year; the axis format adapts to the range width
  const fullDate = (isoDate: string) =>
    new Date(isoDate + 'T00:00:00').toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  const axisLabel = (isoDate: string) => {
    const d = new Date(isoDate + 'T00:00:00')
    if (range === '1W') return d.toLocaleDateString(undefined, { weekday: 'short' }) // Mon…Sun
    if (range === '1M') return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    if (spansYears) return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
    return d.toLocaleDateString(undefined, { month: 'short' })
  }
  /**
   * Which points get an x-axis label: every day in Week view, else as many as fit.
   *
   * ⚠️ AS MANY AS FIT, NOT ALWAYS SIX. Six dated labels across the 275px of drawing area a phone
   * has is 46px each for "Oct 25" — they touched, and in Month view they overlapped outright.
   * One label per 72px of inner width, which is the measured width of the longest format this
   * uses ("Oct 2026") plus breathing room.
   */
  const innerW = Math.max(1, W - PAD.left - PAD.right)
  const maxTicks = Math.max(2, Math.min(6, Math.floor(innerW / 72)))
  const xTickIdx =
    series.length <= 1
      ? [0]
      : range === '1W'
        ? series.map((_, i) => i)
        : Array.from({ length: Math.min(maxTicks, series.length) }, (_, k) =>
            Math.round((k * (series.length - 1)) / (Math.min(maxTicks, series.length) - 1)),
          ).filter((v, i, a) => a.indexOf(v) === i)

  // Days the fund actually placed orders (real money in/out — not zero-dollar split fixes),
  // so the chart can mark them and the readout can name what was ordered that day.
  const ordersByDay = useMemo(() => {
    const m = new Map<string, { cost: number; count: number }>()
    for (const e of timeline.events) {
      if (!e.cost) continue
      const cur = m.get(e.date) ?? { cost: 0, count: 0 }
      cur.cost += e.cost
      cur.count += 1
      m.set(e.date, cur)
    }
    return m
  }, [timeline])

  const pricesThrough = useMemo(() => {
    let last = ''
    for (const p of timeline.prices) if (p.date > last) last = p.date
    return last || null
  }, [timeline])

  return (
    <article className="card" style={{ display: 'grid', gap: '0.6rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
        <strong>{title ?? 'Over time'}</strong>
        <span style={{ display: 'inline-flex', gap: '0.25rem', marginLeft: 'auto' }}>
          {RANGES.map((r) => (
            <button
              key={r.key}
              /* inv-pick: the two picker rows this chart owns, named so the touch-target rule in
                 index.css can reach them without also raising every ghost button in the room —
                 most of which only exist behind an account and cannot be measured from here */
              className="btn btn-ghost inv-pick"
              onClick={() => {
                setRange(r.key)
                setHover(null)
              }}
              aria-pressed={range === r.key}
              style={{
                fontSize: '0.74rem',
                padding: '0.2rem 0.55rem',
                background: range === r.key ? 'var(--accent,#7c6af7)' : 'transparent',
                color: range === r.key ? '#fff' : 'inherit',
                borderColor: range === r.key ? 'transparent' : undefined,
              }}
            >
              {r.label}
            </button>
          ))}
        </span>
      </div>

      {/**
       * The hovered day, or the latest one.
       *
       * ⚠️ IT RESERVES ITS HEIGHT, BECAUSE IT USED TO PUSH THE CHART AROUND AS YOU READ IT. The
       * items here are conditional — the cash split only on a day with cash, the order marker
       * only on a day money moved — so dragging across the chart added and removed lines and the
       * drawing underneath slid up and down under the finger that was pointing at it. A readout
       * that moves the thing it describes is worse than no readout.
       *
       * `.inv-readout` holds two rows open whether or not they are filled. Measured by dragging
       * across every day in range: the SVG's top offset does not change.
       */}
      <div className={'cz-num inv-readout' + (details ? ' is-detailed' : '')}>
        {(() => {
          const p = hp ?? series[series.length - 1]
          if (!p) return <span className="muted">No activity in this range yet.</span>
          const order = ordersByDay.get(p.date)
          return (
            <>
              <span className="muted">{fullDate(p.date)}</span>
              {vis.value && p.value != null && (
                <span style={{ color: LINES[0].color, fontWeight: 700 }}>Worth {usd(p.value)}</span>
              )}
              {/* Only when there IS cash — otherwise this is a breakdown of one number into
                  itself. With cash, it is the line that reconciles this chart against the card
                  above it, which counts the shares only. */}
              {vis.value && p.value != null && p.cash > 0.005 && (
                <span className="muted" style={{ fontSize: '0.78rem' }}>
                  {usd(p.shares ?? 0)} in shares + {usd(p.cash)} cash
                </span>
              )}
              {vis.invested && (
                <span style={{ color: LINES[1].color, fontWeight: 700 }}>
                  Put in {usd(p.invested)}
                </span>
              )}
              {vis.promised && <span className="muted">Planned {usd(p.promised)}</span>}
              {order && (
                <span style={{ color: order.cost < 0 ? 'var(--loss)' : 'var(--accent,#7c6af7)' }}>
                  ● {order.cost < 0 ? 'Sold' : 'Ordered'} {usd(Math.abs(order.cost))}
                  {order.count > 1 ? ` · ${order.count} orders` : ''}
                </span>
              )}
            </>
          )
        })()}
      </div>

      {/* the measured box — the svg fills it, so one SVG unit is one CSS pixel */}
      <div ref={boxRef} style={{ width: '100%' }}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          style={{
            width: '100%',
            height: H,
            display: 'block',
            touchAction: 'pan-y',
            cursor: 'crosshair',
          }}
          onPointerMove={onMove}
          onPointerDown={onDown}
          /**
           * ⚠️ A MOUSE LEAVING MEANS "DONE"; A FINGER LIFTING DOES NOT. Clearing on every
           * pointerleave wiped the figure the instant a thumb came off the glass, so on a phone
           * the readout existed only while something was covering the chart. A tap should leave
           * the number on screen to be read.
           */
          onPointerLeave={(e) => {
            if (e.pointerType === 'mouse') setHover(null)
          }}
          role="img"
          aria-label={`What this is worth over time${details ? ', with money put in and the plan' : ''}`}
        >
          {/* y grid + labels */}
          {ticks.map((v) => (
            <g key={v}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={yFor(v)}
                y2={yFor(v)}
                stroke="rgba(127,127,127,0.18)"
                strokeDasharray="3 4"
              />
              <text
                x={PAD.left - 6}
                y={yFor(v) + 3}
                textAnchor="end"
                fontSize="10"
                fill="currentColor"
                opacity={0.55}
              >
                {compact(v)}
              </text>
            </g>
          ))}
          {/* fund-order rug: a tick under the axis on each day money went in or out */}
          {series.map((p, i) => {
            const o = ordersByDay.get(p.date)
            if (!o) return null
            const sell = o.cost < 0
            return (
              <line
                key={`o${i}`}
                x1={xFor(i)}
                x2={xFor(i)}
                y1={H - PAD.bottom}
                y2={H - PAD.bottom - 6}
                stroke={sell ? 'var(--loss)' : 'var(--accent,#7c6af7)'}
                strokeWidth="1.6"
                opacity={0.65}
              />
            )
          })}
          {/* x labels: weekdays (Week), dated ticks (Month), months (Year/All) */}
          {series.length > 0 &&
            xTickIdx.map((i) => (
              <text
                key={i}
                x={xFor(i)}
                y={H - 8}
                textAnchor={i === 0 ? 'start' : i === series.length - 1 ? 'end' : 'middle'}
                fontSize="10"
                fill="currentColor"
                opacity={0.55}
              >
                {axisLabel(series[i].date)}
              </text>
            ))}

          {paths.promised && (
            <path
              d={paths.promised}
              fill="none"
              stroke={LINES[2].color}
              strokeWidth="1.4"
              strokeDasharray="5 4"
            />
          )}
          {paths.invested && (
            <path d={paths.invested} fill="none" stroke={LINES[1].color} strokeWidth="2" />
          )}
          {paths.value && (
            <path d={paths.value} fill="none" stroke={LINES[0].color} strokeWidth="2.2" />
          )}

          {/* crosshair */}
          {hp && hover != null && (
            <g>
              <line
                x1={xFor(hover)}
                x2={xFor(hover)}
                y1={PAD.top}
                y2={H - PAD.bottom}
                stroke="rgba(127,127,127,0.5)"
              />
              {vis.value && hp.value != null && (
                <circle cx={xFor(hover)} cy={yFor(hp.value)} r="3.5" fill={LINES[0].color} />
              )}
              {vis.invested && (
                <circle cx={xFor(hover)} cy={yFor(hp.invested)} r="3" fill={LINES[1].color} />
              )}
              {vis.promised && (
                <circle cx={xFor(hover)} cy={yFor(hp.promised)} r="2.5" fill={LINES[2].color} />
              )}
            </g>
          )}
        </svg>
      </div>

      {/* legend: tap a chip to show or hide that line, once the details are open */}
      <div
        style={{
          display: 'flex',
          gap: '0.5rem',
          flexWrap: 'wrap',
          alignItems: 'center',
          fontSize: '0.76rem',
        }}
      >
        {/**
         * ⚠️ IT SAYS WHAT IT WILL SHOW, not "Details". Measured on the live fund, the two hidden
         * lines are the plan and the money put in — which is the comparison the whole dollar-a-day
         * idea rests on, so the chip has to name them or nobody opens it.
         */}
        <button
          className="btn btn-ghost inv-pick"
          onClick={() => setDetails((d) => !d)}
          aria-expanded={details}
          style={{ padding: '0.2rem 0.6rem', fontSize: '0.76rem' }}
        >
          {details ? '✕ Just the worth' : 'Show money put in & plan'}
        </button>
        {details &&
          LINES.map((l) => (
            <button
              key={l.key}
              className="btn btn-ghost inv-pick"
              onClick={() => setShow((s) => ({ ...s, [l.key]: !s[l.key] }))}
              aria-pressed={show[l.key]}
              title={`${l.hint} — tap to ${show[l.key] ? 'hide' : 'show'}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                padding: '0.2rem 0.6rem',
                fontSize: '0.76rem',
                opacity: show[l.key] ? 1 : 0.45,
              }}
            >
              <span
                style={{
                  width: 14,
                  height: 4,
                  borderRadius: 2,
                  background: l.color,
                  display: 'inline-block',
                }}
              />
              {l.label}
            </button>
          ))}
        <span
          className="muted"
          style={{
            marginLeft: 'auto',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.3rem',
          }}
        >
          <span style={{ color: 'var(--accent,#7c6af7)' }}>●</span> order days ·{' '}
          {pricesThrough ? `prices through ${fullDate(pricesThrough)}` : 'daily'}
        </span>
      </div>
    </article>
  )
}
