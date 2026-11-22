import { describe, expect, it } from 'vitest'
import { profileServerDouble } from '../dev/profileServerDouble'
import { toSong } from '../audio/songFile'
import type { ProfileBlock } from '../sections/ProfileBlocks'
import { withSong } from './newBlock'
import { createPageWriter, type PageWriter } from './pageWriter'
import { putSongOnProfile } from './putOnProfile'
import { songsFromConfig } from './songBlockConfig'

/**
 * 🎵 Put it on my profile, against a faithful double of the server and the real page writer. The
 * expectations are what the member's page holds afterwards and how many saves were made.
 */

type Block = ProfileBlock
const bio = (text: string): Block => ({
  block_type: 'bio',
  size: 'medium',
  config: { text },
  visibility: 'members',
})
const tune = (name: string, midi = 60) =>
  toSong(name, 120, 1, [
    {
      id: 'l1',
      instrument: 'keys',
      len: 2,
      muted: false,
      fx: { echo: 0, echoTime: 0.3, space: 0, vibrato: 0, glide: 0, tone: 0.5 },
      events: [
        { t: 0, midi, on: true },
        { t: 0.5, midi, on: false },
      ],
    },
  ])

function world() {
  const srv = profileServerDouble()
  const ann = srv.member('A', 'ann')
  const bob = srv.member('B', 'bob')
  let session = { uid: 'A', token: ann }
  const timers = new Map<number, () => void>()
  let tid = 0
  const writer = createPageWriter({
    uid: 'A',
    rpc: (fn, args, token) => srv.rpc(fn, args, token),
    session: async () => session,
    lock: (_, fn) => fn(),
    setTimeout: (fn) => {
      const id = ++tid
      timers.set(id, fn)
      return id
    },
    clearTimeout: (id) => {
      timers.delete(id as number)
    },
  })
  const seed = (blocks: Block[], token = ann) =>
    srv.rpc(
      'save_my_profile_blocks',
      { p_blocks: blocks.map((b) => ({ ...b, certain: [] })) },
      token,
    )
  const saves = () => srv.calls('save_my_profile_blocks').length
  const page = (uid = 'A') => srv.pageOf(uid)
  const songs = (uid = 'A') =>
    page(uid)
      .filter((b) => b.block_type === 'song')
      .flatMap((b) => songsFromConfig(b.config).map((s) => s.name))
  const tick = () => {
    const due = [...timers.values()]
    timers.clear()
    for (const fn of due) fn()
  }
  return {
    srv,
    ann,
    bob,
    writer,
    seed,
    saves,
    page,
    songs,
    tick,
    switchTo: (s: typeof session) => (session = s),
  }
}

/** an editor's half of it, as ProfileBlocksEditor does it: its copy, its typing, and the Put road in */
async function editor(w: PageWriter) {
  const s = await w.load('ann')
  if ('failed' in s) throw new Error(s.failed)
  let blocks = s.page as Block[]
  const L: number = w.attach({
    seedRev: s.rev,
    seedBlocks: s.page,
    apply: {
      peek: () => blocks,
      commit: async (song, approved) => {
        const ws = withSong(blocks, song)
        if (!ws.ok) return { kind: 'cannot', why: ws.why }
        if (ws.how === 'updated' && ws.name !== approved) return { kind: 'ask', name: ws.name }
        blocks = ws.blocks
        return { ...(await w.flushNow(L, blocks)), song: ws.name, how: ws.how }
      },
    },
  })
  return {
    L,
    type: (next: Block[]) => {
      blocks = next
      w.stage(L, next)
    },
  }
}

const put = (
  t: ReturnType<typeof world>,
  name: string,
  confirm: (n: string) => boolean = () => true,
) => putSongOnProfile({ writer: t.writer, uid0: 'A', name: 'ann', song: tune(name), confirm })

describe('putting a song on your own page', () => {
  it('adds it to the page as it is, keeping every other block', async () => {
    const t = world()
    await t.seed([bio('one'), bio('two')])
    expect(await put(t, 'Tune')).toEqual({ ok: true, how: 'new block', name: 'Tune' })
    expect(t.page().map((b) => b.block_type)).toEqual(['bio', 'bio', 'song'])
    expect(t.songs()).toEqual(['Tune'])
  })

  it('writes nothing to a page that stopped being yours', async () => {
    const t = world()
    await t.seed([bio('mine')])
    t.srv.rename('A', 'anna')
    const before = t.saves()
    expect((await put(t, 'Tune')).ok).toBe(false)
    expect(t.saves()).toBe(before)
    expect(t.page().map((b) => b.config.text)).toEqual(['mine'])
  })

  it('writes nothing when the page could not be read, and says so', async () => {
    const t = world()
    await t.seed([bio('mine')])
    t.srv.drop('get_profile_blocks', 'request')
    const before = t.saves()
    expect(await put(t, 'Tune')).toEqual({ ok: false, say: 'Couldn’t reach your page. Try again.' })
    expect(t.saves()).toBe(before)
  })

  it('writes nothing, and says why, when the song will not fit', async () => {
    const t = world()
    await t.seed(Array.from({ length: 20 }, (_, i) => bio(`b${i}`)))
    const before = t.saves()
    expect(await put(t, 'Tune')).toEqual({
      ok: false,
      say: 'Your page has 20 blocks. Take one off it to add a song block.',
    })
    expect(t.saves()).toBe(before)
  })

  it('asks before replacing a song of the same name, and a no leaves the page alone', async () => {
    const t = world()
    await t.seed([bio('one')])
    await put(t, 'Tune')
    const before = t.saves()
    const asked: string[] = []
    expect(
      await put(t, 'Tune', (n) => {
        asked.push(n)
        return false
      }),
    ).toEqual({ ok: false, say: 'Your page is as it was.' })
    expect(asked).toEqual(['Tune'])
    expect(t.saves()).toBe(before)
  })

  it('keeps what was written to the page while you were answering', async () => {
    const t = world()
    await t.seed([bio('one')])
    await put(t, 'Tune')
    const out = await put(t, 'Tune', () => {
      /* another device adds a block while the question is open */
      void t.seed([
        ...t.page().map((b) => ({ ...b, certain: [] }) as unknown as Block),
        bio('meanwhile'),
      ])
      return true
    })
    expect(out).toEqual({ ok: true, how: 'updated', name: 'Tune' })
    expect(t.page().map((b) => b.config.text ?? b.block_type)).toEqual(['one', 'song', 'meanwhile'])
  })

  it('pressed as one account and answered as another: nothing is written to either page', async () => {
    const t = world()
    await t.seed([bio('ann’s')])
    t.switchTo({ uid: 'B', token: t.bob })
    expect(await put(t, 'Tune')).toEqual({
      ok: false,
      say: 'You’re signed in as someone else now. Nothing was saved.',
    })
    expect(t.page('A').map((b) => b.config.text)).toEqual(['ann’s'])
    expect(t.page('B')).toEqual([])
  })
})

describe('with your page open in an editor', () => {
  it('goes into the editor’s copy, unsaved typing and all, in one save', async () => {
    const t = world()
    await t.seed([bio('one')])
    const ed = await editor(t.writer)
    ed.type([bio('one, typed but not yet saved')])
    const before = t.saves()
    expect(await put(t, 'Tune')).toEqual({ ok: true, how: 'new block', name: 'Tune' })
    expect(t.saves()).toBe(before + 1)
    expect(t.page().map((b) => b.config.text ?? b.block_type)).toEqual([
      'one, typed but not yet saved',
      'song',
    ])
    /* and the typing's own timer, still waiting, sends nothing older afterwards */
    t.tick()
    await t.writer.idle()
    expect(t.saves()).toBe(before + 1)
    expect(t.songs()).toEqual(['Tune'])
  })

  it('an editor whose copy is old: the song still lands, on the page as it is, and the editor says so', async () => {
    const t = world()
    await t.seed([bio('one')])
    const ed = await editor(t.writer)
    /* another device changed the page under the open editor */
    await t.seed([bio('one'), bio('from my phone')])
    expect(await put(t, 'Tune')).toEqual({ ok: true, how: 'new block', name: 'Tune' })
    expect(t.page().map((b) => b.config.text ?? b.block_type)).toEqual([
      'one',
      'from my phone',
      'song',
    ])
    expect(t.writer.statusOf(ed.L).kind).toBe('conflict')
  })
})
