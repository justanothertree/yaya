import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { stampOfServer } from '../server/lib/buildStamp.mjs'
import { MAX_MSG_BYTES } from '../server/lib/frameCap.mjs'
import { DEFAULT_SETTINGS, sanitizeSettings } from '../server/lib/settings.mjs'
import { GameEngine } from '../src/game/engine.ts'
import { openSocket, sleep, startRelay, until } from './relay-harness.mjs'

/**
 * The relay's frame cap, asked of the real relay over a real socket.
 *
 * ⚠️ THE CAP IS A PROMISE IN BOTH DIRECTIONS, and each direction has its own failure. Too high and
 * one socket can make the process hold whatever it likes; too low and an honest client is closed
 * mid-game with a code nothing on screen explains — which is what 32 KiB did to Snake's own
 * preview on its largest board (see server/lib/frameCap.mjs). So this asks three things: that the
 * largest frame a real client sends gets through, that a frame of exactly the cap gets through,
 * and that one byte more closes that socket — and only that socket.
 *
 * ⚠️ THE LARGEST FRAME IS BUILT, NOT TYPED IN. The grid comes from sanitizeSettings, the rule the
 * relay keeps rooms by; the state comes from the real engine's own snapshot; the wrapper is the
 * shape the client's preview sender puts around it (src/game/manager.tsx, which cannot be imported
 * here: it is a React module). A bigger board, a new field on the preview or a tighter cap turns
 * the first case red rather than a player's socket.
 */

const SERVER = fileURLToPath(new URL('../server', import.meta.url))
const bytes = (s) => Buffer.byteLength(s, 'utf8')

let relay
beforeAll(async () => {
  relay = await startRelay({ HEARTBEAT_MS: '600000' })
})
afterAll(async () => {
  await relay?.stop()
})

/** sockets in one Snake room, each past its hello, with its close code kept */
async function snakeRoom(room, n) {
  const socks = []
  for (let i = 0; i < n; i++) {
    const s = openSocket(relay.url)
    s.closed = null
    s.ws.on('close', (code) => {
      s.closed = code
    })
    await s.opened
    s.send({ type: 'hello', room, create: true })
    expect(await until(() => s.inbox.some((f) => f.type === 'settings'), 5000)).toBe(true)
    socks.push(s)
  }
  await sleep(100)
  for (const s of socks) s.inbox.length = 0
  return socks
}

/** a chat line padded with whitespace after the JSON (which parses) to exactly `size` bytes */
function chatOf(text, size) {
  const body = JSON.stringify({ type: 'chat', text })
  return body + ' '.repeat(size - bytes(body))
}

/** the largest board the relay keeps: the largest grid its own rule lets a room have */
function largestGrid() {
  let best = 0
  for (let g = 1; g <= 1000; g++)
    if (sanitizeSettings({ grid: g }, DEFAULT_SETTINGS).grid === g) best = g
  return best
}

/** Snake's preview as the client sends it, around a state the engine produced */
const previewOf = (state) => ({
  type: 'preview',
  state,
  score: Number.MAX_SAFE_INTEGER,
  /* the relay's own name cap (MAX_NAME_LEN), in three-byte characters: the heaviest name it relays */
  name: '€'.repeat(64),
  spectate: false,
})

describe('the frame cap', () => {
  it("the largest frame a real client sends — Snake's preview of a full board — gets through, with room to spare", async () => {
    const grid = largestGrid()
    expect(grid).toBeGreaterThan(DEFAULT_SETTINGS.grid)
    const settings = { ...DEFAULT_SETTINGS, grid, apples: grid * grid - 1 }

    /* the engine left to fill the board itself, as the apples box at its maximum does */
    const engine = new GameEngine(settings, 7)
    let played = bytes(JSON.stringify(previewOf(engine.snapshot())))
    for (let t = 0; t < 400; t++) {
      const { state } = engine.tick()
      played = Math.max(played, bytes(JSON.stringify(previewOf(state))))
      if (!state.alive) break
    }

    /* and a board with a point on every cell, which is as full as a board can be */
    const cells = []
    for (let y = 0; y < grid; y++) for (let x = 0; x < grid; x++) cells.push({ x, y })
    const full = new GameEngine(settings, 7).loadSnapshot({
      snake: cells.slice(0, 1),
      dir: { x: -1, y: 0 },
      apples: cells.slice(1),
      alive: true,
      ticks: 9_999_999,
    })
    const frame = JSON.stringify(previewOf(full))
    expect(full.apples.length + full.snake.length).toBe(grid * grid)
    /* the full board bounds what playing produces, so it is the one to measure */
    expect(played).toBeLessThanOrEqual(bytes(frame))
    /* "more than a tenth above the largest frame", as frameCap.mjs says */
    expect(bytes(frame) * 1.1).toBeLessThanOrEqual(MAX_MSG_BYTES)

    const [a, b] = await snakeRoom('cap-preview', 2)
    try {
      a.ws.send(frame)
      expect(
        await until(() => b.inbox.some((f) => f.type === 'preview' && f.state?.apples), 5000),
      ).toBe(true)
      const got = b.inbox.find((f) => f.type === 'preview')
      expect(got.state.apples.length).toBe(grid * grid - 1)
      expect(a.closed).toBe(null)
      expect(a.inbox.filter((f) => f.type === 'error')).toEqual([])
    } finally {
      a.close()
      b.close()
    }
  })

  it('a frame of exactly MAX_MSG_BYTES is read, not refused', async () => {
    const [a, b] = await snakeRoom('cap-exact', 2)
    try {
      const frame = chatOf('at the cap', MAX_MSG_BYTES)
      expect(bytes(frame)).toBe(MAX_MSG_BYTES)
      a.ws.send(frame)
      expect(await until(() => b.inbox.some((f) => f.type === 'chat'), 5000)).toBe(true)
      expect(b.inbox.find((f) => f.type === 'chat').text).toBe('at the cap')
      await sleep(100)
      expect(a.closed).toBe(null)
      expect(a.inbox.filter((f) => f.type === 'error')).toEqual([])
    } finally {
      a.close()
      b.close()
    }
  })

  it('one byte more closes that socket with 1009, and only that one: the room and the relay carry on', async () => {
    const [a, b, c] = await snakeRoom('cap-over', 3)
    try {
      const frame = chatOf('past the cap', MAX_MSG_BYTES + 1)
      expect(bytes(frame)).toBe(MAX_MSG_BYTES + 1)
      a.ws.send(frame)
      expect(await until(() => a.closed !== null, 5000)).toBe(true)
      expect(a.closed).toBe(1009)

      /* the relay ran the leaver's close like any other, and nobody heard the frame */
      for (const s of [b, c])
        expect(
          await until(() => s.inbox.some((f) => f.type === 'presence' && f.count === 2), 5000),
        ).toBe(true)
      expect([...b.inbox, ...c.inbox].filter((f) => f.type === 'chat')).toEqual([])

      /* the two left behind still talk to each other through it */
      b.send({ type: 'chat', text: 'still here' })
      expect(await until(() => c.inbox.some((f) => f.type === 'chat'), 5000)).toBe(true)
      expect(c.inbox.find((f) => f.type === 'chat').text).toBe('still here')
      expect(b.closed).toBe(null)
      expect(c.closed).toBe(null)

      /* and the process is still up for everything else it serves */
      const r = await fetch(`${relay.http}/health`)
      expect(r.status).toBe(200)
      expect(await r.json()).toEqual({ ok: true, build: stampOfServer(SERVER) })
    } finally {
      for (const s of [a, b, c]) s.close()
    }
  })
})
