/**
 * WGSL's own layout rules for the scalar and vector types the Lab's uniforms use: each member sits
 * on a multiple of its alignment, and the struct's size rounds up to its largest alignment.
 *
 * ⚠️ FOR TESTS. Every uniform in the Lab is packed by hand in TypeScript, and the only honest
 * check of a hand-packed table is a second opinion that shares nothing with it — so this reads
 * the struct out of the shader source and lays it out from the spec's table, never from the
 * packer's offsets.
 */
const WGSL: Record<string, { size: number; align: number }> = {
  f32: { size: 4, align: 4 },
  u32: { size: 4, align: 4 },
  i32: { size: 4, align: 4 },
  vec2f: { size: 8, align: 8 },
  vec2u: { size: 8, align: 8 },
  vec2i: { size: 8, align: 8 },
  vec3f: { size: 12, align: 16 },
  vec4f: { size: 16, align: 16 },
  vec4u: { size: 16, align: 16 },
  /* four vec4f columns */
  mat4x4f: { size: 64, align: 16 },
}
const roundUp = (n: number, k: number) => Math.ceil(n / k) * k

export function wgslLayout(source: string, struct: string) {
  const body = source.match(new RegExp(`struct ${struct} \\{([^}]*)\\}`))?.[1]
  if (!body) throw new Error(`no struct ${struct} in that source`)
  const fields = [...body.replace(/\/\/.*$/gm, '').matchAll(/(\w+)\s*:\s*(\w+)\s*,/g)]
  let at = 0
  let widest = 1
  const offsets: Record<string, number> = {}
  for (const [, name, type] of fields) {
    const t = WGSL[type]
    if (!t) throw new Error(`wgslLayout does not know ${type}`)
    at = roundUp(at, t.align)
    offsets[name] = at
    at += t.size
    widest = Math.max(widest, t.align)
  }
  return { offsets, bytes: roundUp(at, widest), names: fields.map((f) => f[1]) }
}
