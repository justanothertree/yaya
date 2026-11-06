// Drawing the waterworks. Every drop is splatted, additively, into a float texture — water into
// red, ice into green, steam into blue — and one fullscreen pass reads that back as a surface: water
// where enough drops overlap, ice the same way, steam as a soft haze; with the tank's rock, the
// walls you drew, the plates, the cup and the finger's lamp or ice pack drawn around it.

struct Tank {
  size: vec2u,
  grid: vec2u,
  count: u32,
  dt: f32,
  tool: u32,
  toolR: f32,
  toolAt: vec2f,
  flip: f32,
  time: f32,
  cup: vec4f,
}

@group(0) @binding(0) var<uniform> P: Tank;

/** drops in a full cup, and how many fill a cell — waterworks.ts's FILL and its pour */
const FILL = 400.0;
const DROPS_PER_CELL = 4.0;
@group(0) @binding(1) var<storage, read> drops: array<vec4f>;
@group(0) @binding(2) var<storage, read> mask: array<u32>;
@group(0) @binding(3) var<storage, read> heat: array<vec2f>;
@group(0) @binding(4) var splats: texture_2d<f32>;

/** the tank's cells to the screen: as big as fits, centred */
fn fit() -> vec3f {
  let size = vec2f(P.size);
  let s = min(size.x / f32(P.grid.x), size.y / f32(P.grid.y));
  let o = (size - vec2f(P.grid) * s) * 0.5;
  return vec3f(o, s);
}

struct Splat {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) @interpolate(flat) kind: vec3f,
}

@vertex
fn splat_vs(@builtin(vertex_index) v: u32) -> Splat {
  let i = v / 6u;
  let a = drops[i * 2u];
  let b = drops[i * 2u + 1u];
  let corner = array(vec2f(-1, -1), vec2f(1, -1), vec2f(-1, 1), vec2f(-1, 1), vec2f(1, -1), vec2f(1, 1))[v % 6u];
  let f = fit();
  // water and ice a cell and a bit across, steam a puff
  let r = select(1.25, 2.6, b.y == 3.0);
  let px = f.xy + (a.xy + corner * r) * f.z;
  var o: Splat;
  o.pos = vec4f(px / vec2f(P.size) * vec2f(2, -2) + vec2f(-1, 1), 0, 1);
  if (b.y == 0.0) {
    o.pos = vec4f(2, 2, 0, 1);
  }
  o.uv = corner;
  o.kind = vec3f(f32(b.y == 1.0), f32(b.y == 2.0), f32(b.y == 3.0));
  return o;
}

@fragment
fn splat_fs(i: Splat) -> @location(0) vec4f {
  let k = max(0.0, 1.0 - dot(i.uv, i.uv));
  return vec4f(i.kind * k * k, 0);
}

@vertex
fn cover(@builtin(vertex_index) v: u32) -> @builtin(position) vec4f {
  let p = array(vec2f(-1, -3), vec2f(3, 1), vec2f(-1, 1))[v];
  return vec4f(p, 0, 1);
}

fn hash(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.547);
}

fn field(px: vec2i) -> vec4f {
  return textureLoad(splats, clamp(px, vec2i(0), vec2i(P.size) - 1), 0);
}

@fragment
fn show(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let f = fit();
  let q = (pos.xy - f.xy) / f.z;
  // outside the tank: the room
  if (q.x < 0.0 || q.y < 0.0 || q.x >= f32(P.grid.x) || q.y >= f32(P.grid.y)) {
    return vec4f(0.08, 0.09, 0.12, 1);
  }
  let cell = vec2u(floor(q));
  let c = cell.y * P.grid.x + cell.x;
  // the back of the tank: pale tiles
  let tile = fract(q / 8.0);
  var col = vec3f(0.86, 0.9, 0.93) - 0.05 * f32(min(tile.x, tile.y) < 0.03);
  // the cup's inside, and the line it must fill to
  let cup = P.cup;
  let inCup = q.x >= cup.x && q.x < cup.x + cup.z && q.y >= cup.y && q.y < cup.y + cup.w;
  if (inCup) {
    col = mix(col, vec3f(1.0, 0.95, 0.75), 0.6);
  }
  // heat and cold, a glow where the plates are
  let h = heat[c];
  if (h.y > 0.0) {
    col = mix(col, select(vec3f(1.0, 0.45, 0.3), vec3f(0.55, 0.8, 1.0), h.x < 20.0), 0.35);
  }
  // the liquid, the ice and the steam, from the splats
  let s = field(vec2i(pos.xy));
  let steam = smoothstep(0.1, 1.2, s.b);
  col = mix(col, vec3f(1.0), steam * 0.75);
  let iceEdge = smoothstep(0.45, 0.6, s.g);
  if (iceEdge > 0.0) {
    let facet = 0.85 + 0.15 * hash(floor(q * 0.5));
    col = mix(col, vec3f(0.75, 0.92, 1.0) * facet, iceEdge);
  }
  let wet = smoothstep(0.5, 0.65, s.r);
  if (wet > 0.0) {
    // the surface's slope lights its edge
    let gx = field(vec2i(pos.xy) + vec2i(2, 0)).r - field(vec2i(pos.xy) - vec2i(2, 0)).r;
    let gy = field(vec2i(pos.xy) + vec2i(0, 2)).r - field(vec2i(pos.xy) - vec2i(0, 2)).r;
    let rim = smoothstep(0.0, 1.5, length(vec2f(gx, gy))) * (1.0 - smoothstep(0.5, 1.6, s.r));
    var water = mix(vec3f(0.15, 0.45, 0.85), vec3f(0.08, 0.25, 0.6), smoothstep(0.6, 3.0, s.r));
    water += vec3f(0.5, 0.7, 0.9) * rim * 0.6;
    col = mix(col, water, wet * 0.92);
  }
  // rock and the walls you drew
  let m = mask[c];
  if (m == 1u) {
    col = vec3f(0.32, 0.33, 0.38) * (0.85 + 0.15 * hash(vec2f(cell)));
  } else if (m == 2u) {
    col = vec3f(0.62, 0.42, 0.24) * (0.85 + 0.15 * hash(vec2f(cell) * 1.7));
  }
  /* the cup's fill line: where FILL drops come to, four to a cell across its width. ⚠️ It was
     drawn at the rim at first, and a cup that was "full" looked a quarter full */
  let line = cup.y + cup.w - FILL / (DROPS_PER_CELL * cup.z);
  if (inCup && abs(q.y - line) < 0.3) {
    col = mix(col, vec3f(0.85, 0.3, 0.2), 0.8);
  }
  // the finger's tool
  if (P.tool != 0u) {
    let d = abs(distance(q, P.toolAt) - P.toolR);
    let ring = smoothstep(0.6, 0.0, d);
    col = mix(col, select(vec3f(0.3, 0.6, 1.0), vec3f(1.0, 0.35, 0.15), P.tool == 1u), ring);
  }
  return vec4f(col, 1);
}
