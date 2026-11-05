// Marbles on a tilted board: a distance field from the walls, then each step guess, sort into
// cells (count, scan, scatter), keep apart, and fall into holes. See marbles.ts.
//
// ⚠️ `Maze` IS PACKED BY HAND IN marbles.ts (`MAZE`); marbles.test.ts lays it out from here.

struct Maze {
  size: vec2u, // the canvas, in pixels
  board: vec2u, // field cells across and down
  cells: vec2u, // hash cells across and down
  gravity: vec2f, // cells a second², from the tilt
  count: u32, // marble slots in use
  dt: f32,
  radius: f32, // of a brush dab, cells
  dabs: u32,
}

@group(0) @binding(0) var<uniform> M: Maze;

const RADIUS = 1.6;
const HASH = 3.2;
const DMAX = 8.0;
const MAX_PUSH = 1.6;
const MAX_SPEED = 250.0;
const OPEN = 0u;
const WALL = 1u;
const HOLE = 2u;

@group(0) @binding(1) var<storage, read_write> kind: array<u32>;
// the chamfer's two halves: x from the walls (0 on a wall), y from the open (0 in the open); the
// field is x − y — negative inside a wall (marbles.ts `distanceField` says why)
@group(0) @binding(2) var<storage, read_write> dist_a: array<vec2f>;
@group(0) @binding(3) var<storage, read_write> dist_b: array<vec2f>;
@group(0) @binding(4) var<storage, read> dab: array<vec4f>; // x, y, kind to paint, -

fn cell_index(c: vec2i) -> u32 {
  let b = vec2i(M.board);
  let q = clamp(c, vec2i(0), b - 1);
  return u32(q.y * b.x + q.x);
}

// ---- the board: brush, then the distance field

@compute @workgroup_size(8, 8)
fn paint(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= M.board.x || id.y >= M.board.y) {
    return;
  }
  let i = id.y * M.board.x + id.x;
  let edge = id.x == 0u || id.y == 0u || id.x == M.board.x - 1u || id.y == M.board.y - 1u;
  for (var k = 0u; k < M.dabs; k++) {
    let d = dab[k];
    if (!edge && distance(vec2f(id.xy) + 0.5, d.xy) <= M.radius) {
      kind[i] = u32(d.z);
    }
  }
}

@compute @workgroup_size(8, 8)
fn seed_field(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= M.board.x || id.y >= M.board.y) {
    return;
  }
  let i = id.y * M.board.x + id.x;
  let wall = kind[i] == WALL;
  dist_a[i] = vec2f(select(DMAX, 0.0, wall), select(0.0, DMAX, wall));
}

// one chamfer pass, a → b: marbles.ts `distanceField`
@compute @workgroup_size(8, 8)
fn spread(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= M.board.x || id.y >= M.board.y) {
    return;
  }
  let c = vec2i(id.xy);
  var m = dist_a[cell_index(c)];
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let n = c + vec2i(dx, dy);
      if ((dx == 0 && dy == 0) || n.x < 0 || n.y < 0 || n.x >= i32(M.board.x) || n.y >= i32(M.board.y)) {
        continue;
      }
      m = min(m, dist_a[cell_index(n)] + vec2f(select(1.0, 1.41421356, dx != 0 && dy != 0)));
    }
  }
  dist_b[cell_index(c)] = m;
}

fn signed(v: vec2f) -> f32 {
  return v.x - v.y;
}

// marbles.ts `sampleField`: the field between cells, and which way it rises
fn field(p: vec2f) -> vec3f {
  let f = p - 0.5;
  let c = vec2i(floor(f));
  let t = f - floor(f);
  let a = signed(dist_a[cell_index(c)]);
  let b = signed(dist_a[cell_index(c + vec2i(1, 0))]);
  let d = signed(dist_a[cell_index(c + vec2i(0, 1))]);
  let e = signed(dist_a[cell_index(c + vec2i(1, 1))]);
  let v = mix(mix(a, b, t.x), mix(d, e, t.x), t.y);
  let g = vec2f((b - a) * (1.0 - t.y) + (e - d) * t.y, (d - a) * (1.0 - t.x) + (e - b) * t.x);
  let l = length(g);
  return vec3f(v, select(vec2f(0.0), g / l, l > 1e-6));
}

// ---- the marbles

@group(0) @binding(5) var<storage, read_write> marble: array<vec4f>; // x, y, vx, vy; x < 0: gone
@group(0) @binding(6) var<storage, read_write> guess: array<vec2f>;
@group(0) @binding(7) var<storage, read_write> counts: array<atomic<u32>>;
@group(0) @binding(8) var<storage, read_write> start: array<u32>;
@group(0) @binding(9) var<storage, read_write> order: array<u32>;
@group(0) @binding(10) var<storage, read_write> fell: atomic<u32>;

fn hash_cell(p: vec2f) -> u32 {
  let c = clamp(vec2i(floor(p / HASH)), vec2i(0), vec2i(M.cells) - 1);
  return u32(c.y) * M.cells.x + u32(c.x);
}

@compute @workgroup_size(64)
fn clear(@builtin(global_invocation_id) id: vec3u) {
  if (id.x < M.cells.x * M.cells.y) {
    atomicStore(&counts[id.x], 0u);
  }
}

@compute @workgroup_size(64)
fn predict(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= M.count) {
    return;
  }
  let m = marble[i];
  if (m.x < 0.0) {
    return;
  }
  let v = (m.zw + M.gravity * M.dt) * 0.999;
  var p = m.xy + v * M.dt;
  let s = field(p);
  if (s.x < RADIUS) {
    p += s.yz * (RADIUS - s.x);
  }
  guess[i] = p;
  atomicAdd(&counts[hash_cell(p)], 1u);
}

var<workgroup> partial: array<u32, 256>;

// one workgroup: each thread sums a run of cells, the 256 totals are scanned, then each run is
// written out as starts — and the counts are reset, to be used as cursors by `scatter`
@compute @workgroup_size(256)
fn scan(@builtin(local_invocation_index) t: u32) {
  let total = M.cells.x * M.cells.y;
  let per = (total + 255u) / 256u;
  var mine = 0u;
  for (var k = 0u; k < per; k++) {
    let c = t * per + k;
    if (c < total) {
      mine += atomicLoad(&counts[c]);
    }
  }
  partial[t] = mine;
  workgroupBarrier();
  for (var off = 1u; off < 256u; off *= 2u) {
    var add = 0u;
    if (t >= off) {
      add = partial[t - off];
    }
    workgroupBarrier();
    partial[t] += add;
    workgroupBarrier();
  }
  var run = select(0u, partial[t - 1u], t > 0u);
  for (var k = 0u; k < per; k++) {
    let c = t * per + k;
    if (c < total) {
      start[c] = run;
      run += atomicLoad(&counts[c]);
      atomicStore(&counts[c], start[c]);
    }
  }
  if (t == 255u) {
    start[total] = partial[255];
  }
}

@compute @workgroup_size(64)
fn scatter(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= M.count || marble[i].x < 0.0) {
    return;
  }
  order[atomicAdd(&counts[hash_cell(guess[i])], 1u)] = i;
}

// each marble gathers half of every overlap from the marbles in the nine cells round it
@compute @workgroup_size(64)
fn settle(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= M.count) {
    return;
  }
  let m = marble[i];
  if (m.x < 0.0) {
    return;
  }
  let p = guess[i];
  let h = vec2i(floor(p / HASH));
  var push = vec2f(0.0);
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let q = h + vec2i(dx, dy);
      if (q.x < 0 || q.y < 0 || q.x >= i32(M.cells.x) || q.y >= i32(M.cells.y)) {
        continue;
      }
      let c = u32(q.y) * M.cells.x + u32(q.x);
      for (var k = start[c]; k < start[c + 1u]; k++) {
        let j = order[k];
        if (j == i) {
          continue;
        }
        let e = p - guess[j];
        let d = length(e);
        if (d < 2.0 * RADIUS && d > 1e-6) {
          push += e / d * (2.0 * RADIUS - d) * 0.5;
        }
      }
    }
  }
  // never pushed further than MAX_PUSH a step, nor faster than MAX_SPEED: no tunnelling
  let pl = length(push);
  if (pl > MAX_PUSH) {
    push *= MAX_PUSH / pl;
  }
  var n = p + push;
  // the neighbours may have pushed it into a wall: out again, last
  let s = field(n);
  if (s.x < RADIUS) {
    n += s.yz * (RADIUS - s.x);
  }
  // and whatever the crowd does — a board can be poured fuller than it holds — never off the board
  n = clamp(n, vec2f(1.0 + RADIUS), vec2f(M.board) - 1.0 - RADIUS);
  var vel = (n - m.xy) / M.dt;
  let sp = length(vel);
  if (sp > MAX_SPEED) {
    vel *= MAX_SPEED / sp;
  }
  var out = vec4f(n, vel);
  if (kind[cell_index(vec2i(floor(n)))] == HOLE) {
    out = vec4f(-1.0, -1.0, 0.0, 0.0);
    atomicAdd(&fell, 1u);
  }
  marble[i] = out;
}

// ---- drawing: its own read-only views of the board and the marbles

@group(0) @binding(11) var<storage, read> shown_marble: array<vec4f>;
@group(0) @binding(12) var<storage, read> shown_kind: array<u32>;
@group(0) @binding(13) var<storage, read> shown_dist: array<vec2f>;

fn shown_field(p: vec2f) -> vec3f {
  let f = p - 0.5;
  let c = vec2i(floor(f));
  let t = f - floor(f);
  let a = signed(shown_dist[cell_index(c)]);
  let b = signed(shown_dist[cell_index(c + vec2i(1, 0))]);
  let d = signed(shown_dist[cell_index(c + vec2i(0, 1))]);
  let e = signed(shown_dist[cell_index(c + vec2i(1, 1))]);
  let v = mix(mix(a, b, t.x), mix(d, e, t.x), t.y);
  let g = vec2f((b - a) * (1.0 - t.y) + (e - d) * t.y, (d - a) * (1.0 - t.x) + (e - b) * t.x);
  let l = length(g);
  return vec3f(v, select(vec2f(0.0), g / l, l > 1e-6));
}

struct Px {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn cover(@builtin(vertex_index) v: u32) -> Px {
  let p = vec2f(f32((v << 1u) & 2u), f32(v & 2u));
  var o: Px;
  o.clip = vec4f(p * 2.0 - 1.0, 0.0, 1.0);
  o.uv = vec2f(p.x, 1.0 - p.y);
  return o;
}

const LIGHT = vec3f(-0.45, -0.6, 0.66);

// the board: wood, with the walls raised and bevelled off the distance field, holes dark
@fragment
fn board(px: Px) -> @location(0) vec4f {
  let p = px.uv * vec2f(M.board);
  let s = shown_field(p);
  let grain = 0.5 + 0.5 * sin(p.x * 0.35 + sin(p.y * 0.07) * 4.0);
  var c = mix(vec3f(0.78, 0.62, 0.42), vec3f(0.7, 0.53, 0.35), grain);
  // a soft shadow at the foot of every wall
  c *= 0.7 + 0.3 * smoothstep(0.0, 3.0, s.x);
  if (s.x < 1.2) {
    // the wall's top, lit by its own slope
    let n = normalize(vec3f(-s.yz * (1.0 - smoothstep(0.0, 1.2, s.x)), 0.6));
    c = vec3f(0.42, 0.28, 0.18) * (0.55 + 0.6 * max(0.0, dot(n, normalize(LIGHT))));
  }
  // a hole's edge read between cells, so it is round rather than a staircase of them
  let f = p - 0.5;
  let c0 = vec2i(floor(f));
  let t = f - floor(f);
  let h00 = select(0.0, 1.0, shown_kind[cell_index(c0)] == HOLE);
  let h10 = select(0.0, 1.0, shown_kind[cell_index(c0 + vec2i(1, 0))] == HOLE);
  let h01 = select(0.0, 1.0, shown_kind[cell_index(c0 + vec2i(0, 1))] == HOLE);
  let h11 = select(0.0, 1.0, shown_kind[cell_index(c0 + vec2i(1, 1))] == HOLE);
  let hole = mix(mix(h00, h10, t.x), mix(h01, h11, t.x), t.y);
  c = mix(c, vec3f(0.05, 0.04, 0.03), smoothstep(0.3, 0.6, hole));
  return vec4f(c, 1.0);
}

struct Ball {
  @builtin(position) clip: vec4f,
  @location(0) at: vec2f,
  @location(1) @interpolate(flat) tint: u32,
}

@vertex
fn ball(@builtin(vertex_index) v: u32) -> Ball {
  let i = v / 6u;
  let corner = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));
  let c = corner[v % 6u];
  let m = shown_marble[i];
  var o: Ball;
  // a gone marble collapses to nothing
  let r = select(RADIUS, 0.0, m.x < 0.0);
  let p = (m.xy + c * r) / vec2f(M.board);
  o.clip = vec4f(p.x * 2.0 - 1.0, 1.0 - p.y * 2.0, 0.0, 1.0);
  o.at = c;
  o.tint = i % 5u;
  return o;
}

@fragment
fn shine(px: Ball) -> @location(0) vec4f {
  let d2 = dot(px.at, px.at);
  if (d2 > 1.0) {
    discard;
  }
  let n = vec3f(px.at.x, px.at.y, sqrt(1.0 - d2));
  let tints = array<vec3f, 5>(vec3f(0.85, 0.2, 0.25), vec3f(0.2, 0.45, 0.9), vec3f(0.95, 0.75, 0.2), vec3f(0.25, 0.75, 0.45), vec3f(0.9, 0.9, 0.95));
  let l = normalize(vec3f(-0.45, -0.6, 0.66));
  let diffuse = max(0.0, dot(n, l));
  let spec = pow(max(0.0, dot(reflect(-l, n), vec3f(0.0, 0.0, 1.0))), 40.0);
  let c = tints[px.tint] * (0.35 + 0.75 * diffuse) + vec3f(spec);
  return vec4f(c, 1.0);
}
