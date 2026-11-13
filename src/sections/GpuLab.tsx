import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  CATEGORIES,
  FILTER_KEY,
  META,
  entries,
  listed,
  readFilter,
  readFlags,
  type Category,
  type Flags,
} from '../lab/catalog'
import { rescueFocus } from '../gpu/focusRescue'
import { DEMOS } from './labDemos'
import { labApi, noLabYet } from '../lab/feedback'
import { LabFeedback, type Viewer } from '../lab/LabFeedback'
import '../lab/lab-catalog.css'
import { motionReduced, onMotionChange } from '../ui/motion'
import '../gpu/lab.css'
import { TOY_EVENT, hashParam, toyHash } from '../lab/links'

/**
 * The Lab: experiments with WebGPU, one at a time.
 *
 * Each demo owns its controls and builds on LabStage, which owns the device, the canvas and every
 * way of failing. This page only chooses which one is mounted, and says in one line what it is —
 * a demo nobody can name is a pretty picture rather than an experiment.
 */

type DemoId = string

const KEY = 'lab_demo_v1'
function storedDemo(): DemoId {
  // a link to a toy (a "beat my run", a shared show) opens on that toy, whatever was open last
  const linked = hashParam('demo')
  if (linked && DEMOS.some((d) => d.id === linked)) return linked
  try {
    const v = localStorage.getItem(KEY)
    return DEMOS.some((d) => d.id === v) ? (v as DemoId) : 'swarm'
  } catch {
    return 'swarm'
  }
}

/** What the adapter says about itself, kept for the "what your GPU reports" fold. */
type Report = {
  vendor: string
  architecture: string
  description: string
  software: boolean
  format: string
  features: string[]
  limits: [string, number][]
}

/** The limits worth showing — the ones that decide what a page like this can do. */
const SHOWN_LIMITS = [
  'maxBufferSize',
  'maxStorageBufferBindingSize',
  'maxComputeWorkgroupsPerDimension',
  'maxComputeInvocationsPerWorkgroup',
  'maxComputeWorkgroupStorageSize',
  'maxTextureDimension2D',
  'maxBindGroups',
] as const

const bytes = (n: number) =>
  n >= 1 << 30 ? `${n / (1 << 30)} GiB` : n >= 1 << 20 ? `${n / (1 << 20)} MiB` : `${n / 1024} KiB`
const shownLimit = (name: string, n: number) => (/Size$/.test(name) ? bytes(n) : n.toLocaleString())

function reportOf(adapter: GPUAdapter, format: string): Report {
  const info = adapter.info
  return {
    vendor: info.vendor || 'not said',
    architecture: info.architecture || 'not said',
    description: info.description,
    software: info.isFallbackAdapter ?? false,
    format,
    features: [...adapter.features].sort(),
    limits: SHOWN_LIMITS.map((k) => [k, adapter.limits[k]]),
  }
}

const GUEST: Viewer = { authed: false, suspended: false, isAdmin: false }
const KNOWN = new Set(DEMOS.map((d) => d.id))

function storedFilter(): Category | 'all' {
  try {
    return readFilter(localStorage.getItem(FILTER_KEY))
  } catch {
    return 'all'
  }
}

export function GpuLab({ viewer = GUEST }: { viewer?: Viewer }) {
  const [demo, setDemo] = useState<DemoId>(storedDemo)
  /** one watcher round whichever toy is showing, keeping a keyboard player's place (focusRescue.ts) */
  const stopRescue = useRef<(() => void) | null>(null)
  const watchToy = useCallback((el: HTMLDivElement | null) => {
    stopRescue.current?.()
    stopRescue.current = el ? rescueFocus(el) : null
  }, [])
  // and a link clicked while the Lab is already open changes only the hash
  useEffect(() => {
    const on = () => {
      const linked = hashParam('demo')
      if (linked && DEMOS.some((d) => d.id === linked)) setDemo(linked)
    }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  /* arriving on a plain #lab, the address names the toy on screen too — otherwise a call would
     learn which toy you are on only once you picked another */
  useEffect(() => {
    if (hashParam('demo')) return
    const next = toyHash(location.hash, demo)
    if (!next) return
    history.replaceState(history.state, '', next)
    window.dispatchEvent(new Event(TOY_EVENT))
  }, [demo])
  const [report, setReport] = useState<Report | null>(null)
  /* ⚠️ STILL UNTIL ASKED, under reduced motion. Every demo here is motion, so none can simply
     paint once and stop the way the backdrop does — the picture would be all there is. Each draws
     its first frame still, and Run is somebody choosing to watch it move. */
  const [running, setRunning] = useState(() => !motionReduced())
  useEffect(() => onMotionChange(() => motionReduced() && setRunning(false)), [])

  /* ── the catalog: the owner's flags, the vote totals a member may see, this browser's favourites.
     ⚠️ NONE OF IT IS NEEDED TO PLAY. Without a backend, offline, or before the answer arrives,
     every experiment is listed exactly as it always was; the server can only take away what the
     owner hid, and add what a signed-in member may be shown. */
  const api = useMemo(() => labApi(), [])
  const [flags, setFlags] = useState<Map<string, Flags>>(() => new Map())
  /** the ids the database's catalog lists — null until it has answered, and if it never does */
  const [inCatalog, setInCatalog] = useState<Set<string> | null>(null)
  /* ⚠️ EVERY TOY SHOWN, AND THE FILTER ONLY FADES (Evan, 9 Nov). A dropdown and a separate catalog
     with search, Recent, New and Highly rated replaced the row of names on 8 Nov; played with,
     the row was missed — seeing everything at once is the point of a lab. So all of them are
     buttons again, and choosing a kind fades the rest rather than hiding them: still one press
     away, just quieter. All is the default, and the choice is kept in this browser. */
  const [filter, setFilter] = useState<Category | 'all'>(storedFilter)
  const chooseFilter = (f: Category | 'all') => {
    setFilter(f)
    try {
      localStorage.setItem(FILTER_KEY, f)
    } catch {
      /* private mode: kept for this visit */
    }
  }
  /* ⚠️ THE FRONTEND CAN REACH PRODUCTION BEFORE ITS SQL DOES. Measured with every lab_* call
     answering as PostgREST does for a function that does not exist: a member was offered 👍 👎 and
     a note form, and a vote came back "Couldn't reach the server". So a catalog that is MISSING —
     not one that failed to arrive — closes feedback the way a build with no backend already does. */
  const [noFeedback, setNoFeedback] = useState(false)
  useEffect(() => {
    if (!api) return
    let live = true
    api
      .catalog()
      .then(async (raw) => {
        if (!live) return
        const ids = (r: unknown) =>
          new Set(
            Array.isArray(r)
              ? r.flatMap((x) => {
                  const id = (x as { id?: unknown })?.id
                  return typeof id === 'string' ? [id] : []
                })
              : [],
          )
        setFlags(readFlags(raw, KNOWN))
        const seen = ids(raw)
        // the owner's own Lab registers an experiment the database has not met yet
        const fresh = DEMOS.map((d) => d.id).filter((id) => !seen.has(id))
        if (viewer.isAdmin && fresh.length && (await api.register(fresh)) > 0 && live) {
          const again = await api.catalog()
          if (!live) return
          setFlags(readFlags(again, KNOWN))
          return setInCatalog(ids(again))
        }
        // only an answer that is a list says what is missing from it
        if (Array.isArray(raw)) setInCatalog(seen)
      })
      .catch((e: unknown) => {
        /* no catalog: every experiment stays listed, nothing counted — the Lab still plays */
        if (live && noLabYet(e)) setNoFeedback(true)
      })
    return () => {
      live = false
    }
  }, [api, viewer.authed, viewer.isAdmin])
  const all = useMemo(() => entries(DEMOS, flags), [flags])
  const visible = useMemo(() => all.filter((e) => listed(e, viewer.isAdmin)), [all, viewer.isAdmin])
  const shownDemos = useMemo(() => {
    const ids = new Set(visible.map((e) => e.id))
    return DEMOS.filter((d) => ids.has(d.id))
  }, [visible])

  const pick = (id: DemoId) => {
    setDemo(id)
    try {
      localStorage.setItem(KEY, id)
    } catch {
      /* private mode: it applies for this visit */
    }
    /* the address names the toy, so it can be copied, reloaded, and read by a call (party.ts).
       ⚠️ REPLACED, NOT PUSHED: trying ten toys is not ten pages, and Back still leaves the Lab
       the way it always did. replaceState fires no hashchange, so nothing re-routes. */
    const next = toyHash(location.hash, id)
    if (next) {
      history.replaceState(history.state, '', next)
      window.dispatchEvent(new Event(TOY_EVENT))
    }
  }
  const patchFlags = (id: string, patch: Partial<Flags>) =>
    setFlags((was) => {
      const next = new Map(was)
      next.set(id, {
        ...(was.get(id) ?? { featured: false, experiment: false, hidden: false }),
        ...patch,
      })
      return next
    })
  const onAdapter = (adapter: GPUAdapter, format: GPUTextureFormat) =>
    setReport(reportOf(adapter, format))
  const props = { running, setRunning, onAdapter }
  // a demo the owner hid is not offered; somebody who had it open lands on the first one listed
  const at = Math.max(
    0,
    shownDemos.findIndex((d) => d.id === demo),
  )
  const current = shownDemos[at] ?? DEMOS[0]
  const currentFlags = flags.get(current.id)

  const counts = useMemo(() => {
    const n = new Map<Category, number>()
    for (const d of shownDemos) {
      const c = META[d.id]?.category
      if (c) n.set(c, (n.get(c) ?? 0) + 1)
    }
    return n
  }, [shownDemos])
  return (
    <div className="lab">
      <div className="lab-filter" role="group" aria-label="Show which kind">
        <button
          className="btn btn-ghost"
          aria-pressed={filter === 'all'}
          onClick={() => chooseFilter('all')}
        >
          All {shownDemos.length}
        </button>
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            className="btn btn-ghost"
            aria-pressed={filter === c.id}
            onClick={() => chooseFilter(filter === c.id ? 'all' : c.id)}
          >
            {c.label.split(' — ')[0]} {counts.get(c.id) ?? 0}
          </button>
        ))}
      </div>
      <div className="lab-picker" role="group" aria-label="Which experiment">
        {shownDemos.map((d) => {
          const other = filter !== 'all' && META[d.id]?.category !== filter
          return (
            <button
              key={d.id}
              className={`btn btn-ghost${other ? ' lab-other' : ''}`}
              aria-pressed={current.id === d.id}
              onClick={() => pick(d.id)}
            >
              {d.name}
            </button>
          )
        })}
      </div>

      <p className="lab-line">
        {currentFlags?.featured && <span className="lab-badge">⭐ Featured</span>}
        {currentFlags?.experiment && <span className="lab-badge">🧪 Rough edges</span>}
        {viewer.isAdmin && currentFlags?.hidden && (
          <span className="lab-badge lab-badge-off">🙈 Hidden</span>
        )}
        {current.line}
      </p>

      {/* keyed, so a switch is a whole new device rather than one demo inheriting another's; the
          wrapper lays nothing out (display: contents) and is only there to be watched */}
      <div className="lab-toy" ref={watchToy}>
        <current.Demo key={current.id} {...props} />
      </div>

      <LabFeedback
        api={noFeedback ? null : api}
        demo={current.id}
        name={current.name}
        flags={currentFlags}
        viewer={viewer}
        onFlags={patchFlags}
        listed={inCatalog ? inCatalog.has(current.id) : undefined}
      />

      {report && <GpuReport report={report} />}
    </div>
  )
}

/** label and value for each row of the report, in the order they read best */
function facts(report: Report): [string, ReactNode][] {
  return [
    ['Vendor', report.vendor],
    ['Architecture', report.architecture],
    ...(report.description ? [['Description', report.description] as [string, ReactNode]] : []),
    ['Canvas format', <code>{report.format}</code>],
    ...report.limits.map(([name, n]): [string, ReactNode] => [name, shownLimit(name, n)]),
  ]
}

function GpuReport({ report }: { report: Report }) {
  return (
    <details className="lab-report">
      <summary>What your GPU reports</summary>
      {report.software && (
        <p className="lab-warn">
          This is a software renderer — the browser is imitating a GPU on the processor, so expect
          it to be slow. A real graphics card is usually being withheld for a driver reason.
        </p>
      )}
      <dl className="lab-facts">
        {facts(report).map(([name, value]) => (
          <div key={name} className="lab-fact">
            <dt>{name}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="muted lab-features-head">Optional features: {report.features.length}</p>
      {report.features.length > 0 ? (
        <ul className="lab-features">
          {report.features.map((f) => (
            <li key={f}>
              <code>{f}</code>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">None beyond the core set.</p>
      )}
    </details>
  )
}
