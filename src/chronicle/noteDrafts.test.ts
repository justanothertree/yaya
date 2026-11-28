import { describe, expect, it } from 'vitest'
import { makeDrafts, memoryBackend } from '../drafts/drafts'
import { readJournalDraft, readNoteText } from './noteDrafts'

/** A note typed and not saved, a reload, and the note back — for the person who wrote it. */
describe('Chronicle note drafts across a reload', () => {
  const ann = () => 'ann'

  it('the Journal’s new note comes back with the day it was about', async () => {
    const rows = new Map<string, unknown>()
    await makeDrafts(memoryBackend(rows), ann).write('journal', {
      draft: 'slept badly, ran anyway',
      about: '2026-11-25',
    })
    const back = await makeDrafts(memoryBackend(rows), ann).read('journal', readJournalDraft)
    expect(back?.body).toEqual({ draft: 'slept badly, ran anyway', about: '2026-11-25' })
  })

  it('a note about today has no day, and stays that way', async () => {
    const rows = new Map<string, unknown>()
    await makeDrafts(memoryBackend(rows), ann).write('journal', { draft: 'x', about: null })
    expect(
      (await makeDrafts(memoryBackend(rows), ann).read('journal', readJournalDraft))?.body.about,
    ).toBeNull()
  })

  it('the running sitting’s note comes back for THAT sitting only', async () => {
    const rows = new Map<string, unknown>()
    await makeDrafts(memoryBackend(rows), ann).write(
      'sitting-note',
      'third set felt light',
      'sit-7',
    )
    const after = makeDrafts(memoryBackend(rows), ann)
    expect((await after.read('sitting-note', readNoteText, 'sit-7'))?.body).toBe(
      'third set felt light',
    )
    expect(await after.read('sitting-note', readNoteText, 'sit-8')).toBeNull()
  })

  it('nobody else on the browser is given either — the journal says only you can read these', async () => {
    const rows = new Map<string, unknown>()
    await makeDrafts(memoryBackend(rows), ann).write('journal', { draft: 'private', about: null })
    await makeDrafts(memoryBackend(rows), ann).write('sitting-note', 'private', 'sit-7')
    const bo = makeDrafts(memoryBackend(rows), () => 'bo')
    expect(await bo.read('journal', readJournalDraft)).toBeNull()
    expect(await bo.read('sitting-note', readNoteText, 'sit-7')).toBeNull()
  })

  it('reads back no more than a box can hold, and refuses what is not a note', () => {
    expect(readJournalDraft({ draft: 'y'.repeat(5000), about: null })?.draft).toHaveLength(4000)
    expect(readNoteText('z'.repeat(5000))).toHaveLength(4000)
    expect(readJournalDraft({ draft: 'x', about: 'yesterday' })?.about).toBeNull()
    for (const junk of [null, 3, 'x', {}, { draft: '   ' }, { draft: 7 }])
      expect(readJournalDraft(junk)).toBeNull()
    for (const junk of [null, 3, {}, '', '   ']) expect(readNoteText(junk)).toBeNull()
  })
})
