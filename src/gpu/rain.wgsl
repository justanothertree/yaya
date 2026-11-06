// The rainy window. Three passes a frame:
//   splat — every drop, an instanced quad, ADDS a smooth bump to a float field (and that bump
//           times its radius, so a pixel knows how big the water over it is). Where two bumps
//           overlap they sum past the threshold between them, which is what makes two touching
//           drops a single shape with a neck rather than two circles: screen-space metaballs.
//   fog   — the mist remembers: it fogs back over a little each frame, faster where somebody is
//           breathing, and is cleared under a finger and under the water, so a running drop
//           leaves a clean trail that slowly mists over again. Two textures taking turns.
//   show  — the street behind the glass: sharp through clear glass, blurred and pale through the
//           mist, and through a drop bent by the water's surface (rebuilt from the field's
//           gradient) into a small, flipped, sharp picture of what is behind it.

struct Pane {
  size: vec2u,
  fall: vec2f,
  drops: u32,
  wipes: u32,
  dt: f32,
  regrow: f32,
  breath: f32,
  brush: f32,
}

@group(0) @binding(0) var<uniform> P: Pane;
@group(0) @binding(1) var<storage, read> drops: array<vec4f>;
@group(0) @binding(2) var<storage, read> wipes: array<vec4f>;
@group(0) @binding(3) var field: texture_2d<f32>;
@group(0) @binding(4) var mist: texture_2d<f32>;
@group(0) @binding(5) var sharp: texture_2d<f32>;
@group(0) @binding(6) var blurred: texture_2d<f32>;
@group(0) @binding(7) var lin: sampler;

/** a lone drop's kernel reaches this far past its radius, so neighbours can join */
const REACH = 1.6;
/** the field's value at a lone drop's own edge: (1 - 1/REACH²)² */
const ISO = 0.3713;
/** how much longer than its body a full tail is */
const TAIL = 2.0;

struct Splat {
  @builtin(position) pos: vec4f,
  /** where in the drop, in units of its kernel's reach: x along the fall, y across it */
  @location(0) local: vec2f,
  @location(1) @interpolate(flat) r: f32,
  @location(2) @interpolate(flat) tail: f32,
}

@vertex
fn drop_quad(@builtin(vertex_index) v: u32) -> Splat {
  let d = drops[v / 6u];
  let corner = array(vec2f(0, 0), vec2f(1, 0), vec2f(0, 1), vec2f(0, 1), vec2f(1, 0), vec2f(1, 1))[v % 6u];
  let tail = 1.0 + TAIL * d.w;
  // along the fall the quad runs from a tail behind it to a reach ahead; across, a reach each side
  let local = vec2f(mix(-tail, 1.0, corner.x), mix(-1.0, 1.0, corner.y));
  let down = P.fall;
  let side = vec2f(-down.y, down.x);
  let px = d.xy + (down * local.x + side * local.y) * d.z * REACH;
  var o: Splat;
  o.pos = vec4f(px / vec2f(P.size) * vec2f(2, -2) + vec2f(-1, 1), 0, 1);
  o.local = local;
  o.r = d.z;
  o.tail = tail;
  return o;
}

@fragment
fn splat(i: Splat) -> @location(0) vec4f {
  // behind the drop (against the fall) the tail is the same bump stretched back, and thinning
  // and shallowing as it goes, so a runner draws a thread rather than a column. ⚠️ BY HOW MUCH
  // TAIL IT HAS: a drop sitting still has none, and its back half must be its front half
  var q = i.local;
  var back = 0.0;
  if (q.x < 0.0) {
    back = (-q.x / i.tail) * ((i.tail - 1.0) / TAIL);
    q.x = q.x / i.tail;
    q.y = q.y / mix(1.0, 0.45, sqrt(back));
  }
  let k = max(0.0, 1.0 - dot(q, q));
  let f = k * k * (1.0 - 0.35 * back);
  return vec4f(f, f * i.r, 0, 0);
}

@vertex
fn cover(@builtin(vertex_index) v: u32) -> @builtin(position) vec4f {
  let p = array(vec2f(-1, -3), vec2f(3, 1), vec2f(-1, 1))[v];
  return vec4f(p, 0, 1);
}

fn hash(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(12.9898, 78.233))) * 43758.547);
}

fn to_segment(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let ab = b - a;
  let l = dot(ab, ab);
  var t = 0.0;
  if (l > 0.0) {
    t = clamp(dot(p - a, ab) / l, 0.0, 1.0);
  }
  return length(p - a - t * ab);
}

@fragment
fn fog(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let at = vec2i(pos.xy);
  var m = textureLoad(mist, at, 0).r;
  let size = vec2f(P.size);
  // it fogs back unevenly, as real condensation does, in cells a few px across
  let grain = hash(floor(pos.xy / 6.0));
  m += P.dt * P.regrow * (0.5 + grain);
  // a breath fogs from low in the middle, where a face would be
  let c = (pos.xy - size * vec2f(0.5, 0.7)) / size.y;
  m += P.dt * P.breath * 2.5 * exp(-dot(c, c) * 3.0);
  // under the water there is no mist: the water has taken it
  if (textureLoad(field, at, 0).r > ISO) {
    m = 0.0;
  }
  for (var k = 0u; k < P.wipes; k++) {
    let w = wipes[k];
    m *= smoothstep(P.brush * 0.6, P.brush, to_segment(pos.xy, w.xy, w.zw));
  }
  return vec4f(clamp(m, 0.0, 1.0), 0, 0, 1);
}

fn luma(c: vec3f) -> f32 {
  return dot(c, vec3f(0.3, 0.59, 0.11));
}

@fragment
fn show(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let size = vec2f(P.size);
  let uv = pos.xy / size;
  let at = vec2i(pos.xy);
  let hi = vec2i(size) - 1;
  let w = textureLoad(field, at, 0);
  let f = w.r;

  // the glass: sharp where it is clean, blurred and pale where it is misted
  let m = textureSampleLevel(mist, lin, uv, 0.0).r;
  let clear = textureSampleLevel(sharp, lin, uv, 0.0).rgb;
  let soft = textureSampleLevel(blurred, lin, uv, 0.0).rgb;
  var glass = mix(clear, soft, smoothstep(0.0, 0.45, m));
  let pale = vec3f(0.74, 0.77, 0.83) * (0.45 + 0.55 * luma(soft)) + soft * 0.35;
  glass = mix(glass, pale, m * 0.62);
  glass += (hash(floor(pos.xy / 2.0)) - 0.5) * 0.05 * m;

  if (f < ISO * 0.85) {
    return vec4f(glass, 1);
  }

  // the water's surface, from the field's slope
  let s = 2;
  let fx = textureLoad(field, clamp(at + vec2i(s, 0), vec2i(0), hi), 0).r
    - textureLoad(field, clamp(at - vec2i(s, 0), vec2i(0), hi), 0).r;
  let fy = textureLoad(field, clamp(at + vec2i(0, s), vec2i(0), hi), 0).r
    - textureLoad(field, clamp(at - vec2i(0, s), vec2i(0), hi), 0).r;
  let r = w.g / max(f, 1e-4);
  let slope = vec2f(fx, fy) / f32(2 * s) * r * 1.6;
  let n = normalize(vec3f(-slope, 1.0));

  // a drop is a lens: what it shows comes from the far side of it, small and turned over — the
  // edge of the drop looks back past its middle, so the street in it is upside down
  let bent = uv - n.xy * r * 4.0 / size;
  var water = textureSampleLevel(sharp, lin, bent, 0.0).rgb * 1.08 + 0.04;
  // and it gathers light: the far side from the light glows with what came through
  let l2 = normalize(vec3f(0.45, 0.6, 0.65));
  water += textureSampleLevel(blurred, lin, uv, 0.0).rgb * pow(max(0.0, dot(n, l2)), 6.0) * 0.6;
  // the light, from up and to the left, and a dark rim where the surface turns away
  let l = normalize(vec3f(-0.45, -0.6, 0.65));
  let shine = pow(max(0.0, dot(reflect(-l, n), vec3f(0, 0, 1))), 48.0);
  water += vec3f(1.0, 0.97, 0.9) * shine * 1.4;
  water *= mix(0.45, 1.0, smoothstep(0.15, 0.8, n.z));
  let edge = smoothstep(ISO * 0.85, ISO * 1.05, f);
  return vec4f(mix(glass, water, edge), 1);
}
