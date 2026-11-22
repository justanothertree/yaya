import { describe, expect, it } from 'vitest'

/*
 * The rules a server will run must run on a server. The edge function that checks matches by turns
 * (docs/2026-11-14-lab-async-matches-plan.md) imports each toy's `*Room.ts` — its Rules — and
 * everything those import. Deno has no React and no DOM, so none of that may reach either: no
 * package at all, and no component (.tsx). This walks the real imports of every rules module.
 */
const sources = import.meta.glob<string>(['/src/gpu/**/*.{ts,tsx}', '/src/lab/**/*.{ts,tsx}'], {
  query: '?raw',
  import: 'default',
  eager: true,
})

/** every module specifier in a file — import, import type, export … from */
const specs = (text: string) =>
  [...text.matchAll(/(?:^|\n)\s*(?:import|export)\b[^'"]*?from\s+['"]([^'"]+)['"]/g)].map(
    (m) => m[1],
  )

function resolve(from: string, spec: string): string | null {
  const parts = from.split('/').slice(0, -1)
  for (const seg of spec.split('/')) {
    if (seg === '..') parts.pop()
    else if (seg !== '.') parts.push(seg)
  }
  const base = parts.join('/')
  for (const p of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`])
    if (p in sources) return p
  return null
}

/** what a module reaches: every file, and anything that is not a file in this repository */
function walk(root: string) {
  const files = new Set<string>()
  const outside: string[] = []
  const stack = [root]
  while (stack.length) {
    const f = stack.pop()!
    if (files.has(f)) continue
    files.add(f)
    for (const spec of specs(sources[f])) {
      if (!spec.startsWith('.')) {
        outside.push(`${f} → ${spec}`)
        continue
      }
      const to = resolve(f, spec)
      if (!to) outside.push(`${f} → ${spec} (unresolved)`)
      else stack.push(to)
    }
  }
  return { files: [...files], outside }
}

const roots = [
  '/src/lab/social/room.ts',
  ...Object.keys(sources).filter((p) => /^\/src\/gpu\/\w+Room\.ts$/.test(p)),
]

describe('the rules a server will run', () => {
  it('are found: room.ts and every toy that plays in a room', () => {
    expect(roots).toEqual(
      expect.arrayContaining([
        '/src/gpu/reversiRoom.ts',
        '/src/gpu/chessRoom.ts',
        '/src/gpu/gomokuRoom.ts',
        '/src/gpu/draughtsRoom.ts',
        '/src/gpu/dotsRoom.ts',
        '/src/gpu/fourrowRoom.ts',
        '/src/gpu/lampsRoom.ts',
      ]),
    )
  })
  it.each(roots)('%s reaches no package, no React and no component', (root) => {
    const { files, outside } = walk(root)
    expect(outside).toEqual([])
    expect(files.filter((f) => f.endsWith('.tsx'))).toEqual([])
  })
  it('reach the game modules themselves, so the walk is not passing by finding nothing', () => {
    const reached = new Set(roots.flatMap((r) => walk(r).files))
    for (const f of [
      '/src/gpu/chess.ts',
      '/src/gpu/lamps.ts',
      '/src/gpu/gomoku.ts',
      '/src/gpu/stored.ts',
    ])
      expect(reached.has(f), f).toBe(true)
  })
})
