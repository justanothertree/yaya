// The jump flood: seeding, then one pass per step. Every texel holds the nearest seed it knows
// of — xy where it is, z which letter it belongs to, w 1 if there is one — and each pass it asks
// nine texels `step` away whether they know of a nearer one. See neon.ts. Joined after
// neon-types.wgsl; `seed` and `flood` are separate entry points over the same two textures.

@group(0) @binding(1) var flood_in: texture_2d<f32>;
@group(0) @binding(2) var flood_out: texture_storage_2d<rgba32float, write>;

const LETTER_STEP = 15.0;

fn lit(p: vec2i) -> bool {
  if (any(p < vec2i(0)) || any(p >= vec2i(N.size))) {
    return false;
  }
  return textureLoad(flood_in, p, 0).a > 0.5;
}

// From the text's mask: which texels are seeds, and whose. Letter i is drawn in red (i + 1)·15/255.
// ⚠️ SPACED 15 APART, NOT 1: a canvas keeps colour premultiplied by alpha and divides it back out
// when read, so at an antialiased edge a red of 1 comes back as 2 — the next letter. Measured with
// ids 1 apart: 18% of texels carried the wrong letter. A rounding error of a few cannot cross 15.
@compute @workgroup_size(8, 8)
fn seed(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= N.size)) {
    return;
  }
  let p = vec2i(id.xy);
  var out = vec4f(-1.0, -1.0, 0.0, 0.0);
  if (lit(p)) {
    let edge = !lit(p + vec2i(1, 0)) || !lit(p - vec2i(1, 0)) || !lit(p + vec2i(0, 1)) || !lit(p - vec2i(0, 1));
    if (N.style == 1u || edge) {
      let letter = round(textureLoad(flood_in, p, 0).r * 255.0 / LETTER_STEP) - 1.0;
      out = vec4f(vec2f(p), max(letter, 0.0), 1.0);
    }
  }
  textureStore(flood_out, id.xy, out);
}

@compute @workgroup_size(8, 8)
fn flood(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= N.size)) {
    return;
  }
  let p = vec2i(id.xy);
  let here = vec2f(p);
  var best = textureLoad(flood_in, p, 0);
  var bd = select(1e20, dot(best.xy - here, best.xy - here), best.w > 0.0);
  let s = i32(N.step);
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let q = p + vec2i(dx, dy) * s;
      if (any(q < vec2i(0)) || any(q >= vec2i(N.size))) {
        continue;
      }
      let c = textureLoad(flood_in, q, 0);
      if (c.w <= 0.0) {
        continue;
      }
      let d = dot(c.xy - here, c.xy - here);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
  }
  textureStore(flood_out, id.xy, best);
}
