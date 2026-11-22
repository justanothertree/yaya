/**
 * A stand-in for the four functions a member's profile page is written and read through, for the
 * page writer's tests (src/profile/pageWriter.test.ts).
 *
 * ⚠️ A FAITHFUL DOUBLE OR NOTHING. CLAUDE.md §2: "an unfaithful double looks exactly like a product
 * bug", and it hides bugs as well as inventing them. Every rule here is the live function's, read
 * with SELECT-only queries on 21 Nov 2026, and quoted beside the code that copies it. When one of
 * those functions changes, this file is wrong until it is changed to match.
 *
 * ⚠️ BY DEFAULT IT IS THE SERVER AFTER supabase/migrations/20261122215917_profile_page_version.sql: page
 * versions, and a save that locks the page and refuses an expected version that no longer matches.
 * `legacy()` is the server before it — no version function, no lock, no `p_expected_page` — which
 * is production until that draft is applied, and again after its rollback.
 *
 * It is a function that BUILDS a server, never a module-level store, so nothing here survives into
 * a production bundle by being reachable from it (CLAUDE.md, "a DEV-only harness is a claim about
 * the bundle").
 */

type Tier = 'private' | 'certain' | 'friends' | 'members' | 'public'
type Row = {
  id: string
  user_id: string
  block_type: string
  position: number
  size: string
  config: Record<string, unknown>
  visibility: Tier
}
type Member = { uid: string; username: string; suspended?: boolean; ceiling?: Tier }

export type Answer = {
  data: unknown
  error: { message: string; code?: string } | null
  status: number
}

const LADDER: Tier[] = ['private', 'certain', 'friends', 'members', 'public']
const TYPES = new Set([
  'bio',
  'banner',
  'stats',
  'activity',
  'guestbook',
  'status',
  'trophies',
  'song',
  'visualizer',
  'art',
  'pet',
  'looks',
  'free',
  'chronicle',
])

export function profileServerDouble() {
  const members: Member[] = []
  const tokens = new Map<string, string>()
  let rows: Row[] = []
  /** Certain lists by block id: "the names on it", stored lower-cased as the server does */
  const lists = new Map<string, string[]>()
  /** accepted friendships, both ways */
  const friends = new Set<string>()
  let ids = 0
  /** every call: which function, as whom, with what */
  const log: Array<{ fn: string; uid: string | null; args: Record<string, unknown> }> = []
  /** calls held until released, by function name */
  const holds = new Map<string, Array<() => void>>()
  const held = new Set<string>()
  /** 'request': the call never reaches the server; 'response': it runs, and its answer is lost */
  const drops = new Map<string, 'request' | 'response'>()
  /** "perform 1 from profiles where user_id = v_me for no key update": one save of a page at a time.
      Without it (`legacy()`) two overlapping saves both survive, as they did before 22 Nov 2026. */
  let locked = true
  /** whether the server has page versions (my_profile_page_version, p_expected_page) */
  let versioned = true
  let saving: Promise<void> = Promise.resolve()

  const byName = (name: string) =>
    members.find((m) => m.username.toLowerCase() === String(name).toLowerCase() && !m.suspended)
  const isFriend = (a: string, b: string) => friends.has(`${a}|${b}`)

  /* clamp_visibility: a tier no wider than the member's ceiling */
  const clamp = (uid: string, t: Tier): Tier => {
    const ceiling = members.find((m) => m.uid === uid)?.ceiling ?? 'public'
    return LADDER.indexOf(t) > LADDER.indexOf(ceiling) ? ceiling : t
  }

  /* can_see_item, as far as a page's blocks go */
  const canSee = (viewer: string, owner: string, row: Row): boolean => {
    if (viewer === owner) return true
    switch (row.visibility) {
      case 'public':
      case 'members':
        return true
      case 'friends':
        return isFriend(viewer, owner)
      case 'certain': {
        const me = members.find((m) => m.uid === viewer)?.username.toLowerCase()
        return !!me && (lists.get(row.id) ?? []).includes(me)
      }
      default:
        return false
    }
  }

  async function gate(fn: string) {
    if (!held.has(fn)) return
    await new Promise<void>((go) => {
      const q = holds.get(fn) ?? []
      q.push(go)
      holds.set(fn, q)
    })
  }

  const ok = (data: unknown): Answer => ({ data, error: null, status: 200 })
  /* PostgREST, asked for a function it does not have */
  const missing = (what: string): Answer => ({
    data: null,
    error: {
      message: `Could not find the function public.${what} in the schema cache`,
      code: 'PGRST202',
    },
    status: 404,
  })

  /**
   * profile_page_version(owner): the page as STORED — position, type, size, visibility, config and
   * the Certain list of every block, in order. Ids are not in it, so saving the same page again
   * leaves it. Opaque to the client, which only ever sends it back.
   */
  const versionOf = (uid: string) =>
    JSON.stringify(
      rows
        .filter((r) => r.user_id === uid)
        .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
        .map((r) => [
          r.position,
          r.block_type,
          r.size,
          r.visibility,
          r.config,
          [...(lists.get(r.id) ?? [])].sort(),
        ]),
    )
  const refuse = (message: string, status = 400): Answer => ({
    data: null,
    error: { message },
    status,
  })

  /* get_profile_blocks(p_username) */
  function getProfileBlocks(uid: string, name: string): Answer {
    const target = byName(name)
    /* "If there is NO target it returns '[]' with NO error" — never leak whether a member exists */
    if (!target) return ok([])
    const mine = rows
      .filter((r) => r.user_id === target.uid)
      .sort((a, b) => a.position - b.position)
      .filter((r) => canSee(uid, target.uid, r))
    return ok(
      mine.map((r) => ({
        id: r.id,
        block_type: r.block_type,
        position: r.position,
        size: r.size,
        config: structuredClone(r.config),
        visibility: r.visibility,
        /* the owner gets every list (canonical case, sorted by lower(username)); anyone else null */
        certain:
          target.uid === uid
            ? (lists.get(r.id) ?? [])
                .map((n) => members.find((m) => m.username.toLowerCase() === n)!.username)
                .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
            : null,
      })),
    )
  }

  /* get_member_profile(p_username): null for an unknown or suspended name; is_me = (target = viewer) */
  function getMemberProfile(uid: string, name: string): Answer {
    const target = byName(name)
    if (!target) return ok(null)
    return ok({ username: target.username, is_me: target.uid === uid })
  }

  /* save_my_profile_blocks(p_blocks, p_expected_page default null) */
  async function saveMyProfileBlocks(
    uid: string,
    blocks: unknown,
    expected: string | null,
  ): Promise<Answer> {
    const me = members.find((m) => m.uid === uid)
    if (me?.suspended) return refuse('your account is suspended')
    if (!Array.isArray(blocks)) return refuse('invalid blocks')
    if (blocks.length > 20) return refuse('too many blocks (max 20)')
    for (const b of blocks as Array<Record<string, unknown>>) {
      if (!TYPES.has(String(b.block_type))) return refuse('invalid block')
      if (!['small', 'medium', 'large'].includes(String(b.size))) return refuse('invalid block')
      if (b.visibility && !LADDER.includes(b.visibility as Tier)) return refuse('invalid block')
      if (JSON.stringify(b.config ?? {}).length > 64000) return refuse('invalid block')
      if (b.certain !== undefined && !Array.isArray(b.certain)) return refuse('invalid block')
      if (b.block_type === 'chronicle' && b.visibility === 'public')
        return refuse('a chronicle block cannot be public')
    }
    const total = (blocks as Array<Record<string, unknown>>).reduce(
      (n, b) => n + JSON.stringify(b.config ?? {}).length,
      0,
    )
    if (total > 160000) return refuse('profile too large')

    const write = async (): Promise<Answer> => {
      /* after the lock: "if p_expected_page is not null and p_expected_page is distinct from
         profile_page_version(v_me) then raise exception 'page changed' using errcode = 'PT409'" */
      if (expected !== null && expected !== versionOf(uid))
        return { data: null, error: { message: 'page changed', code: 'PT409' }, status: 409 }
      /* "DELETE FROM profile_blocks WHERE user_id = v_me" — the rows its snapshot can see */
      const gone = new Set(rows.filter((r) => r.user_id === uid).map((r) => r.id))
      await gate('save_my_profile_blocks:write')
      rows = rows.filter((r) => !gone.has(r.id))
      for (const id of gone) lists.delete(id)
      ;(blocks as Array<Record<string, unknown>>).forEach((b, i) => {
        const id = `blk-${++ids}`
        const visibility = clamp(uid, (b.visibility as Tier) ?? 'members')
        rows.push({
          id,
          user_id: uid,
          block_type: String(b.block_type),
          /* "position = ordinality" */
          position: i + 1,
          size: String(b.size),
          /* "coalesce(e->'config','{}')" — stored as sent */
          config: structuredClone((b.config as Record<string, unknown>) ?? {}),
          visibility,
        })
        if (visibility === 'certain') {
          /* at most 50, lower(btrim), accepted friends only, never self, distinct */
          const names: string[] = []
          for (const raw of ((b.certain as unknown[]) ?? []).slice(0, 50)) {
            const n = String(raw).trim().toLowerCase()
            const who = members.find((m) => m.username.toLowerCase() === n)
            if (!who || who.uid === uid || !isFriend(uid, who.uid) || names.includes(n)) continue
            names.push(n)
          }
          lists.set(id, names)
        }
      })
      /* "RETURNS jsonb_agg({position, visibility})" of the caller's rows, read after the insert */
      return ok(
        rows
          .filter((r) => r.user_id === uid)
          .sort((a, b) => a.position - b.position)
          .map((r) => ({ position: r.position, visibility: r.visibility })),
      )
    }
    if (!locked) return write()
    const run = saving.then(write)
    saving = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  /* chronicle_share_timeline(p_on): insert at max+1 when there is no card, else update in place */
  function chronicleShareTimeline(uid: string, on: boolean): Answer {
    const card = rows.find((r) => r.user_id === uid && r.block_type === 'chronicle')
    if (!card) {
      if (!on) return ok(false)
      const max = Math.max(0, ...rows.filter((r) => r.user_id === uid).map((r) => r.position))
      rows.push({
        id: `blk-${++ids}`,
        user_id: uid,
        block_type: 'chronicle',
        position: max + 1,
        size: 'medium',
        config: { timeline: true },
        visibility: 'friends',
      })
      return ok(true)
    }
    /* "UPDATEs config.timeline in place (id kept)" */
    card.config = { ...card.config, timeline: on }
    return ok(on)
  }

  return {
    /* ── setting the world up ── */
    member(uid: string, username: string, opts: { ceiling?: Tier } = {}) {
      members.push({ uid, username, ceiling: opts.ceiling })
      tokens.set(`tok-${uid}`, uid)
      return `tok-${uid}`
    },
    befriend(a: string, b: string) {
      friends.add(`${a}|${b}`)
      friends.add(`${b}|${a}`)
    },
    suspend(uid: string) {
      const m = members.find((x) => x.uid === uid)
      if (m) m.suspended = true
    },
    /** a handle change: profiles.username follows player_registry by ON UPDATE CASCADE */
    rename(uid: string, to: string) {
      const m = members.find((x) => x.uid === uid)
      if (m) m.username = to
    },
    /* ── what a test asks of it ── */
    pageOf(uid: string) {
      return rows
        .filter((r) => r.user_id === uid)
        .sort((a, b) => a.position - b.position)
        .map((r) => ({
          block_type: r.block_type,
          size: r.size,
          config: r.config,
          visibility: r.visibility,
          position: r.position,
          certain: r.visibility === 'certain' ? [...(lists.get(r.id) ?? [])].sort() : [],
        }))
    },
    log,
    calls: (fn: string) => log.filter((c) => c.fn === fn),
    hold(fn: string) {
      held.add(fn)
    },
    release(fn: string) {
      held.delete(fn)
      for (const go of holds.get(fn) ?? []) go()
      holds.delete(fn)
    },
    drop(fn: string, how: 'request' | 'response' | null) {
      if (how) drops.set(fn, how)
      else drops.delete(fn)
    },
    /** the server before the page-version migration (production until it is applied) */
    legacy(on = true) {
      locked = !on
      versioned = !on
    },
    /** the server, as a client calls it: a function name, its arguments and a bearer token */
    async rpc(fn: string, args: Record<string, unknown>, token: string | null): Promise<Answer> {
      const uid = (token && tokens.get(token)) ?? null
      log.push({ fn, uid, args: structuredClone(args) })
      await gate(fn)
      if (drops.get(fn) === 'request')
        return { data: null, error: { message: 'Failed to fetch' }, status: 0 }
      if (!uid) return refuse('not authenticated', 401)
      let answer: Answer
      switch (fn) {
        case 'get_profile_blocks':
          answer = getProfileBlocks(uid, String(args.p_username))
          break
        case 'get_member_profile':
          answer = getMemberProfile(uid, String(args.p_username))
          break
        case 'save_my_profile_blocks':
          /* the old server has one signature: a call naming p_expected_page finds no function */
          if (!versioned && 'p_expected_page' in args) {
            answer = missing('save_my_profile_blocks(p_blocks, p_expected_page)')
            break
          }
          answer = await saveMyProfileBlocks(
            uid,
            args.p_blocks,
            typeof args.p_expected_page === 'string' ? args.p_expected_page : null,
          )
          break
        case 'my_profile_page_version':
          answer = versioned ? ok(versionOf(uid)) : missing('my_profile_page_version')
          break
        case 'chronicle_share_timeline':
          answer = chronicleShareTimeline(uid, args.p_on === true)
          break
        default:
          answer = refuse(`no function ${fn}`, 404)
      }
      if (drops.get(fn) === 'response')
        return { data: null, error: { message: 'Failed to fetch' }, status: 0 }
      return answer
    },
  }
}

export type ProfileServerDouble = ReturnType<typeof profileServerDouble>
