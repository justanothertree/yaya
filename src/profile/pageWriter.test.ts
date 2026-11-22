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
    w.stage(L, [bio('two')])
    t.tick()
    await Promise.resolve()
    await Promise.resolve()
    /* the session changes while the job's check is in flight */
    t.signIn({ uid: 'B', token: t.bob })
    t.srv.release('get_profile_blocks')
    await w.idle()
    const job = t.srv.log.slice(-2)
    expect(job.map((c) => c.fn)).toEqual(['get_profile_blocks', 'save_my_profile_blocks'])
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

  it('two devices saving at the same instant double the page, and it is said rather than hidden', async () => {
    const t = world()
    await t.seed([bio('one')])
    t.srv.unlock()
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
