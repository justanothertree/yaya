/**
 * ── DEV-ONLY: the Circuit board, signed in, with no session ─────────────────────────────────────
 *
 * The grid half of recorded-once (OPEN-DECISIONS §19g) could not be reached in the Browser pane at
 * all: signed out, the Circuit runs on its local demo store, which has no sessions, no cell writer
 * and no refusals. So a cell that shows "12 from Chronicle sessions", a typed 20 stored as 8, and a
 * typed 10 refused had all shipped on unit tests and SQL alone.
 *
 * ⚠️ THE REAL ADAPTER, WITH A DOUBLE WHERE THE NETWORK WAS. `createSupabaseAdapter` runs unchanged
 * — the loads, `withSessions`, `cellChanges`, the cell writer and `CellRefused` — over a client that
 * answers from dev/chroniclePreview.ts. Replacing the adapter instead would have tested this file.
 *
 * ⚠️ ONE STORE WITH CHRONICLE'S PREVIEW. The people, the typed days and the sets are the ones the
 * Chronicle room reads, so a set counted at the counter lands in its cell, and a cell typed here is
 * the manual part a Gym goal adds. The server functions copied there are copied in their own words;
 * when the double and the room agree, that is still one source, not two (CLAUDE.md §2).
 *
 * Reached only through `connect.ts`, behind `import.meta.env.DEV && previewMember` and a dynamic
 * import, so the production bundle has no path to it. Grep `dist/` for `pv-friend` to check.
 *
 * NOT MODELLED, deliberately: the conversion (nobody in the double is converted, which is the only
 * state production can be in until a cutover), realtime for sets (§20b — there is none), admins.
 */
import { createSupabaseAdapter } from '../circuit/supabaseAdapter'
import type { CircuitAdapter } from '../circuit/adapter'
import { PREVIEW_GROUPS, PREVIEW_ME } from './previewMember'
import {
  pvCellSet,
  pvCircuitLogDrop,
  pvCircuitLogPut,
  pvCircuitLogs,
  pvCircuitPeople,
  pvGiveCircuit,
  pvSessionSums,
} from './chroniclePreview'

/** its own cache, so a real session on this origin never paints the preview's board */
const CACHE_KEY = 'circuit_preview_cache_v1'

type Row = Record<string, unknown>
type Answer = { data: unknown; error: { message: string; code: string } | null }
const ok = (data: unknown = null): Answer => ({ data, error: null })
const no = (message: string): Answer => ({ data: null, error: { message, code: 'P0001' } })

/**
 * Somebody else's person, linked to their own account: on a member's board it is read-only, and the
 * cell writer refuses it. ⚠️ THE PREVIEW HAS NO UID, so the grid's own `canEdit` lets you type into
 * it — which a signed-in board would not — and the refusal comes from the server's rule instead.
 */
const FRIEND = {
  id: 'pv-friend',
  name: 'Jordan',
  color: '#5aa0e6',
  goal: 60,
  exercises: [{ id: 'pv-fx-row', name: 'Row', unit: 'min', mult: 2, col: 0, row: 0 }],
  col_labels: ['Cardio'],
  owner_user_id: 'preview-jordan',
  visibility: 'members',
}

/** the grid's layout for YOUR people — the part of circuit_people Chronicle does not read */
const layout = new Map<string, { name: string; color: string; goal: number; cols: string[] }>([
  ['pv-person', { name: 'Preview You', color: '#e6a05a', goal: 100, cols: ['Gym', 'Other'] }],
])
const place = new Map<string, { mult: number; col: number; row: number }>()

function peopleRows(): Row[] {
  const mine = pvCircuitPeople().map((p) => {
    const l = layout.get(p.id) ?? { name: p.id, color: '#888', goal: 100, cols: ['Exercises'] }
    return {
      id: p.id,
      name: l.name,
      color: l.color,
      goal: l.goal,
      exercises: p.exercises.map((x, i) => ({
        id: x.id,
        name: x.name,
        unit: x.unit ?? 'reps',
        ...(place.get(x.id) ?? { mult: 1, col: i < 2 ? 0 : 1, row: i < 2 ? i : i - 2 }),
      })),
      col_labels: l.cols,
      owner_user_id: PREVIEW_ME.id,
      visibility: 'private',
    }
  })
  return [...mine, FRIEND]
}

function logRows(): Row[] {
  return pvCircuitLogs().map((g) => ({
    id: g.id,
    person_id: g.person,
    date: g.date,
    entries: g.entries,
    img: null,
    picture: g.picture ?? null,
  }))
}

function select(table: string): Row[] {
  switch (table) {
    case 'circuit_people':
      return peopleRows()
    case 'circuit_logs':
      return logRows()
    case 'circuit_person_groups':
      return [
        { person_id: 'pv-person', group_id: PREVIEW_GROUPS[0].id },
        { person_id: FRIEND.id, group_id: PREVIEW_GROUPS[0].id },
      ]
    case 'circuit_groups':
      return PREVIEW_GROUPS.map((g) => ({ ...g }))
    default:
      return []
  }
}

/** what a write to a watched table does: tells the board, a beat later, the way realtime would */
const handlers = new Set<() => void>()
const echo = () => setTimeout(() => handlers.forEach((h) => h()), 30)

function upsert(table: string, row: Row): Answer {
  if (table === 'circuit_logs') {
    const refused = pvCircuitLogPut({
      id: String(row.id),
      person: String(row.person_id),
      date: String(row.date),
      entries: (row.entries as Array<{ eid: string; val: number }>) ?? [],
    })
    if (refused) return no(refused.why)
    echo()
    return ok()
  }
  if (table === 'circuit_people') {
    const id = String(row.id)
    if (!pvCircuitPeople().some((p) => p.id === id)) {
      return no('new row violates row-level security policy for table "circuit_people"')
    }
    const ex = (row.exercises as Array<Record<string, unknown>>) ?? []
    for (const x of ex) {
      place.set(String(x.id), {
        mult: Number(x.mult) || 1,
        col: Number(x.col) || 0,
        row: Number(x.row) || 0,
      })
    }
    layout.set(id, {
      name: String(row.name),
      color: String(row.color ?? '#888'),
      goal: Number(row.goal) || 100,
      cols: (row.col_labels as string[]) ?? [],
    })
    /* ⚠️ the exercise list is the part Chronicle reads, so it goes back into the shared store */
    pvGiveCircuit(
      id,
      ex.map((x) => ({ id: String(x.id), name: String(x.name ?? ''), unit: String(x.unit ?? '') })),
    )
    echo()
    return ok()
  }
  /* films, pools, votes and ratings have nothing to do with the grid; accepted and forgotten */
  return ok()
}

function rpc(name: string, args: Record<string, unknown>): Answer {
  const from = String(args.p_from ?? '')
  const to = String(args.p_to ?? '')
  switch (name) {
    case 'circuit_session_sums':
      return ok(pvSessionSums(from, to))
    case 'circuit_manual_sums':
      return ok({ converted: [], manual: [] })
    case 'circuit_cell_set': {
      const got = pvCellSet(
        String(args.p_person),
        String(args.p_exercise),
        String(args.p_day),
        Number(args.p_total),
        Number(args.p_seen_sessions),
        Number(args.p_seen_manual),
      )
      if ('why' in got) return no(got.why)
      echo()
      return ok(got)
    }
    default:
      return no(`Could not find the function public.${name} in the schema cache`)
  }
}

/** a thenable that runs once awaited, and can be narrowed by `.eq()` first — PostgREST's shape */
function deleting(table: string) {
  const where: Record<string, string> = {}
  const run = (): Answer => {
    if (table === 'circuit_logs' && where.id) {
      pvCircuitLogDrop(where.id)
      echo()
    }
    return ok()
  }
  const q = {
    eq(col: string, v: string) {
      where[col] = v
      return q
    },
    then<T>(res: (a: Answer) => T, rej?: (e: unknown) => T) {
      return Promise.resolve(run()).then(res, rej)
    },
  }
  return q
}

const client = {
  from(table: string) {
    return {
      select: () => Promise.resolve(ok(select(table))),
      upsert: (row: Row) => Promise.resolve(upsert(table, row)),
      delete: () => deleting(table),
    }
  },
  rpc: (name: string, args: Record<string, unknown> = {}) => Promise.resolve(rpc(name, args)),
  channel() {
    const ch = {
      on(_kind: string, _filter: unknown, cb: () => void) {
        handlers.add(cb)
        return ch
      },
      subscribe(cb?: (status: string) => void) {
        cb?.('SUBSCRIBED')
        return ch
      },
    }
    return ch
  },
  removeChannel: () => {
    handlers.clear()
    return Promise.resolve('ok')
  },
}

type Client = NonNullable<NonNullable<Parameters<typeof createSupabaseAdapter>[0]>['client']>

/**
 * The adapter the Circuit gets in the preview. ⚠️ ITS CACHE IS CLEARED ON THE WAY IN, because the
 * store behind it is built fresh on every page load and the cache is not: a board painted from the
 * previous page would show cells this page's store has never held — and a check read straight
 * after a reload would be reading the cache, not the double.
 */
export function createPreviewCircuitAdapter(): CircuitAdapter {
  try {
    localStorage.removeItem(CACHE_KEY)
  } catch {
    /* the cache is an optimisation; without it the board loads from the double */
  }
  return createSupabaseAdapter({ client: client as unknown as Client, cacheKey: CACHE_KEY })
}
