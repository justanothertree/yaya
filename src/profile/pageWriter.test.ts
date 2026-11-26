import { describe, expect, it } from 'vitest'
import { profileServerDouble } from '../dev/profileServerDouble'
import type { ProfileBlock } from '../sections/ProfileBlocks'
import type { Song } from '../audio/songFile'
import { createPageWriter } from './pageWriter'

/**
 * The page writer against a faithful double of the server. Every expectation is about what the
 * server ends up holding and which calls were made — the world's shape — never about the writer's
 * own sums.
 */

type Block = ProfileBlock
const bio = (text: string, visibility: Block['visibility'] = 'members'): Block => ({
  block_type: 'bio',
  size: 'medium',
  config: { text },
  visibility,
})
const song = (name: string): Song => ({
  v: 1,
  name,
  bpm: 120,
  bars: 1,
  layers: [
    {
      instrument: 'keys',
      len: 2,
      fx: { echo: 0, echoTime: 0.3, space: 0, vibrato: 0, glide: 0, tone: 0.5 },
      muted: false,
      events: [
        { t: 0, midi: 60, on: true },
        { t: 0.5, midi: 60, on: false },
      ],
    },
  ],
})

function world() {
  const srv = profileServerDouble()
  const ann = srv.member('A', 'ann')
  const ann2 = 'tok-A' // a second device of the same member carries the same uid
  const bob = srv.member('B', 'bob')
  let session: { uid: string; token: string } | null = { uid: 'A', token: ann }
  const timers = new Map<number, () => void>()
  let tid = 0
  const writer = (lock?: <T>(n: string, fn: () => Promise<T>) => Promise<T>) =>
    createPageWriter({
      uid: 'A',
      rpc: (fn, args, token) => srv.rpc(fn, args, token),
      session: async () => session,
      lock: lock ?? ((_, fn) => fn()),
      setTimeout: (fn) => {
        const id = ++tid
        timers.set(id, fn)
        return id
      },
      clearTimeout: (id) => {
        timers.delete(id as number)
      },
    })
  /** run every timer that is due, as the clock moving on would */
  const tick = () => {
    const due = [...timers.values()]
    timers.clear()
    for (const fn of due) fn()
  }
  /** what the member's page holds, as text, for comparing whole pages */
  const page = (uid = 'A') => srv.pageOf(uid).map((b) => String(b.config.text ?? b.block_type))
  const seed = async (blocks: Block[], token = ann) => {
    await srv.rpc(
      'save_my_profile_blocks',
      { p_blocks: blocks.map((b) => ({ ...b, certain: [] })) },
      token,
    )
  }
  return {
    srv,
    ann,
    ann2,
    bob,
    writer,
    tick,
    page,
    seed,
    signIn: (s: typeof session) => (session = s),
  }
}

/** an editor's life: load, attach, and the copy it holds */
async function open(w: ReturnType<ReturnType<typeof world>['writer']>, name = 'ann') {
  const seed = await w.load(name)
  if ('failed' in seed) throw new Error(`could not open: ${seed.failed}`)
  const L = w.attach({ seedRev: seed.rev, seedBlocks: seed.page })
  return { L, page: seed.page as Block[] }
}

describe('a page is only ever written from what the server said', () => {
  it('an edit is saved, once, a moment after the typing stops', async () => {
    const t = world()
    await t.seed([bio('one'), bio('two')])
    const w = t.writer()
    const { L, page } = await open(w)
    for (let i = 0; i < 10; i++) w.stage(L, [{ ...page[0], config: { text: `one ${i}` } }, page[1]])
    t.tick()
    await w.idle()
    expect(t.page()).toEqual(['one 9', 'two'])
    /* ten changes in the debounce, one save — and the seeding save above was the other */
    expect(t.srv.calls('save_my_profile_blocks')).toHaveLength(2)
    expect(w.statusOf(L).kind).toBe('saved')
  })

  it('two saves of our own in a row are not taken for somebody else (the old "changed elsewhere")', async () => {
    const t = world()
    await t.seed([bio('one')])
    const w = t.writer()
    const { L, page } = await open(w)
    t.srv.hold('save_my_profile_blocks')
    w.stage(L, [{ ...page[0], config: { text: 'A' } }])
    t.tick()
    await Promise.resolve()
    /* while the first is in flight, a second edit, and the editor is closed */
    w.stage(L, [{ ...page[0], config: { text: 'B' } }])
    const orphans: unknown[] = []
    w.subscribe((e) => {
      if (e.type === 'orphan') orphans.push(e)
    })
    w.release(L)
    t.srv.release('save_my_profile_blocks')
    await w.idle()
    expect(t.page()).toEqual(['B'])
    expect(orphans).toHaveLength(0)
    /* and the two saves never overlapped: each started after the one before had answered */
    expect(t.srv.calls('save_my_profile_blocks')).toHaveLength(3)
  })

  it('a change made somewhere else is never saved over: refused, kept, and said', async () => {
    const t = world()
    await t.seed([bio('one')])
    const w = t.writer()
    const { L, page } = await open(w)
    /* another device adds a block */
    await t.seed([bio('one'), bio('from my phone')], t.ann2)
    w.stage(L, [{ ...page[0], config: { text: 'edited here' } }])
    t.tick()
    await w.idle()
    expect(t.page()).toEqual(['one', 'from my phone'])
    expect(w.statusOf(L)).toMatchObject({ kind: 'conflict', why: 'changed' })
  })

  it('a tier the server narrowed does not read as a change somewhere else at the next save', async () => {
    const t = world()
    t.srv.member('C', 'cat', { ceiling: 'friends' })
    const tok = 'tok-C'
    t.signIn({ uid: 'C', token: tok })
    const w = createPageWriter({
      uid: 'C',
      rpc: (fn, args, token) => t.srv.rpc(fn, args, token),
      session: async () => ({ uid: 'C', token: tok }),
      lock: (_, fn) => fn(),
      setTimeout: () => 0,
      clearTimeout: () => {},
    })
    await t.srv.rpc('save_my_profile_blocks', { p_blocks: [] }, tok)
    const seed = await w.load('cat')
    if ('failed' in seed) throw new Error(seed.failed)
    const L = w.attach({ seedRev: seed.rev, seedBlocks: seed.page })
    expect(await w.flushNow(L, [bio('hello', 'members')])).toEqual({ kind: 'saved', narrowed: [0] })
    expect(await w.flushNow(L, [bio('hello again', 'members')])).toMatchObject({ kind: 'saved' })
    expect(t.srv.pageOf('C').map((b) => [b.config.text, b.visibility])).toEqual([
      ['hello again', 'friends'],
    ])
  })

  it('a second editor opening on a newer page makes the first one’s copy stale, even with nothing else said', async () => {
    const t = world()
    await t.seed([bio('one')])
    const w = t.writer()
    const first = await open(w)
    /* another device changes the page; then a second editor in this tab (a pinned window) opens */
    await t.seed([bio('one'), bio('from my phone')], t.ann2)
    await open(w)
    w.stage(first.L, [bio('one, edited in the first editor')])
    t.tick()
    await w.idle()
    expect(t.page()).toEqual(['one', 'from my phone'])
    expect(w.statusOf(first.L)).toMatchObject({ kind: 'conflict', why: 'stale' })
  })
})

describe('whose page it is', () => {
  it('a handle changed while the editor was open: nothing is written, not even an empty page', async () => {
    const t = world()
    await t.seed([bio('mine')])
    const w = t.writer()
    const { L } = await open(w)
    t.srv.rename('A', 'anna')
    const saves = t.srv.calls('save_my_profile_blocks').length
    w.stage(L, [])
    t.tick()
    await w.idle()
    expect(t.srv.calls('save_my_profile_blocks')).toHaveLength(saves)
    expect(t.page()).toEqual(['mine'])
    expect(w.statusOf(L)).toMatchObject({ kind: 'conflict', why: 'not-yours' })
    /* and opening the old name again does not open an empty editor */
    expect(await w.load('ann')).toEqual({ failed: 'not-yours' })
  })

  it('the old handle taken by somebody else: their page is never written onto yours', async () => {
    const t = world()
    await t.seed([bio('mine')])
    const w = t.writer()
    const { L } = await open(w)
    t.srv.rename('A', 'anna')
    const cTok = t.srv.member('C', 'ann')
    await t.seed([bio('carols, public', 'public')], cTok)
    w.stage(L, [bio('mine, edited')])
    t.tick()
    await w.idle()
    expect(t.page('A')).toEqual(['mine'])
    expect(t.page('C')).toEqual(['carols, public'])
    expect(w.statusOf(L)).toMatchObject({ kind: 'conflict', why: 'not-yours' })
  })

  it('the session became somebody else before the save: nothing is written to either page', async () => {
    const t = world()
    await t.seed([bio('ann’s')])
    await t.seed([bio('bob’s')], t.bob)
    const w = t.writer()
    const { L } = await open(w)
    t.signIn({ uid: 'B', token: t.bob })
    w.stage(L, [bio('ann’s, edited')])
    t.tick()
    await w.idle()
    expect(t.page('A')).toEqual(['ann’s'])
    expect(t.page('B')).toEqual(['bob’s'])
    expect(w.statusOf(L)).toMatchObject({ kind: 'conflict', why: 'not-you' })
  })

  it('every request of a job carries the token it started with', async () => {
    const t = world()
    await t.seed([bio('one')])
    const w = t.writer()
    const { L } = await open(w)
    t.srv.hold('get_profile_blocks')
    const before = t.srv.log.length
    w.stage(L, [bio('two')])
    t.tick()
    for (let i = 0; i < 10; i++) await Promise.resolve()
    /* the session changes while the job's check is in flight */
    t.signIn({ uid: 'B', token: t.bob })
    t.srv.release('get_profile_blocks')
    await w.idle()
    const job = t.srv.log.slice(before)
    expect(job.map((c) => c.fn)).toEqual([
      'my_profile_page_version',
      'get_profile_blocks',
      'save_my_profile_blocks',
    ])
    expect(job.every((c) => c.uid === 'A')).toBe(true)
    expect(t.page('B')).toEqual([])
  })
})

describe('leaving the editor', () => {
  it('what could not be saved on the way out is handed to the page, not dropped', async () => {
    const t = world()
    await t.seed([bio('one')])
    const w = t.writer()
    const { L } = await open(w)
    const orphans: Array<{ why: string }> = []
    w.subscribe((e) => {
      if (e.type === 'orphan') orphans.push({ why: e.why })
    })
    await t.seed([bio('one'), bio('elsewhere')], t.ann2)
    w.stage(L, [bio('typed just before Done')])
    w.release(L)
    await w.idle()
    expect(t.page()).toEqual(['one', 'elsewhere'])
    expect(orphans).toEqual([{ why: 'changed' }])
    expect(w.takeOrphan()?.blocks.map((b) => b.config.text)).toEqual(['typed just before Done'])
  })

  it('Edit pressed while the exit save is in flight opens on what that save wrote', async () => {
    const t = world()
    await t.seed([bio('one')])
    const w = t.writer()
    const { L } = await open(w)
    t.srv.hold('save_my_profile_blocks')
    w.stage(L, [bio('typed, then Done, then Edit')])
    w.release(L)
    const again = w.load('ann')
    await Promise.resolve()
    t.srv.release('save_my_profile_blocks')
    const seed = await again
    if ('failed' in seed) throw new Error(seed.failed)
    expect(seed.page.map((b) => b.config.text)).toEqual(['typed, then Done, then Edit'])
    const order = t.srv.log.map((c) => c.fn)
    expect(order.lastIndexOf('save_my_profile_blocks')).toBeLessThan(
      order.lastIndexOf('get_profile_blocks'),
    )
  })
})

describe('when the server cannot be reached', () => {
  it('a check that cannot be made writes nothing, keeps the copy, and saves it once it can', async () => {
    const t = world()
    await t.seed([bio('one')])
    const w = t.writer()
    const { L } = await open(w)
    t.srv.drop('get_profile_blocks', 'request')
    w.stage(L, [bio('two')])
    t.tick()
    await w.idle()
    expect(t.page()).toEqual(['one'])
    expect(w.statusOf(L).kind).toBe('unverified')
    t.srv.drop('get_profile_blocks', null)
    t.tick()
    await w.idle()
    expect(t.page()).toEqual(['two'])
  })

  it('a save whose answer was lost is not sent twice, and is not taken for a change elsewhere', async () => {
    const t = world()
    await t.seed([bio('one')])
    const w = t.writer()
    const { L } = await open(w)
    t.srv.drop('save_my_profile_blocks', 'response')
    w.stage(L, [bio('two')])
    t.tick()
    await w.idle()
    expect(w.statusOf(L).kind).toBe('unacknowledged')
    t.srv.drop('save_my_profile_blocks', null)
    const before = t.srv.calls('save_my_profile_blocks').length
    t.tick()
    await w.idle()
    expect(t.srv.calls('save_my_profile_blocks')).toHaveLength(before)
    expect(t.page()).toEqual(['two'])
    expect(w.statusOf(L).kind).toBe('saved')
  })

  it('a save that never left is sent again', async () => {
    const t = world()
    await t.seed([bio('one')])
    const w = t.writer()
    const { L } = await open(w)
    t.srv.drop('save_my_profile_blocks', 'request')
    w.stage(L, [bio('two')])
    t.tick()
    await w.idle()
    expect(t.page()).toEqual(['one'])
    t.srv.drop('save_my_profile_blocks', null)
    t.tick()
    await w.idle()
    expect(t.page()).toEqual(['two'])
  })
})

describe('two writers at once', () => {
  it('two tabs sharing the lock take turns, and the second sees the first', async () => {
    const t = world()
    await t.seed([bio('one')])
    let held: Promise<unknown> = Promise.resolve()
    const lock = <T>(_: string, fn: () => Promise<T>): Promise<T> => {
      const next = held.then(fn)
      held = next.catch(() => undefined)
      return next
    }
    const tab1 = t.writer(lock)
    const tab2 = t.writer(lock)
    const a = await open(tab1)
    const b = await open(tab2)
    tab1.stage(a.L, [bio('from tab 1')])
    tab2.stage(b.L, [bio('from tab 2')])
    t.tick()
    await Promise.all([tab1.idle(), tab2.idle()])
    /* one of them saved; the other found the page changed and wrote nothing */
    expect([['from tab 1'], ['from tab 2']]).toContainEqual(t.page())
    const kinds = [tab1.statusOf(a.L), tab2.statusOf(b.L)].map((s) => s.kind).sort()
    expect(kinds).toEqual(['conflict', 'saved'])
  })

  it('on the server before page versions, two devices saving at once double the page, and it is said', async () => {
    const t = world()
    await t.seed([bio('one')])
    t.srv.legacy()
    const tab1 = t.writer()
    const tab2 = t.writer()
    const a = await open(tab1)
    const b = await open(tab2)
    t.srv.hold('save_my_profile_blocks:write')
    const one = tab1.flushNow(a.L, [bio('device 1')])
    const two = tab2.flushNow(b.L, [bio('device 2')])
    for (let i = 0; i < 20; i++) await Promise.resolve()
    t.srv.release('save_my_profile_blocks:write')
    const outs = (await Promise.all([one, two])).map((o) => o.kind)
    expect(t.page()).toHaveLength(2)
    expect(outs).toContain('collided')
  })
})

describe("the server's own check: a page version read before the page, sent with the save", () => {
  /** wait until the job's save has reached the server (it is logged before any hold) */
  const reached = async (t: ReturnType<typeof world>, n: number) => {
    for (let i = 0; i < 200 && t.srv.calls('save_my_profile_blocks').length < n; i++)
      await Promise.resolve()
    expect(t.srv.calls('save_my_profile_blocks')).toHaveLength(n)
  }

  it('a change from another device between the check and the save is refused, not deleted', async () => {
    const t = world()
    await t.seed([bio('one')])
    const w = t.writer()
    const { L } = await open(w)
    const saves = t.srv.calls('save_my_profile_blocks').length
    t.srv.hold('save_my_profile_blocks')
    w.stage(L, [bio('mine')])
    t.tick()
    await reached(t, saves + 1)
    /* the moment no read can cover: the job has checked the page and its save is on the way */
    await t.srv.rpc('chronicle_share_timeline', { p_on: true }, t.ann2)
    t.srv.release('save_my_profile_blocks')
    await w.idle()
    expect(t.page()).toEqual(['one', 'chronicle'])
    expect(w.statusOf(L)).toEqual({ kind: 'conflict', why: 'changed', unsaved: true })
    /* the refused copy is kept: leaving offers it back */
    w.release(L)
    await w.idle()
    expect(w.takeOrphan()?.blocks.map((b) => b.config.text)).toEqual(['mine'])
  })

  it('a change landing while the version is being read is never passed over', async () => {
    const t = world()
    await t.seed([bio('one')])
    const w = t.writer()
    const { L } = await open(w)
    t.srv.hold('my_profile_page_version')
    const asked = t.srv.calls('my_profile_page_version').length
    w.stage(L, [bio('mine')])
    t.tick()
    for (let i = 0; i < 200 && t.srv.calls('my_profile_page_version').length === asked; i++)
      await Promise.resolve()
    /* the version is read first, so whatever lands while it is in flight shows in the page read
       after it; read the other way round, this change would be in the version and not the page */
    await t.srv.rpc('chronicle_share_timeline', { p_on: true }, t.ann2)
    t.srv.release('my_profile_page_version')
    await w.idle()
    expect(t.page()).toEqual(['one', 'chronicle'])
    expect(w.statusOf(L).kind).toBe('conflict')
  })

  it('…and the same moment on the server before versions deletes that change, which is why', async () => {
    const t = world()
    await t.seed([bio('one')])
    t.srv.legacy()
    const w = t.writer()
    const { L } = await open(w)
    const saves = t.srv.calls('save_my_profile_blocks').length
    t.srv.hold('save_my_profile_blocks')
    w.stage(L, [bio('mine')])
    t.tick()
    await reached(t, saves + 1)
    await t.srv.rpc('chronicle_share_timeline', { p_on: true }, t.ann2)
    t.srv.release('save_my_profile_blocks')
    await w.idle()
    /* the null control: this is the gap, reached — the chronicle card went with no message */
    expect(t.page()).toEqual(['mine'])
    expect(w.statusOf(L).kind).toBe('saved')
  })

  it('on the server before versions, saves still work, ask for the version once, and never send one', async () => {
    const t = world()
    await t.seed([bio('one')])
    t.srv.legacy()
    const w = t.writer()
    const { L } = await open(w)
    w.stage(L, [bio('two')])
    t.tick()
    await w.idle()
    w.stage(L, [bio('three')])
    t.tick()
    await w.idle()
    expect(t.page()).toEqual(['three'])
    expect(t.srv.calls('my_profile_page_version')).toHaveLength(1)
    expect(t.srv.calls('save_my_profile_blocks').some((c) => 'p_expected_page' in c.args)).toBe(
      false,
    )
  })

  it('a rollback while a tab is open costs that tab one retry, not its saves', async () => {
    const t = world()
    await t.seed([bio('one')])
    const w = t.writer()
    const { L } = await open(w)
    w.stage(L, [bio('two')])
    t.tick()
    await w.idle()
    expect(t.srv.calls('save_my_profile_blocks').at(-1)?.args).toHaveProperty('p_expected_page')
    /* the migration is rolled back under the open tab, between a job's version read and its save */
    const saves = t.srv.calls('save_my_profile_blocks').length
    t.srv.hold('save_my_profile_blocks')
    w.stage(L, [bio('three')])
    t.tick()
    await reached(t, saves + 1)
    t.srv.legacy()
    t.srv.release('save_my_profile_blocks')
    await w.idle()
    expect(w.statusOf(L).kind).toBe('unverified')
    t.tick()
    await w.idle()
    expect(t.page()).toEqual(['three'])
    expect(w.statusOf(L).kind).toBe('saved')
  })

  it('two devices saving from the same read: one lands, the other is refused as changed', async () => {
    const t = world()
    await t.seed([bio('one')])
    const tab1 = t.writer()
    const tab2 = t.writer()
    const a = await open(tab1)
    const b = await open(tab2)
    t.srv.hold('save_my_profile_blocks:write')
    const one = tab1.flushNow(a.L, [bio('device 1')])
    const two = tab2.flushNow(b.L, [bio('device 2')])
    for (let i = 0; i < 40; i++) await Promise.resolve()
    t.srv.release('save_my_profile_blocks:write')
    const outs = (await Promise.all([one, two])).map((o) => o.kind).sort()
    expect(outs).toEqual(['changed', 'saved'])
    expect([['device 1'], ['device 2']]).toContainEqual(t.page())
  })

  it('a Put whose page changes between its read and its save says so and writes nothing', async () => {
    const t = world()
    await t.seed([bio('one')])
    const w = t.writer()
    const saves = t.srv.calls('save_my_profile_blocks').length
    t.srv.hold('save_my_profile_blocks')
    const put = w.put({ song: song('Tune'), name: 'ann', approved: null, uid0: 'A' })
    await reached(t, saves + 1)
    await t.srv.rpc('chronicle_share_timeline', { p_on: true }, t.ann2)
    t.srv.release('save_my_profile_blocks')
    expect(await put).toMatchObject({ kind: 'changed' })
    expect(t.page()).toEqual(['one', 'chronicle'])
  })

  it('a tab that saw the server before the migration asks again when an editor next opens', async () => {
    const t = world()
    await t.seed([bio('one')])
    t.srv.legacy()
    const w = t.writer()
    const first = await open(w)
    w.stage(first.L, [bio('two')])
    t.tick()
    await w.idle()
    w.release(first.L)
    /* the migration is applied while the tab stays open */
    t.srv.legacy(false)
    const again = await open(w)
    w.stage(again.L, [bio('three')])
    t.tick()
    await w.idle()
    expect(t.page()).toEqual(['three'])
    expect(t.srv.calls('save_my_profile_blocks').at(-1)?.args).toHaveProperty('p_expected_page')
  })
})

describe('🎵 Put it on my profile', () => {
  it('adds the song to the page as it is now, keeping everything else', async () => {
    const t = world()
    await t.seed([bio('one'), bio('two')])
    const w = t.writer()
    const out = await w.put({ song: song('Tune'), name: 'ann', approved: null, uid0: 'A' })
    expect(out).toMatchObject({ kind: 'saved', how: 'new block', song: 'Tune' })
    expect(t.page()).toEqual(['one', 'two', 'song'])
  })

  it('asks again before replacing a song it was not told it would replace', async () => {
    const t = world()
    await t.seed([bio('one')])
    const w = t.writer()
    await w.put({ song: song('Tune'), name: 'ann', approved: null, uid0: 'A' })
    const saves = t.srv.calls('save_my_profile_blocks').length
    expect(await w.put({ song: song('Tune'), name: 'ann', approved: null, uid0: 'A' })).toEqual({
      kind: 'ask',
      name: 'Tune',
    })
    expect(t.srv.calls('save_my_profile_blocks')).toHaveLength(saves)
    expect(
      await w.put({ song: song('Tune'), name: 'ann', approved: 'Tune', uid0: 'A' }),
    ).toMatchObject({ kind: 'saved', how: 'updated' })
  })

  it('a Put from outside the editor makes the open editor’s older copy stale, and the song survives', async () => {
    const t = world()
    await t.seed([bio('one')])
    const w = t.writer()
    const { L } = await open(w)
    await w.put({ song: song('Tune'), name: 'ann', approved: null, uid0: 'A' })
    /* stale at once, before a keystroke — and nothing of the editor's is unsaved yet */
    expect(w.statusOf(L)).toEqual({ kind: 'conflict', why: 'stale', unsaved: false })
    const saves = t.srv.calls('save_my_profile_blocks').length
    w.stage(L, [bio('one, edited')])
    t.tick()
    await w.idle()
    expect(t.srv.calls('save_my_profile_blocks')).toHaveLength(saves)
    expect(t.page()).toEqual(['one', 'song'])
    /* the refused change is kept, and the banner can say Reload would drop it */
    expect(w.statusOf(L)).toEqual({ kind: 'conflict', why: 'stale', unsaved: true })
  })

  it('pressed by one account and answered as another: nothing is written', async () => {
    const t = world()
    await t.seed([bio('one')])
    const w = t.writer()
    t.signIn({ uid: 'B', token: t.bob })
    expect(await w.put({ song: song('Tune'), name: 'ann', approved: null, uid0: 'A' })).toEqual({
      kind: 'not-you',
    })
    expect(t.page('A')).toEqual(['one'])
    expect(t.page('B')).toEqual([])
  })
})

describe('another writer of the page, and other tabs', () => {
  it('the chronicle switch writing the page under an open editor: the card survives, and the editor says so', async () => {
    const t = world()
    await t.seed([bio('one')])
    const w = t.writer()
    const { L } = await open(w)
    /* Chronicle's sharing switch calls the server itself (it is another thread's code) */
    await t.srv.rpc('chronicle_share_timeline', { p_on: true }, t.ann)
    const saves = t.srv.calls('save_my_profile_blocks').length
    w.stage(L, [bio('one, edited')])
    t.tick()
    await w.idle()
    expect(t.srv.calls('save_my_profile_blocks')).toHaveLength(saves)
    expect(t.srv.pageOf('A').map((b) => b.block_type)).toEqual(['bio', 'chronicle'])
    expect(w.statusOf(L)).toMatchObject({ kind: 'conflict', why: 'changed' })
  })

  it('another tab said it wrote: a changed page makes the open editor stale, an unchanged one does nothing', async () => {
    const t = world()
    await t.seed([bio('one')])
    const w = t.writer()
    const { L } = await open(w)
    await w.probe()
    expect(w.statusOf(L).kind).toBe('idle')
    await t.seed([bio('one'), bio('two')], t.ann2)
    await w.probe()
    expect(w.statusOf(L)).toMatchObject({ kind: 'conflict', why: 'stale' })
  })
})

describe('what the review of the first version found', () => {
  it('an Undo back to the saved copy while a save is in flight is sent, not dropped', async () => {
    const t = world()
    await t.seed([bio('one'), bio('keep me')])
    const w = t.writer()
    const { L, page } = await open(w)
    t.srv.hold('save_my_profile_blocks')
    w.stage(L, [page[0]])
    t.tick()
    for (let i = 0; i < 10; i++) await Promise.resolve()
    /* Undo, while the delete is being saved */
    w.stage(L, page)
    t.srv.release('save_my_profile_blocks')
    t.tick()
    await w.idle()
    t.tick()
    await w.idle()
    expect(t.page()).toEqual(['one', 'keep me'])
    expect(w.statusOf(L).kind).toBe('saved')
  })

  it('an Undo after a save whose answer was lost is sent once the answer is known', async () => {
    const t = world()
    await t.seed([bio('one'), bio('keep me')])
    const w = t.writer()
    const { L, page } = await open(w)
    t.srv.drop('save_my_profile_blocks', 'response')
    w.stage(L, [page[0]])
    t.tick()
    await w.idle()
    expect(t.page()).toEqual(['one'])
    t.srv.drop('save_my_profile_blocks', null)
    w.stage(L, page)
    t.tick()
    await w.idle()
    expect(t.page()).toEqual(['one', 'keep me'])
  })

  it('a Put into an open editor is answered by its own save, not by an older one in flight', async () => {
    const t = world()
    await t.seed([bio('one')])
    const w = t.writer()
    const { L } = await open(w)
    t.srv.hold('save_my_profile_blocks')
    w.stage(L, [bio('one, edited')])
    t.tick()
    for (let i = 0; i < 10; i++) await Promise.resolve()
    let answered: string | null = null
    const put = w
      .flushNow(L, [bio('one, edited'), bio('the song')])
      .then((o) => (answered = o.kind))
    /* the older save answers first, and the song's own check is held: the Put must still wait */
    t.srv.hold('get_profile_blocks')
    t.srv.release('save_my_profile_blocks')
    for (let i = 0; i < 30; i++) await Promise.resolve()
    expect(t.page()).toEqual(['one, edited'])
    expect(answered).toBeNull()
    t.srv.release('get_profile_blocks')
    await put
    expect(answered).toBe('saved')
    expect(t.page()).toEqual(['one, edited', 'the song'])
  })

  it('a recovered copy (Open them again) starts refused and unsaved, and leaving offers it back again', async () => {
    const t = world()
    await t.seed([bio('one')])
    const w = t.writer()
    await w.load('ann')
    const L = w.attach({ seedRev: -1, seedBlocks: [bio('what did not save')] })
    expect(w.statusOf(L)).toEqual({ kind: 'conflict', why: 'stale', unsaved: true })
    const saves = t.srv.calls('save_my_profile_blocks').length
    w.release(L)
    await w.idle()
    expect(t.srv.calls('save_my_profile_blocks')).toHaveLength(saves)
    expect(w.takeOrphan()?.blocks.map((b) => b.config.text)).toEqual(['what did not save'])
  })

  it('StrictMode opening a recovered copy twice offers nothing back while the second editor holds it', async () => {
    const t = world()
    await t.seed([bio('one')])
    const w = t.writer()
    await w.load('ann')
    const lost = [bio('what did not save')]
    /* React's development double mount: attach, release, attach — all before any job can run */
    w.release(w.attach({ seedRev: -1, seedBlocks: lost }))
    const L = w.attach({ seedRev: -1, seedBlocks: lost })
    await w.idle()
    expect(w.takeOrphan()).toBeNull()
    expect(w.statusOf(L)).toEqual({ kind: 'conflict', why: 'stale', unsaved: true })
    /* and the editor that stayed still offers it back when it goes */
    w.release(L)
    await w.idle()
    expect(w.takeOrphan()?.blocks.map((b) => b.config.text)).toEqual(['what did not save'])
  })

  it('a recovered copy that was CHANGED before its editor went is still offered back beside a new one', async () => {
    const t = world()
    await t.seed([bio('one')])
    const w = t.writer()
    await w.load('ann')
    const first = w.attach({ seedRev: -1, seedBlocks: [bio('what did not save')] })
    w.stage(first, [bio('what did not save, and more')])
    w.release(first)
    w.attach({ seedRev: -1, seedBlocks: [bio('what did not save')] })
    await w.idle()
    expect(w.takeOrphan()?.blocks.map((b) => b.config.text)).toEqual([
      'what did not save, and more',
    ])
  })

  it('a copy the server refuses on the way out is offered back, not lost', async () => {
    const t = world()
    await t.seed([bio('one')])
    const w = t.writer()
    const { L } = await open(w)
    const refused = { ...bio('x'), block_type: 'not-a-block' as Block['block_type'] }
    w.stage(L, [bio('one'), refused])
    w.release(L)
    await w.idle()
    const o = w.takeOrphan()
    expect(o?.why).toBe('error')
    expect(o?.blocks).toHaveLength(2)
  })

  it('a job that finds nothing to do does not wipe the line that said Saved', async () => {
    const t = world()
    await t.seed([bio('one')])
    const w = t.writer()
    const { L } = await open(w)
    /* a save is queued, and an edit arms its timer before that save starts — the save takes the
       newer copy, and the timer, firing after, finds nothing left to do */
    const queued = w.flushNow(L, [bio('two')])
    w.stage(L, [bio('three')])
    await queued
    expect(t.page()).toEqual(['three'])
    expect(w.statusOf(L).kind).toBe('saved')
    t.tick()
    await w.idle()
    expect(w.statusOf(L).kind).toBe('saved')
  })

  it('no session for a moment (a token refresh failing offline) is tried again, not taken for a sign-out', async () => {
    const t = world()
    await t.seed([bio('one')])
    const w = t.writer()
    const { L } = await open(w)
    t.signIn(null)
    w.stage(L, [bio('two')])
    t.tick()
    await w.idle()
    expect(w.statusOf(L).kind).toBe('unverified')
    t.signIn({ uid: 'A', token: t.ann })
    t.tick()
    await w.idle()
    expect(t.page()).toEqual(['two'])
  })

  it('a job that throws is tried again rather than jamming the queue', async () => {
    const t = world()
    await t.seed([bio('one')])
    let reads = 0
    const w = createPageWriter({
      uid: 'A',
      rpc: async (fn, args, token) => {
        /* the second read (the save's check; the first was the editor opening) throws */
        if (fn === 'get_profile_blocks' && ++reads === 2)
          throw new TypeError('AbortSignal.timeout is not a function')
        return t.srv.rpc(fn, args, token)
      },
      session: async () => ({ uid: 'A', token: t.ann }),
      lock: (_, fn) => fn(),
      setTimeout: (fn) => {
        queueMicrotask(fn)
        return 0
      },
      clearTimeout: () => {},
    })
    const { L } = await open(w)
    expect(await w.flushNow(L, [bio('two')])).toMatchObject({ kind: 'unverified' })
    await w.idle()
    await w.idle()
    expect(t.page()).toEqual(['two'])
  })

  it('Reload it while the save is in flight lets the copy go, and offers nothing back', async () => {
    const t = world()
    await t.seed([bio('one')])
    const w = t.writer()
    const { L } = await open(w)
    await t.seed([bio('one'), bio('elsewhere')], t.ann2)
    t.srv.hold('get_profile_blocks')
    w.stage(L, [bio('typed')])
    t.tick()
    for (let i = 0; i < 5; i++) await Promise.resolve()
    w.discard(L)
    t.srv.release('get_profile_blocks')
    await w.idle()
    expect(w.takeOrphan()).toBeNull()
  })

  it('Reload it during a check that could not be made: the copy is not sent when the check is tried again', async () => {
    const t = world()
    await t.seed([bio('one')])
    const w = t.writer()
    const { L } = await open(w)
    t.srv.hold('get_profile_blocks')
    const saves = t.srv.calls('save_my_profile_blocks').length
    w.stage(L, [bio('typed, then let go')])
    t.tick()
    for (let i = 0; i < 5; i++) await Promise.resolve()
    w.discard(L)
    /* the check in flight fails, which normally puts the copy back to be tried again */
    t.srv.drop('get_profile_blocks', 'request')
    t.srv.release('get_profile_blocks')
    await w.idle()
    t.srv.drop('get_profile_blocks', null)
    for (let i = 0; i < 3; i++) {
      t.tick()
      await w.idle()
    }
    expect(t.page()).toEqual(['one'])
    expect(t.srv.calls('save_my_profile_blocks')).toHaveLength(saves)
    expect(w.takeOrphan()).toBeNull()
  })

  it('after a refused save, a conflict says something is unsaved, so Reload does not drop it unwarned', async () => {
    const t = world()
    await t.seed([bio('one')])
    const w = t.writer()
    const { L } = await open(w)
    const refused = { ...bio('x'), block_type: 'not-a-block' as Block['block_type'] }
    await w.flushNow(L, [bio('one, typed'), refused])
    expect(w.statusOf(L).kind).toBe('error')
    await t.seed([bio('one'), bio('elsewhere')], t.ann2)
    await w.probe()
    expect(w.statusOf(L)).toEqual({ kind: 'conflict', why: 'stale', unsaved: true })
  })

  it('an editor whose copy cannot be sent is not handed a song', async () => {
    const t = world()
    await t.seed([bio('one')])
    const w = t.writer()
    const s = await w.load('ann')
    if ('failed' in s) throw new Error(s.failed)
    const L = w.attach({
      seedRev: s.rev,
      seedBlocks: s.page,
      apply: { peek: () => [], commit: async () => ({ kind: 'stale' }) },
    })
    expect(w.liveLineage()?.id).toBe(L)
    w.unstage(L, [bio('x'.repeat(70000))])
    expect(w.liveLineage()).toBeNull()
  })

  it('a handle renamed in this tab is followed once the new name is opened', async () => {
    const t = world()
    await t.seed([bio('one')])
    const w = t.writer()
    await open(w)
    t.srv.rename('A', 'anna')
    const { L } = await open(w, 'anna')
    w.stage(L, [bio('one, after the rename')])
    t.tick()
    await w.idle()
    expect(t.page()).toEqual(['one, after the rename'])
  })
})
