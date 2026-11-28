/**
 * What the nicknames read says, and whether Save names may send the three boxes.
 *
 * ⚠️ ALL THREE GO EVERY TIME, AND A BLANK IS AN ERASE. `set_my_nicknames` writes nickname,
 * circuit_nickname and snake_nickname together and stores '' as NULL, so a box left empty by a
 * read that failed is not "unchanged" — it is an instruction to delete that name. supabase-js
 * answers a failure with `data: null` instead of throwing, and the card used to read that the
 * same as a member with no names set; the 27 Nov 2026 audit found it
 * (docs/2026-11-27-supabase-failure-audit.md). So the boxes count as known only after a read
 * that SUCCEEDED, and Save names waits for one.
 *
 * Its own module so `AccountSettings.tsx` only exports components, and so this can be asked.
 */

export type Nicknames = { nickname: string; circuitNickname: string; snakeNickname: string }

/** the member's own three names, or the admission that we do not know them */
export type NicknamesRead = { ok: true; names: Nicknames } | { ok: false }

const BLANK: Nicknames = { nickname: '', circuitNickname: '', snakeNickname: '' }

/**
 * My names, from my own row.
 *
 * ⚠️ `me` IS CHECKED AGAINST THE ROW because `profiles_select` is `user_id = auth.uid() OR
 * is_admin()`: an admin can read every row, so a read that does not pin the user can come back
 * with somebody else's — and Save names would then write their names onto the admin's account.
 *
 * No row with no error is an honest answer — a signed-in account that is not a member yet has no
 * names, and `set_my_nicknames` updates nothing for it, so there is nothing a save could erase.
 */
export function readNicknames(
  reply: { data: unknown; error: unknown },
  me: string | null,
): NicknamesRead {
  if (reply.error || !me) return { ok: false }
  if (!reply.data) return { ok: true, names: BLANK }
  const d = reply.data as {
    user_id?: string
    nickname: string | null
    circuit_nickname: string | null
    snake_nickname: string | null
  }
  if (d.user_id !== me) return { ok: false }
  return {
    ok: true,
    names: {
      nickname: d.nickname ?? '',
      circuitNickname: d.circuit_nickname ?? '',
      snakeNickname: d.snake_nickname ?? '',
    },
  }
}

/** `null` is a read still in flight, and a press then would send three blanks as well */
export function maySaveNicknames(read: NicknamesRead | null, saving: boolean): boolean {
  return !saving && read !== null && read.ok
}
