// Seedling: a small walled garden of Life. `grow` is one generation — `step` in seedling.ts line for
// line, with the rule as two masks over the neighbour count and the edge as dead ground — and it also
// lights any lamp a live cell stands on and keeps a fading glow where life has been. `show` draws the
// garden: soil, the planting plot (the "patch"; `patch` is a WGSL keyword), stones, lamps (lit or waiting), life and its glow; turned upright
// on a tall stage, like Gust (gardenFit in seedling.ts).

struct Garden {
  size: vec2u,
  grid: vec2u,
  plot: vec4u,
  born: u32,
  stays: u32,
  time: f32,
  phase: f32,
  planting: u32,
}

const STONE = 1u;
const LAMP = 2u;
const LIT = 4u;

@group(0) @binding(0) var<uniform> G: Garden;
@group(0) @binding(1) var<storage, read> cells: array<u32>;
@group(0) @binding(2) var<storage, read_write> next: array<u32>;
@group(0) @binding(3) var<storage, read_write> marks: array<u32>;
@group(0) @binding(4) var<storage, read_write> glow: array<f32>;

fn cols() -> i32 { return i32(G.grid.x); }
fn rows() -> i32 { return i32(G.grid.y); }
fn idx(x: i32, y: i32) -> u32 { return u32(y * cols() + x); }

@compute @workgroup_size(8, 8)
fn grow(@builtin(global_invocation_id) id: vec3u) {
  let x = i32(id.x);
  let y = i32(id.y);
  if (x >= cols() || y >= rows()) {
    return;
  }
  var n = 0u;
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      if (dx == 0 && dy == 0) {
        continue;
      }
      let nx = x + dx;
      let ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < cols() && ny < rows()) {
        n += cells[idx(nx, ny)];
      }
    }
  }
  let i = idx(x, y);
  let mask = select(G.born, G.stays, cells[i] == 1u);
  let m = marks[i];
  let alive = select((mask >> n) & 1u, 0u, (m & STONE) != 0u);
  next[i] = alive;
  if (alive == 1u && (m & LAMP) != 0u) {
    marks[i] = m | LIT;
  }
  glow[i] = select(glow[i] * 0.82, 1.0, alive == 1u);
}

// ---------------------------------------------------------------- drawing

@group(1) @binding(0) var<storage, read> seen: array<u32>;
@group(1) @binding(1) var<storage, read> seenMarks: array<u32>;
@group(1) @binding(2) var<storage, read> seenGlow: array<f32>;

@vertex
fn cover(@builtin(vertex_index) v: u32) -> @builtin(position) vec4f {
  let p = array(vec2f(-1, -3), vec2f(3, 1), vec2f(-1, 1))[v];
  return vec4f(p, 0, 1);
}

/** where a pixel is in the garden, in cells, and how many cells a pixel is (gardenFit in seedling.ts) */
fn to_garden(pos: vec2f) -> vec3f {
  let size = vec2f(G.size);
  let w = f32(cols());
  let h = f32(rows());
  if (size.y > size.x) {
    let s = min(size.x / (h + 1.0), size.y / (w + 1.0));
    let o = (size - vec2f(h, w) * s) * 0.5;
    return vec3f(w - (pos.y - o.y) / s, (pos.x - o.x) / s, 1.0 / s);
  }
  let s = min(size.x / (w + 1.0), size.y / (h + 1.0));
  let o = (size - vec2f(w, h) * s) * 0.5;
  return vec3f((pos - o) / s, 1.0 / s);
}

/** a rounded square of half-size r in a cell's own coordinates (0..1), soft over `px` */
fn tile(f: vec2f, r: f32, round: f32, px: f32) -> f32 {
  let q = abs(f - 0.5) - vec2f(r - round);
  let d = length(max(q, vec2f(0))) + min(max(q.x, q.y), 0.0) - round;
  return smoothstep(px, -px, d);
}

@fragment
fn show(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let g = to_garden(pos.xy);
  let q = g.xy;
  let px = g.z;
  var col = vec3f(0.06, 0.08, 0.07);
  let w = f32(cols());
  let h = f32(rows());
  if (q.x < 0.0 || q.y < 0.0 || q.x >= w || q.y >= h) {
    // a border of hedge round the garden
    let out = max(max(-q.x, q.x - w), max(-q.y, q.y - h));
    col = mix(vec3f(0.13, 0.22, 0.14), col, smoothstep(0.0, 0.5, out));
    return vec4f(col, 1);
  }
  let c = vec2i(floor(q));
  let f = fract(q);
  let i = idx(c.x, c.y);
  let m = seenMarks[i];
  // soil, a little uneven, and faint furrows between the cells
  let grain = fract(sin(dot(vec2f(c), vec2f(12.9898, 78.233))) * 43758.5453);
  col = vec3f(0.24, 0.18, 0.13) * (0.9 + 0.12 * grain);
  let p = G.plot;
  let inPatch = c.x >= i32(p.x) && c.y >= i32(p.y) && c.x < i32(p.x + p.z) && c.y < i32(p.y + p.w);
  if (inPatch) {
    let pulse = select(0.0, 0.08 * (0.5 + 0.5 * sin(G.time * 3.0)), G.planting == 1u);
    col = mix(col, vec3f(0.33, 0.42, 0.22), 0.55 + pulse);
  }
  let edge = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
  col *= mix(0.8, 1.0, smoothstep(0.0, px * 1.5, edge));
  // where life has been: a fading green
  let gl = seenGlow[i];
  col = mix(col, vec3f(0.25, 0.55, 0.3), gl * 0.45);
  if ((m & STONE) != 0u) {
    col = mix(col, vec3f(0.42, 0.42, 0.45) * (0.85 + 0.2 * grain), tile(f, 0.47, 0.18, px));
  }
  if ((m & LAMP) != 0u) {
    let d = distance(f, vec2f(0.5));
    let lit = (m & LIT) != 0u;
    if (lit) {
      col = mix(col, vec3f(1.0, 0.85, 0.35), smoothstep(0.5, 0.0, d));
      col += vec3f(0.5, 0.35, 0.05) * smoothstep(0.75, 0.2, d) * (0.7 + 0.3 * sin(G.time * 4.0));
    } else {
      col = mix(col, vec3f(0.42, 0.34, 0.14), smoothstep(0.4, 0.3, d) * 0.8);
      col = mix(col, vec3f(1.0, 0.82, 0.3), smoothstep(px * 2.5, 0.0, abs(d - 0.36)));
    }
  }
  if (seen[i] == 1u) {
    // a living cell: a bright rounded sprout, swelling in as its generation begins
    let grow = mix(0.32, 0.42, smoothstep(0.0, 0.4, G.phase));
    col = mix(col, vec3f(0.62, 0.95, 0.45), tile(f, grow, 0.16, px));
    col = mix(col, vec3f(0.9, 1.0, 0.8), tile(f, grow * 0.45, 0.1, px) * 0.6);
  }
  return vec4f(col, 1);
}
