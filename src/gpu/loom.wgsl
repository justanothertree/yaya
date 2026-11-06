// The loom: one fullscreen pass. Every pixel works out which part of the draft it is on — the
// threading along the top, the tie-up in the corner, the treadling down the right, or the cloth —
// and the cloth's pixels weave themselves: the cell's own crossing (one bit of the tie-up, chosen
// by the end's shaft and the pick's treadle), its neighbours' along each thread (to bend the thread
// where it dives under), and, when asked, the run of its float.

struct Loom {
  size: vec2u,
  cell: f32,
  woven: f32,
  first: u32,
  floats: u32,
  light: vec2f,
}

@group(0) @binding(0) var<uniform> P: Loom;
@group(0) @binding(1) var<storage, read> D: array<u32>;

const SHAFTS = 8.0;
const REPEAT = 64u;
const MAX_FLOAT = 16u;
const AT_THREADING = 0u;
const AT_TREADLING = 64u;
const AT_WARP = 128u;
const AT_WEFT = 192u;
const AT_TIEUP = 256u;
const AT_WORDS = 264u;

/** a thread's half-width, as a fraction of its cell */
const BAND = 0.42;

@vertex
fn cover(@builtin(vertex_index) v: u32) -> @builtin(position) vec4f {
  let p = array(vec2f(-1, -3), vec2f(3, 1), vec2f(-1, 1))[v];
  return vec4f(p, 0, 1);
}

fn wrap(i: i32) -> u32 {
  return u32(((i % i32(REPEAT)) + i32(REPEAT)) % i32(REPEAT));
}
fn shaft_of(end: i32) -> u32 {
  return D[AT_THREADING + wrap(end)];
}
fn treadle_of(pick: i32) -> u32 {
  return D[AT_TREADLING + wrap(pick)];
}
fn up(pick: i32, end: i32) -> bool {
  return ((D[AT_TIEUP + treadle_of(pick)] >> shaft_of(end)) & 1u) == 1u;
}
fn rgb(c: u32) -> vec3f {
  return vec3f(f32((c >> 16u) & 255u), f32((c >> 8u) & 255u), f32(c & 255u)) / 255.0;
}
fn hash(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(12.9898, 78.233))) * 43758.547);
}

/** the float this cell is part of, as floatAt in loom.ts counts it */
fn float_at(pick: i32, end: i32) -> u32 {
  var n = 1u;
  if (up(pick, end)) {
    for (var k = 1; k <= i32(MAX_FLOAT) && up(pick - k, end); k++) { n++; }
    for (var k = 1; k <= i32(MAX_FLOAT) && up(pick + k, end); k++) { n++; }
  } else {
    for (var k = 1; k <= i32(MAX_FLOAT) && !up(pick, end - k); k++) { n++; }
    for (var k = 1; k <= i32(MAX_FLOAT) && !up(pick, end + k); k++) { n++; }
  }
  return n;
}

/**
 * A thread lit as a twisted cylinder. `across` is -1..1 over its width; `h` how high it rides
 * (1 on top, falling to 0 where it dives under), `slope` how fast that changes along it; `along`
 * is px along the thread, for the twist's slant.
 */
fn yarn(colour: vec3f, across: f32, h: f32, slope: f32, along: f32, vertical: bool) -> vec3f {
  let a = clamp(across, -0.98, 0.98);
  var n = vec3f(a, -slope * 0.8, sqrt(1.0 - a * a));
  if (!vertical) {
    n = vec3f(-slope * 0.8, a, sqrt(1.0 - a * a));
  }
  n = normalize(n);
  let l = normalize(vec3f(P.light, 0.85));
  let diffuse = 0.3 + 0.7 * max(dot(n, l), 0.0);
  let sheen = pow(max(dot(reflect(-l, n), vec3f(0, 0, 1)), 0.0), 14.0) * 0.22;
  // the ply's twist: fine slanting ridges along the thread
  let twist = 0.9 + 0.1 * sin((along + across * P.cell * 0.55) * 6.2832 / max(2.5, P.cell * 0.32));
  return colour * diffuse * twist * mix(0.5, 1.0, h) + vec3f(sheen);
}

/** how high a thread on top rides at `t` (0..1 along its cell), diving where a neighbour is under */
fn ride(t: f32, dive_before: bool, dive_after: bool) -> vec2f {
  var h = 1.0;
  var s = 0.0;
  if (dive_before && t < 0.5) {
    let k = t / 0.5;
    h = sin(k * 1.5708);
    s = cos(k * 1.5708);
  }
  if (dive_after && t > 0.5) {
    let k = (1.0 - t) / 0.5;
    h = sin(k * 1.5708);
    s = -cos(k * 1.5708);
  }
  return vec2f(h, s);
}

fn cloth(px: vec2f, margin: f32, cols: f32) -> vec3f {
  let c = P.cell;
  let q = vec2f(px.x, px.y - margin) / c;
  let cell = floor(q);
  let uv = q - cell;
  let end = i32(cell.x);
  let pick = i32(P.first) + i32(cell.y);
  let w = floor(P.woven);
  var weft = f32(pick) < w;
  if (f32(pick) == w) {
    // the shuttle on its way across: left to right on even picks, back on odd
    let f = fract(P.woven);
    let x = q.x / cols;
    weft = select((x < f), (x > 1.0 - f), (pick & 1) == 1);
  }
  let warp_c = rgb(D[AT_WARP + wrap(end)]);
  let weft_c = rgb(D[AT_WEFT + wrap(pick)]);
  let ax = (uv.x - 0.5) / BAND;
  let ay = (uv.y - 0.5) / BAND;
  let in_warp = abs(ax) < 1.0;
  let in_weft = abs(ay) < 1.0 && weft;
  let w_up = up(pick, end) || !weft;
  // whether the rows either side are woven yet decides whether a thread has anything to dive under
  let woven_before = f32(pick - 1) < w;
  let woven_after = f32(pick + 1) < w;

  var col = vec3f(0.05, 0.04, 0.05);
  if (in_warp && (w_up || !in_weft)) {
    if (w_up) {
      let r = ride(uv.y, woven_before && weft && !up(pick - 1, end), woven_after && weft && !up(pick + 1, end));
      col = yarn(warp_c, ax, r.x, r.y, px.y, true);
    } else {
      col = yarn(warp_c, ax, 0.15, 0.0, px.y, true);
    }
  } else if (in_weft) {
    if (!w_up) {
      let r = ride(uv.x, up(pick, end - 1), up(pick, end + 1));
      col = yarn(weft_c, ay, r.x, r.y, px.x, false);
    } else {
      col = yarn(weft_c, ay, 0.15, 0.0, px.x, false);
    }
  } else if (!weft) {
    // no weft yet: the loom's dark under the bare warp
    col = vec3f(0.09, 0.08, 0.1);
  }
  col *= 0.95 + 0.1 * hash(floor(px));
  if (P.floats > 0u && weft && (in_warp || in_weft) && float_at(pick, end) > P.floats) {
    // a float too long to wear: marked in diagonal red hatching
    let hatch = step(0.5, fract((px.x + px.y) / 6.0));
    col = mix(col, vec3f(1.0, 0.18, 0.12), 0.35 + 0.25 * hatch);
  }
  return col;
}

/** the draft's paper, its squares, and a square's ink */
fn paper(px: vec2f, origin: vec2f, filled: f32, faint: bool) -> vec3f {
  let c = P.cell;
  let q = (px - origin) / c;
  let e = min(fract(q), 1.0 - fract(q)) * c;
  // a fine line round every square, a firmer one every four
  let major = (u32(floor(q.x)) % 4u == 0u && fract(q.x) * c < 1.0)
    || (u32(floor(q.y)) % 4u == 0u && fract(q.y) * c < 1.0);
  var col = vec3f(0.95, 0.93, 0.87);
  if (min(e.x, e.y) < 0.6) {
    col = vec3f(0.78, 0.76, 0.72);
  }
  if (major) {
    col = vec3f(0.6, 0.58, 0.56);
  }
  if (filled > 0.5 && min(e.x, e.y) > 1.2) {
    col = select(vec3f(0.15, 0.15, 0.2), vec3f(0.62, 0.62, 0.68), faint);
  }
  return col;
}

@fragment
fn show(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let size = vec2f(P.size);
  let c = P.cell;
  let margin = c * (SHAFTS + 1.0);
  let px = pos.xy;
  let left = px.x < size.x - margin;
  let top = px.y < margin;
  let cols = floor((size.x - margin) / c);
  let rows = floor((size.y - margin) / c);
  let blank = vec3f(0.95, 0.93, 0.87);
  if (left && !top) {
    if (px.x >= cols * c || px.y >= margin + rows * c) {
      return vec4f(blank, 1);
    }
    return vec4f(cloth(px, margin, cols), 1);
  }
  let r = floor(px.y / c);
  if (top && r >= SHAFTS) {
    return vec4f(blank, 1);
  }
  let shaft = u32(SHAFTS - 1.0 - r);
  if (left) {
    let col = floor(px.x / c);
    if (col >= cols) {
      return vec4f(blank, 1);
    }
    let filled = f32(shaft_of(i32(col)) == shaft);
    return vec4f(paper(px, vec2f(0), filled, false), 1);
  }
  let x0 = size.x - margin + c;
  if (px.x < x0) {
    return vec4f(blank, 1);
  }
  let t = u32(floor((px.x - x0) / c));
  if (top) {
    let filled = f32(((D[AT_TIEUP + t] >> shaft) & 1u) == 1u);
    return vec4f(paper(px, vec2f(x0, 0), filled, false), 1);
  }
  let row = floor((px.y - margin) / c);
  if (row >= rows) {
    return vec4f(blank, 1);
  }
  let pick = i32(P.first) + i32(row);
  let filled = f32(treadle_of(pick) == t);
  var col = paper(px, vec2f(x0, margin), filled, f32(pick) > P.woven);
  // the pick being woven now
  if (pick == i32(floor(P.woven))) {
    col *= vec3f(1.0, 0.93, 0.7);
  }
  return vec4f(col, 1);
}
