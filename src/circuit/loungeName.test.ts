import { describe, expect, it } from 'vitest'
import {
  LOUNGE_NAME_MAX,
  LOUNGE_NAME_PENDING,
  canSendInLounge,
  checkLoungeName,
  joinLounge,
  loungeNameRead,
  loungePresenceName,
  type LoungeName,
  type LoungeRpc,
} from './loungeName'

/** what supabase-js resolves to when the call never got an answer — it does not throw */
const failedRead = { data: null, error: { message: 'Failed to fetch' } }
const known = (name: string): LoungeName => ({ status: 'known', name })

/** a stand-in for sb.rpc that remembers every call and answers each function as told */
function fakeRpc(answers: Partial<Record<string, { message: string } | null>> = {}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = []
  const rpc: LoungeRpc = (fn, args) => {
    calls.push({ fn, args })
    return Promise.resolve({ error: answers[fn] ?? null })
  }
  return { rpc, calls }
}

describe('checkLoungeName', () => {
  it('refuses a name over the server’s 40 characters before anything is sent', () => {
    expect(checkLoungeName('a'.repeat(41))).toHaveProperty('problem')
  })

  it('allows 40, counting one per character as Postgres length() does, not per UTF-16 unit', () => {
    // 40 butterflies are 80 UTF-16 units, so a `.length` check would wrongly refuse them
    expect(checkLoungeName('🦋'.repeat(40))).toEqual({ name: '🦋'.repeat(40) })
  })

  it('counts code points the way the server does, not what the eye sees as one', () => {
    // a family emoji is one glyph and five code points: nine of them is 45 to the server
    expect(checkLoungeName('👨‍👩‍👧'.repeat(9))).toHaveProperty('problem')
  })

  it('does not count the spaces around a name, which are trimmed before it is sent', () => {
    expect(checkLoungeName(`  ${'a'.repeat(LOUNGE_NAME_MAX)}  `)).toEqual({
      name: 'a'.repeat(LOUNGE_NAME_MAX),
    })
  })

  it('reads a blank answer as "use my usual name", not as a name', () => {
    expect(checkLoungeName('   ')).toEqual({ name: null })
  })
})

describe('loungeNameRead', () => {
  it('reads a failed call as a failure, not as "no Lounge name"', () => {
    expect(loungeNameRead(failedRead)).toEqual({ status: 'failed' })
  })

  it('reads an answer as the name the server signs your Lounge messages with', () => {
    expect(loungeNameRead({ data: 'Moth', error: null })).toEqual(known('Moth'))
  })
})

/* ⚠️ It used to be handed the real name as a fallback (`myLoungeName ?? myName`), and these were
   made to fail against that: "expected 'Evan Cook' to be null". It takes no real name now, so
   there is nowhere for one to come from — what is left to ask is that it stays silent. */
describe('loungePresenceName', () => {
  it('announces no name after a failed read — never the real one', () => {
    expect(loungePresenceName(loungeNameRead(failedRead))).toBeNull()
  })

  it('announces no name while the Lounge name is still being asked for', () => {
    expect(loungePresenceName(LOUNGE_NAME_PENDING)).toBeNull()
  })

  it('announces the name the server confirmed', () => {
    expect(loungePresenceName(known('Moth'))).toBe('Moth')
  })
})

describe('canSendInLounge', () => {
  it('holds a Lounge message back while your Lounge name could not be read', () => {
    expect(canSendInLounge({ status: 'failed' })).toBe(false)
  })

  it('holds a Lounge message back until your Lounge name has been read', () => {
    expect(canSendInLounge(LOUNGE_NAME_PENDING)).toBe(false)
  })

  it('lets you send once the server has said what you are called there', () => {
    expect(canSendInLounge(known('Moth'))).toBe(true)
  })
})

describe('joinLounge', () => {
  it('sends nothing at all for a name the server would refuse', async () => {
    const { rpc, calls } = fakeRpc()
    const out = await joinLounge(rpc, 'a'.repeat(41), known('Evan'))
    expect(calls).toEqual([])
    expect(out.joined).toBe(false)
    expect(out.problem).toMatch(/40/)
  })

  it('does not join when the name could not be saved, so nothing is posted under the real one', async () => {
    const { rpc, calls } = fakeRpc({ set_lounge_display_name: { message: 'Failed to fetch' } })
    const out = await joinLounge(rpc, 'Moth', known('Evan'))
    expect(calls.some((c) => c.fn === 'set_lounge_opt_in' && c.args.p_on === true)).toBe(false)
    expect(out.joined).toBe(false)
    expect(out.problem).toBeTruthy()
  })

  it('does not take on a name the server refused', async () => {
    const { rpc } = fakeRpc({ set_lounge_display_name: { message: 'name too long' } })
    const out = await joinLounge(rpc, 'Moth', known('Evan'))
    expect(out.lounge).toEqual(known('Evan'))
  })

  it('saves the name first and joins second', async () => {
    const { rpc, calls } = fakeRpc()
    const out = await joinLounge(rpc, '  Moth ', LOUNGE_NAME_PENDING)
    expect(calls).toEqual([
      { fn: 'set_lounge_display_name', args: { p_name: 'Moth' } },
      { fn: 'set_lounge_opt_in', args: { p_on: true } },
    ])
    expect(out).toEqual({ joined: true, lounge: known('Moth'), problem: null })
  })

  it('keeps a name it saved even when joining then fails, since the server now has it', async () => {
    const { rpc } = fakeRpc({ set_lounge_opt_in: { message: 'your account is suspended' } })
    const out = await joinLounge(rpc, 'Moth', { status: 'failed' })
    expect(out).toEqual({
      joined: false,
      lounge: known('Moth'),
      problem: 'your account is suspended',
    })
  })

  it('joins with no name call when the answer was blank', async () => {
    const { rpc, calls } = fakeRpc()
    const out = await joinLounge(rpc, '', { status: 'failed' })
    expect(calls).toEqual([{ fn: 'set_lounge_opt_in', args: { p_on: true } }])
    expect(out).toEqual({ joined: true, lounge: { status: 'failed' }, problem: null })
  })
})
