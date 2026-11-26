import { beforeEach, describe, expect, it } from 'vitest'
import { previewSocialClient, resetPreviewSocial } from './feedSocialPreview'
import { pvCircuitLogs } from './chroniclePreview'
import { PREVIEW_ME } from './previewMember'

/**
 * The feed's double, asked the questions the server answers — through the exact calls
 * `useFeedSocial` makes, so a shape the hook relies on and the double lacks fails here first.
 * Each expectation is a rule in the baseline schema, not a number this file chose (CLAUDE.md §2).
 */

const sb = previewSocialClient()
const log = () => pvCircuitLogs()[0].id
type Row = Record<string, unknown>
const comments = async () =>
  ((await sb.from('circuit_log_comments').select().order('created_at', { ascending: true }))
    .data as Row[]) ?? []
const reactions = async () =>
  ((await sb.from('circuit_log_reactions').select()).data as Row[]) ?? []
const say = (body: string, as = PREVIEW_ME.id, on = log()) =>
  sb
    .from('circuit_log_comments')
    .insert({ log_id: on, user_id: as, body, author_name: 'Preview You' })

beforeEach(() => resetPreviewSocial())

describe('the feed double keeps the server’s rules', () => {
  it('hands the hook a seeded card: kudos from three people and comments from three', async () => {
    const r = await reactions()
    const c = await comments()
    expect(new Set(r.map((x) => x.user_id)).size).toBe(3)
    expect(new Set(c.map((x) => x.user_id)).size).toBe(3)
    expect(c.every((x) => x.log_id === log())).toBe(true)
  })

  it('returns comments oldest first when asked, though it stores them out of order', async () => {
    const at = (await comments()).map((x) => String(x.created_at))
    expect(at).toEqual([...at].sort())
    /* the store really is out of order, or this case asks nothing */
    const raw = ((await sb.from('circuit_log_comments').select()).data as Row[]).map((x) =>
      String(x.created_at),
    )
    expect(raw).not.toEqual([...raw].sort())
  })

  it('takes a comment of 1 to 1000 characters and refuses 0 or 1001 (circuit_log_comments_body_check)', async () => {
    expect((await say('x')).error).toBeNull()
    expect((await say('x'.repeat(1000))).error).toBeNull()
    expect((await say('x'.repeat(1001))).error?.code).toBe('23514')
    expect((await say('')).error?.code).toBe('23514')
  })

  it('counts characters as char_length does, so a thousand emoji is a comment and not a refusal', async () => {
    const body = '💪'.repeat(1000)
    expect(body.length).toBe(2000) // what `.length` would have refused
    expect((await say(body)).error).toBeNull()
    expect((await say('💪'.repeat(1001))).error?.code).toBe('23514')
  })

  it('refuses a comment or a kudos made as somebody else, or on a log nobody can see', async () => {
    expect((await say('hi', 'preview-jordan')).error?.code).toBe('42501')
    expect((await say('hi', PREVIEW_ME.id, 'no-such-log')).error?.code).toBe('42501')
    const k = await sb
      .from('circuit_log_reactions')
      .insert({ log_id: log(), user_id: 'preview-jordan', emoji: '👏', author_name: 'Jordan' })
    expect(k.error?.code).toBe('42501')
  })

  it('refuses the same kudos twice (circuit_log_reactions_pkey), and takes a different one', async () => {
    const give = (emoji: string) =>
      sb
        .from('circuit_log_reactions')
        .insert({ log_id: log(), user_id: PREVIEW_ME.id, emoji, author_name: 'Preview You' })
    expect((await give('💪')).error?.code).toBe('23505') // the seed already has your 💪
    expect((await give('👏')).error).toBeNull()
  })

  it('deletes your own comment, and leaves somebody else’s with no error (RLS: zero rows)', async () => {
    const before = (await comments()).length
    expect(
      (await sb.from('circuit_log_comments').delete().eq('id', 'pv-c-jordan')).error,
    ).toBeNull()
    expect((await comments()).length).toBe(before)
    await sb.from('circuit_log_comments').delete().eq('id', 'pv-c-you')
    const after = await comments()
    expect(after.length).toBe(before - 1)
    expect(after.some((x) => x.id === 'pv-c-you')).toBe(false)
  })

  it('takes back only your own kudos, narrowed by every .eq() the hook sends', async () => {
    await sb
      .from('circuit_log_reactions')
      .delete()
      .eq('log_id', log())
      .eq('user_id', PREVIEW_ME.id)
      .eq('emoji', '🔥')
    /* you never gave a 🔥, so both of the others' stay */
    expect((await reactions()).filter((x) => x.emoji === '🔥').length).toBe(2)
    await sb
      .from('circuit_log_reactions')
      .delete()
      .eq('log_id', log())
      .eq('user_id', PREVIEW_ME.id)
      .eq('emoji', '💪')
    expect((await reactions()).some((x) => x.emoji === '💪')).toBe(false)
  })
})
