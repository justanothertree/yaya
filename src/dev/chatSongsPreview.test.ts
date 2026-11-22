import { beforeEach, describe, expect, it, vi } from 'vitest'
/* ⚠️ The draft itself, read as text: the double's sentences are checked against the server's own
   words where they are written, never against a second copy typed in here. Vite's ?raw rather
   than node:fs, as fight.test.ts does, so this stays a browser-typed test. */
import draft from '../../supabase/migrations/20261122221602_chat_songs.sql?raw'

/**
 * The songs-in-chat stand-in answers what the server answers (CLAUDE.md: "When a guard exists on
 * the server, copy it to the double in the server's own words"). A double kinder than the server
 * hides the bug it should have shown; one that words a refusal differently puts a sentence on
 * screen in the pane that the site will never say.
 */

/** the body of one function in the draft */
function bodyOf(name: string): string {
  const at = draft.indexOf(`create function public.${name}(`)
  expect(at, `${name} is in the draft`).toBeGreaterThanOrEqual(0)
  return draft.slice(at, draft.indexOf('end $$;', at))
}
const refusals = (body: string) => [...body.matchAll(/raise exception '([^']*)'/g)].map((m) => m[1])

const CLAIM = bodyOf('chat_song_claim')
/* a session and a suspension are the two things the harness has no way to be without */
const NOT_HERE = ['not authenticated', 'your account is suspended']

let pv: typeof import('./chatSongsPreview')
beforeEach(async () => {
  /* the store is module state, and every test starts from the fixture */
  vi.resetModules()
  pv = await import('./chatSongsPreview')
})

/** a claim the server would take, and one fault for each of its refusals */
const ok = { room: 'pv-crew', mime: 'audio/webm', bytes: 1000, seconds: 60, name: 'Sunday' }
type Call = typeof ok
const faults: { field: keyof Call; value: Call[keyof Call] }[] = [
  { field: 'room', value: 'pv-nowhere' },
  { field: 'mime', value: 'audio/wav' },
  { field: 'bytes', value: 0 },
  { field: 'bytes', value: 5_242_881 },
  { field: 'seconds', value: 0 },
  { field: 'seconds', value: 901 },
  { field: 'name', value: '  \n ' },
]
const upload = (c: Call) => pv.pvUploadSong(c.room, c.mime, c.bytes, c.seconds, c.name)
const why = (r: { id: string } | { why: string }) => ('why' in r ? r.why : null)

describe('the stand-in’s upload refuses as chat_song_claim does', () => {
  it('says every one of the claim’s refusals, word for word, and nothing else', () => {
    const said = new Set<string>()
    for (const f of faults) {
      const w = why(upload({ ...ok, [f.field]: f.value }))
      expect(w, `${f.field} = ${JSON.stringify(f.value)}`).not.toBeNull()
      said.add(w!)
    }
    /* the account's ceiling: four 5 MB songs and what the fixture already holds leave no room
       for a fifth */
    for (let i = 0; i < 4; i++) expect(upload({ ...ok, bytes: 5_242_880 })).toHaveProperty('id')
    said.add(why(upload({ ...ok, bytes: 5_242_880 }))!)
    const theirs = refusals(CLAIM).filter((s) => !NOT_HERE.includes(s))
    expect([...said].sort()).toEqual([...theirs].sort())
  })

  it('refuses in the claim’s order: of two faults, the one the claim checks first', () => {
    const place = (s: string) => CLAIM.indexOf(`'${s}'`)
    for (const a of faults)
      for (const b of faults) {
        if (a.field === b.field) continue
        const wa = why(upload({ ...ok, [a.field]: a.value }))!
        const wb = why(upload({ ...ok, [b.field]: b.value }))!
        const both = why(upload({ ...ok, [a.field]: a.value, [b.field]: b.value }))
        expect(both, `${a.field} with ${b.field}`).toBe(place(wa) < place(wb) ? wa : wb)
      }
  })

  it('counts every song of yours not removed, sent or not, and a removal makes room', () => {
    for (let i = 0; i < 4; i++) expect(upload({ ...ok, bytes: 5_242_880 })).toHaveProperty('id')
    const full = upload({ ...ok, bytes: 5_242_880 })
    expect(why(full)).not.toBeNull()
    /* the ceiling is the server's 26,214,400, and the list reads the same rows it sums */
    const held = pv.pvSongsMine().reduce((n, s) => n + s.bytes, 0)
    expect(held + 5_242_880).toBeGreaterThan(26_214_400)
    expect(held).toBeLessThanOrEqual(26_214_400)
    const unsent = pv.pvSongsMine().find((s) => !s.sent)!
    expect(pv.pvRemoveSong(unsent.file_id)).toBeNull()
    expect(upload({ ...ok, bytes: unsent.bytes })).toHaveProperty('id')
  })

  it('keeps a name as the claim does: one line, trimmed, 60 characters', () => {
    const r = upload({ ...ok, name: '  Night \n\t drive ' + 'x'.repeat(70) })
    const mine = pv.pvSongsMine().find((s) => 'id' in r && s.file_id === r.id)!
    expect(mine.name).toBe(('Night drive ' + 'x'.repeat(70)).slice(0, 60))
  })
})

describe('the stand-in’s send refuses as send_chat_song does', () => {
  it('in its words', () => {
    const theirs = refusals(bodyOf('send_chat_song'))
    const id = (upload(ok) as { id: string }).id
    const first = pv.pvSendSong(id)
    expect(first).toHaveProperty('msg')
    const again = pv.pvSendSong(id)
    expect(why(again as { why: string })).toBe('that song is already sent')
    expect(why(pv.pvSendSong('pv-song-nope') as { why: string })).toBe('no such song')
    for (const w of ['that song is already sent', 'no such song']) expect(theirs).toContain(w)
  })

  it('writes the body send_chat_song writes, which is what every text-only surface shows', () => {
    const id = (upload({ ...ok, name: 'Sunday', seconds: 125 }) as { id: string }).id
    const sent = pv.pvSendSong(id) as { msg: { body: string } }
    expect(sent.msg.body).toBe('🎵 Sunday (2:05)')
    /* and the song is no longer one waiting to be sent */
    expect(pv.pvSongsMine().find((s) => s.file_id === id)?.sent).toBe(true)
  })
})
