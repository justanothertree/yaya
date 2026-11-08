// The Lab's orbit game. A fullscreen pass draws space — stars, the planet lit from one side with a
// thin atmosphere, and the goal: up to two bands round the planet — and an instanced pass draws every
// line over it as a soft capsule, added: the trail, the predicted path, the probe and its flame.

struct U {
  // canvas size; the planet's centre, in pixels
  view: vec4f,
  // pixels per unit, time, band radius A, band radius B (0 = none)
  more: vec4f,
  // band half-width A, B; met (0..1); escape goal (1)
  goal: vec4f,
}

@group(0) @binding(0) var<uniform> u: U;
// per line: (x0, y0, x1, y1) then (r, g, b, half-width in pixels)
@group(0) @binding(1) var<storage, read> lines: array<vec4f>;

struct Cover {
  @builtin(position) pos: vec4f,
}

@vertex
fn cover(@builtin(vertex_index) i: u32) -> Cover {
  let xy = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  var o: Cover;
  o.pos = vec4f(xy * 2.0 - 1.0, 0.0, 1.0);
  return o;
}

fn hash(p: vec2f) -> f32 {
  let q = vec2u(vec2i(floor(p)));
  var h = q.x * 747796405u + q.y * 2891336453u;
  h = ((h >> ((h >> 28u) + 4u)) ^ h) * 277803737u;
  return f32((h >> 22u) ^ h) / 4294967295.0;
}

@fragment
fn space(in: Cover) -> @location(0) vec4f {
  let s = u.more.x;
  let p = vec2f(in.pos.x - u.view.z, u.view.w - in.pos.y) / s; // units, y up
  let r = length(p);
  var col = vec3f(0.01, 0.012, 0.03);
  // stars: one in some cells of a fine grid, twinkling a little
  let cell = in.pos.xy / 3.0;
  let h = hash(cell);
  if (h > 0.996) {
    col += vec3f(0.6, 0.65, 0.8) * (0.6 + 0.4 * sin(u.more.y * 2.0 + h * 50.0));
  }
  // the goal bands: a soft fill and dashed edges, brighter when the orbit is met
  let lit = u.goal.z;
  for (var k = 0; k < 2; k++) {
    let br = select(u.more.z, u.more.w, k == 1);
    let hw = select(u.goal.x, u.goal.y, k == 1);
    if (br <= 0.0) { continue; }
    let d = abs(r - br);
    if (d < hw) {
      col += mix(vec3f(0.05, 0.12, 0.08), vec3f(0.1, 0.35, 0.15), lit);
    }
    let edge = abs(d - hw) * s;
    let dash = fract(atan2(p.y, p.x) * br * 3.0) < 0.5;
    if (edge < 1.0 && dash) {
      col += mix(vec3f(0.2, 0.5, 0.3), vec3f(0.4, 1.0, 0.5), lit);
    }
  }
  // escape: a faint edge of the map, far out
  if (u.goal.w > 0.5) {
    let d = abs(r - 6.0) * s;
    if (d < 1.0 && fract(atan2(p.y, p.x) * 20.0) < 0.5) {
      col += vec3f(0.3, 0.3, 0.5) * (0.5 + 0.5 * lit);
    }
  }
  // the planet: lit from the upper left, an ocean-and-land surface, an atmosphere just outside
  if (r < 1.0) {
    let z = sqrt(1.0 - r * r);
    let n = vec3f(p, z);
    let light = max(dot(n, normalize(vec3f(-0.6, 0.5, 0.6))), 0.0);
    // continents: smooth value noise, so the coast is a curve rather than a staircase of cells
    let q = (p + 3.0) * 4.0;
    let i = floor(q);
    let fq = q - i;
    let w2 = fq * fq * (3.0 - 2.0 * fq);
    let nz = mix(mix(hash(i), hash(i + vec2f(1.0, 0.0)), w2.x), mix(hash(i + vec2f(0.0, 1.0)), hash(i + vec2f(1.0, 1.0)), w2.x), w2.y);
    let land = nz > 0.55;
    let base = select(vec3f(0.1, 0.25, 0.55), vec3f(0.2, 0.45, 0.25), land);
    col = base * (0.12 + 0.9 * light);
  } else {
    let a = exp(-(r - 1.0) * 14.0);
    col += vec3f(0.25, 0.45, 0.9) * a * 0.6;
  }
  return vec4f(col, 1.0);
}

const CORNERS = array<vec2f, 6>(
  vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(0.0, 1.0),
  vec2f(0.0, 1.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0),
);

struct Line {
  @builtin(position) pos: vec4f,
  @location(0) px: vec2f,
  @location(1) @interpolate(flat) a: vec2f,
  @location(2) @interpolate(flat) b: vec2f,
  @location(3) @interpolate(flat) colour: vec4f,
}

fn to_px(p: vec2f) -> vec2f {
  return vec2f(u.view.z + p.x * u.more.x, u.view.w - p.y * u.more.x);
}

@vertex
fn line_vs(@builtin(vertex_index) i: u32, @builtin(instance_index) j: u32) -> Line {
  let ab = lines[j * 2u];
  let c = lines[j * 2u + 1u];
  let a = to_px(ab.xy);
  let b = to_px(ab.zw);
  // the box must hold the whole halo, or the halo ends in a visible square edge
  let pad = c.w * 5.0 + 4.0;
  let lo = min(a, b) - vec2f(pad);
  let hi = max(a, b) + vec2f(pad);
  let corner = lo + (hi - lo) * CORNERS[i];
  var o: Line;
  o.pos = vec4f(corner.x / u.view.x * 2.0 - 1.0, 1.0 - corner.y / u.view.y * 2.0, 0.0, 1.0);
  o.px = corner;
  o.a = a;
  o.b = b;
  o.colour = c;
  return o;
}

@fragment
fn line_fs(in: Line) -> @location(0) vec4f {
  let ab = in.b - in.a;
  let t = clamp(dot(in.px - in.a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
  let d = length(in.px - in.a - ab * t);
  let w = in.colour.w;
  let core = 1.0 - smoothstep(w - 0.5, w + 0.5, d);
  let glow = exp(-d / (w * 1.5 + 1.0)) * 0.35;
  return vec4f(in.colour.rgb * (core + glow), 1.0);
}
