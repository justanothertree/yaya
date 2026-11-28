/**
 * What you are called in The Lounge, and the one rule that matters about it: **the Lounge never
 * gets your real name because something failed.**
 *
 * The Lounge is the one room open to every opted-in account rather than to friends or
 * circuit-mates, which is why joining it asks for a name. Two failures used to hand the real one
 * back (audit of 27 Nov 2026, docs/2026-11-27-supabase-failure-audit.md):
 *
 * - **a refused `set_lounge_display_name` was ignored.** Joining opted in FIRST and then set the
 *   name without reading the answer, so on a refusal the alias showed on your own screen while
 *   `send_chat_message` — which picks the Lounge name server-side — stamped every message after it
 *   with your first name, permanently, in a room everybody reads. And it was not only a blip: any
 *   name over the server's 40 characters was refused every time.
 * - **a failed `my_lounge_display_name` read fell back to the real name** in the "N here" strip.
 *   supabase-js does not throw; a failure is `data: null`, and `null ?? myName` announced your
 *   nickname to every Lounge viewer.
 *
 * So the state below has no place for the real name to come from: it is the server's answer, a
 * failure, or not asked yet, and only the first announces anything or lets you send.
 */

/**
 * The server's own limit: `set_lounge_display_name` refuses `length(btrim(name)) > 40`. Postgres
 * `length()` counts characters — code points — so a butterfly is one and a family emoji is five.
 */
export const LOUNGE_NAME_MAX = 40

export type LoungeName =
  /** not answered yet: nothing is announced and nothing is sent */
  | { status: 'pending' }
  /** the read failed: say so and offer Retry; never fall back to the real name */
  | { status: 'failed' }
  /**
   * what the server says you are called in the Lounge — your chosen name, or the usual-name chain
   * it falls back to when you picked none, which is exactly what it signs your Lounge messages
   * with. `null` only when you have no profile row, which send_chat_message refuses anyway.
   */
  | { status: 'known'; name: string | null }

export const LOUNGE_NAME_PENDING: LoungeName = { status: 'pending' }

/**
 * What was typed at the Join prompt: a name to save, `null` for "use my usual name", or why the
 * server would refuse it — asked HERE, before anything is sent, because a refused name is the one
 * that used to leave you in the Lounge under your real one.
 */
export function checkLoungeName(raw: string): { name: string | null } | { problem: string } {
  // trimmed here and sent trimmed, so the server's btrim has nothing left to take off
  const name = raw.trim()
  if (!name) return { name: null }
  // code points, as the server counts — not `.length`, which counts UTF-16 units
  if ([...name].length > LOUNGE_NAME_MAX)
    return { problem: `Lounge names can be up to ${LOUNGE_NAME_MAX} characters.` }
  return { name }
}

/** what `my_lounge_display_name` answered — a failure stays a failure */
export function loungeNameRead(res: { data: unknown; error: unknown }): LoungeName {
  if (res.error) return { status: 'failed' }
  return { status: 'known', name: typeof res.data === 'string' && res.data ? res.data : null }
}

/** who Lounge presence announces you as: the name the server confirmed, or nobody */
export function loungePresenceName(s: LoungeName): string | null {
  return s.status === 'known' ? s.name : null
}

/**
 * Whether the Lounge's Send is open. The server picks your Lounge name itself, so a send during a
 * failed read would still be signed correctly — but this is the screen telling you that it does
 * not know what you are called there, and a message should not go out under a name you cannot see.
 */
export function canSendInLounge(s: LoungeName): boolean {
  return s.status === 'known'
}

export type LoungeRpc = (
  fn: 'set_lounge_display_name' | 'set_lounge_opt_in',
  args: Record<string, unknown>,
) => PromiseLike<{ error: { message: string } | null }>

export type JoinOutcome = {
  joined: boolean
  /** what you are called there now, as far as the server has confirmed */
  lounge: LoungeName
  /** what to tell you, or null */
  problem: string | null
}

/**
 * Join The Lounge with what was typed at the prompt.
 *
 * ⚠️ THE NAME IS SAVED FIRST AND YOU JOIN SECOND. Lounge membership is `lounge_opt_in` and
 * nothing else (`chat_room_member`), so in this order a refused name leaves you outside the room
 * rather than inside it under your real one. The other way round fails safe in the direction that
 * costs nothing: a name saved and a join refused is a name waiting for the next Join.
 */
export async function joinLounge(
  rpc: LoungeRpc,
  raw: string,
  before: LoungeName,
): Promise<JoinOutcome> {
  const checked = checkLoungeName(raw)
  if ('problem' in checked) return { joined: false, lounge: before, problem: checked.problem }
  let lounge = before
  if (checked.name) {
    const { error } = await rpc('set_lounge_display_name', { p_name: checked.name })
    if (error)
      return {
        joined: false,
        lounge: before,
        problem: `Couldn’t save that name, so you haven’t joined: ${error.message}`,
      }
    lounge = { status: 'known', name: checked.name }
  }
  const { error } = await rpc('set_lounge_opt_in', { p_on: true })
  return { joined: !error, lounge, problem: error ? error.message : null }
}
