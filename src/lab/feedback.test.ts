// ⚠️ THESE ARE FRONTEND TESTS AGAINST A MOCKED SERVER. They say what the page sends and how it
// reads replies; they say nothing about whether the database enforces anything. That is
// supabase/tests/lab-feedback.sql, run against a real Postgres.
import { describe, expect, it } from 'vitest'
import draft from '../../supabase/drafts/lab-catalog-and-feedback.sql?raw'
import { NOTE_MAX, checkNote, explain, labApi, notesSummary, readNote, readPage } from './feedback'

/** each function the draft defines, with its parameter names, read from the SQL itself */
const SIGNATURES = new Map(
  [...draft.matchAll(/create or replace function public\.([a-z_]+)\(([^)]*)\)/g)].map((m) => [
    m[1],
    m[2]
      .split(',')
      .map((p: string) => p.trim().split(/\s+/)[0])
      .filter((p: string) => p.startsWith('p_')),
  ]),
)

describe('the page calls the functions the draft defines, with their own parameter names', () => {
  const calls: [string, Record<string, unknown> | undefined][] = []
  const api = labApi(async (fn, args) => {
    calls.push([fn, args])
    return (
      fn === 'lab_comments_page'
        ? { items: [], more: false }
        : fn === 'admin_lab_reports'
          ? []
          : null
    ) as never
  })!
  it('sends every call to a function that exists, naming only parameters it has', async () => {
    await api.catalog()
    await api.vote('swarm', 1)
    await api.page('swarm')
    await api.add('swarm', 'idea', 'hello there')
    await api.edit('00000000-0000-0000-0000-000000000000', null, 'bug')
    await api.remove('00000000-0000-0000-0000-000000000000')
    await api.report('00000000-0000-0000-0000-000000000000', 'spam')
    await api.setDemo('swarm', { hidden: true })
    await api.register(['swarm'])
    await api.reports()
    await api.moderate('00000000-0000-0000-0000-000000000000', 'keep')
    expect(calls).toHaveLength(11)
    for (const [fn, args] of calls) {
      expect(SIGNATURES.has(fn), fn).toBe(true)
      for (const k of Object.keys(args ?? {}))
        expect(SIGNATURES.get(fn), `${fn}(${k})`).toContain(k)
    }
  })
  it('leaves an owner flag it was not given as null — "not changing it", never false', () => {
    const set = calls.find(([fn]) => fn === 'admin_lab_set_demo')![1]!
    expect(set).toEqual({ p_demo: 'swarm', p_featured: null, p_experiment: null, p_hidden: true })
  })
  it('is null when this build has no backend', () => {
    expect(labApi(null)).toBeNull()
  })
})

describe('reading notes defensively', () => {
  it('keeps a well-formed note and drops a malformed one', () => {
    const ok = {
      id: 'x',
      kind: 'bug',
      body: 'it froze',
      author: 'sam',
      mine: false,
      at: '2026-11-07T10:00:00Z',
      edited: null,
      removed: false,
    }
    expect(readNote(ok)).toEqual(ok)
    expect(readNote({ ...ok, kind: 'shout' })).toBeNull()
    expect(readNote({ ...ok, id: 3 })).toBeNull()
    expect(readNote('x')).toBeNull()
    expect(readNote({ ...ok, body: 'y'.repeat(900) })?.body).toHaveLength(NOTE_MAX)
  })
  it('a page is at most thirty notes and says whether there are more', () => {
    const items = Array.from({ length: 40 }, (_, k) => ({
      id: `n${k}`,
      kind: 'idea',
      body: 'b',
      at: 'now',
    }))
    const p = readPage({ items, more: true })
    expect(p.items).toHaveLength(30)
    expect(p.more).toBe(true)
    expect(readPage(null)).toEqual({ items: [], more: false })
  })
})

describe('what a person is told', () => {
  it('turns the database’s fixed refusals into sentences', () => {
    expect(explain({ message: 'slow down: five notes in ten minutes is the most' })).toMatch(
      /five notes/,
    )
    expect(explain({ message: 'sign in first' })).toBe('Sign in to do that.')
    expect(explain({ message: 'not allowed' })).toMatch(/owner/)
    expect(explain({ message: 'new row violates check constraint "lab_comments_length"' })).toMatch(
      /2–500/,
    )
  })
  it('never echoes a message it does not recognise', () => {
    const said = explain({ message: 'relation "secret_table" does not exist at character 42' })
    expect(said).not.toMatch(/secret_table/)
    expect(said).toMatch(/Couldn’t reach the server/)
  })
  it('every refusal the draft raises has a sentence of its own', () => {
    const raised = [...draft.matchAll(/raise exception '([^']+)'/g)].map((m) => m[1])
    expect(raised.length).toBeGreaterThan(10)
    for (const r of raised) expect(explain({ message: r }), r).not.toMatch(/Couldn’t reach/)
  })
})

describe('the note box agrees with the table', () => {
  it('accepts what the table accepts', () => {
    expect(checkNote('ok')).toBeNull()
    expect(checkNote('z'.repeat(NOTE_MAX))).toBeNull()
    expect(checkNote(`a${'\nb'.repeat(8)}`)).toBeNull()
    expect(checkNote('  padded  \r\n')).toBeNull()
    expect(checkNote('a\ttab')).toBeNull()
  })
  it('refuses what the table refuses', () => {
    expect(checkNote(' ')).not.toBeNull()
    expect(checkNote('x')).not.toBeNull()
    expect(checkNote('z'.repeat(NOTE_MAX + 1))).not.toBeNull()
    expect(checkNote(`a${'\nb'.repeat(9)}`)).not.toBeNull()
    expect(checkNote('bell\x07')).not.toBeNull()
  })
  it('keeps no floor under the totals — Evan’s decision of 8 Nov, OPEN-DECISIONS §14b', () => {
    expect(draft).not.toMatch(/lab_vote_floor|'few'/)
  })
  it('uses the table’s own bounds', () => {
    expect(draft).toContain(`char_length(body) between 2 and ${NOTE_MAX}`)
    expect(draft).toContain("replace(body, E'\\n', '')) <= 8")
  })
})

describe('what the closed notes fold says', () => {
  it('nothing until the first page comes; then none, a count, or a full page with more behind it', () => {
    expect(notesSummary(null, false)).toBe('ideas, requests and bugs')
    expect(notesSummary(0, false)).toBe('none yet')
    expect(notesSummary(3, false)).toBe('3 to read')
    expect(notesSummary(20, true)).toBe('20+ to read')
  })
})
