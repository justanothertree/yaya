import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The Circuit feed's comment box, asked of the schema.
 *
 * ⚠️ A LOCAL CAP LOOSER THAN THE SERVER'S IS A SILENT HALF-SAVE (CLAUDE.md §4), and here it was
 * worse: `post` clears the box before the answer comes back, so a comment over the server's limit
 * was not half-saved, it was gone. Found 21 Nov 2026 once the feed had a stand-in in the pane
 * (OPEN-DECISIONS §22c). So the number is asked of the MIGRATIONS, not typed in beside them: the
 * last one that defines `circuit_log_comments_body_check` says what the server takes. This reads
 * files, like settings-touch and motion-sweep do, because `src/` has no Node types.
 */

const MIGRATIONS = join('supabase', 'migrations')

function serverMax() {
  let max = null
  for (const f of readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    const sql = readFileSync(join(MIGRATIONS, f), 'utf8')
    for (const m of sql.matchAll(/circuit_log_comments_body_check"?\s+CHECK\s*\(([^;]*)/gi)) {
      const le = /char_length"?\s*\(\s*"?body"?\s*\)\s*<=\s*(\d+)/i.exec(m[1])
      if (le) max = Number(le[1])
    }
  }
  if (max === null) throw new Error('no migration defines circuit_log_comments_body_check')
  return max
}

const social = readFileSync(join('src', 'circuit', 'social.ts'), 'utf8')
const commentMax = Number(/export const COMMENT_MAX = (\d+)/.exec(social)?.[1])

describe('the feed’s comment box', () => {
  it('caps at no more than the server takes, so a comment can never vanish for its length', () => {
    const server = serverMax()
    expect(server).toBe(1000) // the schema as it stands; a change there should be looked at here
    expect(commentMax).toBeGreaterThan(0)
    expect(commentMax).toBeLessThanOrEqual(server)
  })

  it('carries the cap on the input itself', () => {
    const src = readFileSync(join('src', 'circuit', 'ui', 'Feed.tsx'), 'utf8')
    const at = src.indexOf('placeholder="Add a comment…"')
    expect(at).toBeGreaterThan(-1)
    const input = src.slice(src.lastIndexOf('<input', at), src.indexOf('/>', at))
    expect(input).toMatch(/maxLength=\{COMMENT_MAX\}/)
  })
})
