// Interactive portfolio-over-time chart: worth / net in / promised lines with
// week / month / year / all ranges, a hover (or touch) crosshair readout, and a
// clickable legend that shows or hides each line. Hand-rolled SVG to match the
// Circuit's charts — no chart library.
import { useMemo, useRef, useState } from 'react'
import { buildDailySeries, type Timeline } from '../finance/timeline'
import { usd } from '../finance/portfolio'

const RANGES = [
  { key: '1W', days: 7, label: 'Week' },
  { key: '1M', days: 30, label: 'Month' },
  { key: '1Y', days: 365, label: 'Year' },
  { key: 'ALL', days: null, label: 'All' },
] as const
type RangeKey = (typeof RANGES)[number]['key']

const W = 720
const H = 260
const PAD = { top: 14, right: 14, bottom: 26, left: 56 }
const DAY = 86_400_000

const LINES = [
  {
    key: 'value' as const,
    label: 'Worth',
    hint: 'What the holdings are worth at each day’s prices',
    color: '#22cc78',
  },
  {
    key: 'invested' as const,
    label: 'Net in',
    hint: 'Money put in minus money taken out, at cost',
    color: '#7c6af7',
  },
  {
    key: 'promised' as const,
    label: 'Promised',
    hint: 'The $-per-day plan line',
    color: 'rgba(150,150,170,0.9)',
  },
]
type LineKey = (typeof LINES)[number]['key']

const compact = (n: number) =>
  n >= 1000 ? `$${(n / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })}k` : usd(n)

export function PortfolioChart({ timeline, title }: { timeline: Timeline; title?: string }) {
  const [range, setRange] = useState<RangeKey>('1M')
  const [hover, setHover] = useState<number | null>(null)
  const [show, setShow] = useState<Record<LineKey, boolean>>({
    value: true,
    invested: true,
    promised: true,
  })
  const svgRef = useRef<SVGSVGElement | null>(null)

  const today = new Date().toISOString().slice(0, 10)

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
        show.invested ? p.invested : null,
        show.promised ? p.promised : null,
        show.value ? p.value : null,
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
    const pad = (hi - lo) * 0.08
    const yMin = Math.min(0, lo - pad)
    const yMax = hi + pad
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
        value: show.value ? line((p) => p.value) : '',
        invested: show.invested ? line((p) => p.invested) : '',
        promised: show.promised ? line((p) => p.promised) : '',
      },
      yMin,
      yMax,
      xFor,
      yFor,
    }
  }, [series, show])

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

  const hp = hover != null ? series[hover] : null
  const ticks = [0, 0.5, 1].map((f) => yMin + (yMax - yMin) * f)
  // readout always carries the year; axis adds it when the window crosses years
  const fullDate = (isoDate: string) =>
    new Date(isoDate + 'T00:00:00').toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  const axisDate = (isoDate: string) =>
    new Date(isoDate + 'T00:00:00').toLocaleDateString(
      undefined,
      spansYears ? { month: 'short', year: 'numeric' } : { month: 'short', day: 'numeric' },
    )

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
              className="btn btn-ghost"
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

      {/* readout: hovered day (or the latest) */}
      <div
        className="cz-num"
        style={{ display: 'flex', gap: '1.1rem', flexWrap: 'wrap', fontSize: '0.82rem' }}
      >
        {(() => {
          const p = hp ?? series[series.length - 1]
          if (!p) return <span className="muted">No activity in this range yet.</span>
          return (
            <>
              <span className="muted">{fullDate(p.date)}</span>
              {show.value && p.value != null && (
                <span style={{ color: LINES[0].color, fontWeight: 700 }}>Worth {usd(p.value)}</span>
              )}
              {show.invested && (
                <span style={{ color: LINES[1].color, fontWeight: 700 }}>
                  Net in {usd(p.invested)}
                </span>
              )}
              {show.promised && <span className="muted">Promised {usd(p.promised)}</span>}
            </>
          )
        })()}
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', height: 'auto', touchAction: 'pan-y', cursor: 'crosshair' }}
        onPointerMove={onMove}
        onPointerDown={onMove}
        onPointerLeave={() => setHover(null)}
        role="img"
        aria-label="Portfolio worth, net in, and promised over time"
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
        {/* x labels: first / middle / last */}
        {series.length > 0 &&
          [0, Math.floor((series.length - 1) / 2), series.length - 1]
            .filter((i, idx, a) => a.indexOf(i) === idx)
            .map((i) => (
              <text
                key={i}
                x={xFor(i)}
                y={H - 8}
                textAnchor={i === 0 ? 'start' : i === series.length - 1 ? 'end' : 'middle'}
                fontSize="10"
                fill="currentColor"
                opacity={0.55}
              >
                {axisDate(series[i].date)}
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
            {show.value && hp.value != null && (
              <circle cx={xFor(hover)} cy={yFor(hp.value)} r="3.5" fill={LINES[0].color} />
            )}
            {show.invested && (
              <circle cx={xFor(hover)} cy={yFor(hp.invested)} r="3" fill={LINES[1].color} />
            )}
            {show.promised && (
              <circle cx={xFor(hover)} cy={yFor(hp.promised)} r="2.5" fill={LINES[2].color} />
            )}
          </g>
        )}
      </svg>

      {/* legend: tap a chip to show/hide that line */}
      <div
        style={{
          display: 'flex',
          gap: '0.5rem',
          flexWrap: 'wrap',
          alignItems: 'center',
          fontSize: '0.76rem',
        }}
      >
        {LINES.map((l) => (
          <button
            key={l.key}
            className="btn btn-ghost"
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
        <span className="muted" style={{ marginLeft: 'auto' }}>
          {pricesThrough ? `Prices through ${fullDate(pricesThrough)} · ` : ''}daily resolution
        </span>
      </div>
    </article>
  )
}
