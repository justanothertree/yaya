// Waterworks: a FLIP fluid with heat. Each substep:
//   clear   — the grid's atomics to zero
//   p2g     — every water drop adds its velocity onto the four nearest u-faces and v-faces of a
//             staggered (MAC) grid, weighted, in fixed point with atomicAdd; and counts itself into
//             its cell. Ice counts into its cell as solid; steam is not part of the liquid at all.
//   faces   — weighted sums become velocities; a copy is kept (FLIP needs the change, not the
//             value); gravity; every face touching a solid is zero
//   diverge — each liquid cell's divergence
//   jacobi  — the pressure that cancels it, by Jacobi iterations, ping-ponged
//   project — each face loses the pressure's slope across it
//   g2p     — each drop takes back the CHANGE in the grid's velocity where it is (FLIP), a touch of
//             the grid's velocity itself (PIC) to stay calm, moves, stays out of solids, warms or
//             cools toward whatever heats it, and changes state if its temperature says so.
// Steam rises on its own in g2p; ice does not move. Then `tally` counts the water in the cup.

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
@group(0) @binding(1) var<storage, read_write> drops: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> uAcc: array<atomic<i32>>;
@group(0) @binding(3) var<storage, read_write> uW: array<atomic<i32>>;
@group(0) @binding(4) var<storage, read_write> vAcc: array<atomic<i32>>;
@group(0) @binding(5) var<storage, read_write> vW: array<atomic<i32>>;
@group(0) @binding(6) var<storage, read_write> cells: array<atomic<u32>>;
@group(0) @binding(7) var<storage, read> mask: array<u32>;
@group(1) @binding(0) var<storage, read_write> vel: array<f32>;
@group(1) @binding(1) var<storage, read_write> old: array<f32>;
@group(1) @binding(2) var<storage, read_write> pres: array<f32>;
@group(1) @binding(3) var<storage, read_write> pnext: array<f32>;
@group(1) @binding(4) var<storage, read_write> div: array<f32>;
@group(1) @binding(5) var<storage, read> heat: array<vec2f>;
@group(1) @binding(6) var<storage, read_write> tally: array<atomic<u32>>;

const SCALE = 65536.0;
const G = 120.0;
const WATER = 1.0;
const ICE = 2.0;
const STEAM = 3.0;
const FREEZE = -1.0;
const MELT = 2.0;
const BOIL = 100.0;
const CONDENSE = 92.0;
const ROOM = 20.0;

// the grid's sizes: u-faces (NX+1)×NY, v-faces NX×(NY+1); vel/old hold u then v
fn nx() -> u32 { return P.grid.x; }
fn ny() -> u32 { return P.grid.y; }
fn ui(i: u32, j: u32) -> u32 { return j * (nx() + 1u) + i; }
fn vi(i: u32, j: u32) -> u32 { return (nx() + 1u) * ny() + j * nx() + i; }
fn ci(i: u32, j: u32) -> u32 { return j * nx() + i; }

/** cells count what is in them, ten bits each: water from bit 0, ice from 10, steam from 20 */
const ICE_BIT = 10u;
const STEAM_BIT = 20u;
fn solid(i: i32, j: i32) -> bool {
  if (i < 0 || j < 0 || i >= i32(nx()) || j >= i32(ny())) {
    return true;
  }
  let c = ci(u32(i), u32(j));
  return mask[c] != 0u || ((atomicLoad(&cells[c]) >> ICE_BIT) & 1023u) > 0u;
}
fn water_in(i: i32, j: i32) -> f32 {
  if (i < 0 || j < 0 || i >= i32(nx()) || j >= i32(ny())) {
    return 0.0;
  }
  return f32(atomicLoad(&cells[ci(u32(i), u32(j))]) & 1023u);
}
fn steam_in(i: i32, j: i32) -> f32 {
  if (i < 0 || j < 0 || i >= i32(nx()) || j >= i32(ny())) {
    return 0.0;
  }
  return f32((atomicLoad(&cells[ci(u32(i), u32(j))]) >> STEAM_BIT) & 1023u);
}

@compute @workgroup_size(256)
fn clear(@builtin(global_invocation_id) id: vec3u) {
  let n = (nx() + 1u) * ny();
  let m = nx() * (ny() + 1u);
  if (id.x < n) {
    atomicStore(&uAcc[id.x], 0);
    atomicStore(&uW[id.x], 0);
  }
  if (id.x < m) {
    atomicStore(&vAcc[id.x], 0);
    atomicStore(&vW[id.x], 0);
  }
  if (id.x < nx() * ny()) {
    atomicStore(&cells[id.x], 0u);
  }
}

/** a staggered grid's four neighbours of a point, and their bilinear weights */
struct Splat {
  i: vec2i,
  f: vec2f,
}
fn splat_at(p: vec2f) -> Splat {
  var s: Splat;
  s.i = vec2i(floor(p));
  s.f = p - floor(p);
  return s;
}

fn add_u(i: i32, j: i32, w: f32, v: f32) {
  if (i < 0 || j < 0 || i > i32(nx()) || j >= i32(ny()) || w <= 0.0) {
    return;
  }
  let k = ui(u32(i), u32(j));
  atomicAdd(&uAcc[k], i32(round(w * v * SCALE / 64.0)));
  atomicAdd(&uW[k], i32(round(w * SCALE)));
}
fn add_v(i: i32, j: i32, w: f32, v: f32) {
  if (i < 0 || j < 0 || i >= i32(nx()) || j > i32(ny()) || w <= 0.0) {
    return;
  }
  // ⚠️ the accumulators hold v alone, from 0: vi() is the index into vel/old, where v follows u
  let k = u32(j) * nx() + u32(i);
  atomicAdd(&vAcc[k], i32(round(w * v * SCALE / 64.0)));
  atomicAdd(&vW[k], i32(round(w * SCALE)));
}

@compute @workgroup_size(64)
fn p2g(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= P.count) {
    return;
  }
  let a = drops[id.x * 2u];
  let b = drops[id.x * 2u + 1u];
  let cell = vec2i(floor(a.xy));
  if (cell.x < 0 || cell.y < 0 || cell.x >= i32(nx()) || cell.y >= i32(ny())) {
    return;
  }
  let c = ci(u32(cell.x), u32(cell.y));
  if (b.y == ICE) {
    atomicAdd(&cells[c], 1u << ICE_BIT);
    return;
  }
  if (b.y == STEAM) {
    atomicAdd(&cells[c], 1u << STEAM_BIT);
    return;
  }
  if (b.y != WATER) {
    return;
  }
  atomicAdd(&cells[c], 1u);
  // u lives at (i, j + 0.5), v at (i + 0.5, j)
  let su = splat_at(a.xy - vec2f(0.0, 0.5));
  let wu = array(
    (1.0 - su.f.x) * (1.0 - su.f.y), su.f.x * (1.0 - su.f.y), (1.0 - su.f.x) * su.f.y, su.f.x * su.f.y);
  add_u(su.i.x, su.i.y, wu[0], a.z);
  add_u(su.i.x + 1, su.i.y, wu[1], a.z);
  add_u(su.i.x, su.i.y + 1, wu[2], a.z);
  add_u(su.i.x + 1, su.i.y + 1, wu[3], a.z);
  let sv = splat_at(a.xy - vec2f(0.5, 0.0));
  let wv = array(
    (1.0 - sv.f.x) * (1.0 - sv.f.y), sv.f.x * (1.0 - sv.f.y), (1.0 - sv.f.x) * sv.f.y, sv.f.x * sv.f.y);
  add_v(sv.i.x, sv.i.y, wv[0], a.w);
  add_v(sv.i.x + 1, sv.i.y, wv[1], a.w);
  add_v(sv.i.x, sv.i.y + 1, wv[2], a.w);
  add_v(sv.i.x + 1, sv.i.y + 1, wv[3], a.w);
}

@compute @workgroup_size(256)
fn faces(@builtin(global_invocation_id) id: vec3u) {
  let n = (nx() + 1u) * ny();
  let m = nx() * (ny() + 1u);
  if (id.x < n) {
    let i = i32(id.x % (nx() + 1u));
    let j = i32(id.x / (nx() + 1u));
    let w = atomicLoad(&uW[id.x]);
    var u = 0.0;
    if (w > 0) {
      u = f32(atomicLoad(&uAcc[id.x])) * 64.0 / f32(w);
    }
    if (solid(i - 1, j) || solid(i, j)) {
      u = 0.0;
    }
    old[id.x] = u;
    vel[id.x] = u;
  }
  if (id.x < m) {
    let i = i32(id.x % nx());
    let j = i32(id.x / nx());
    let k = n + id.x;
    let w = atomicLoad(&vW[id.x]);
    var v = 0.0;
    if (w > 0) {
      v = f32(atomicLoad(&vAcc[id.x])) * 64.0 / f32(w);
    }
    old[k] = v;
    // gravity, down the screen, on every face the liquid has reached
    if (w > 0) {
      v += G * P.dt;
    }
    if (solid(i, j - 1) || solid(i, j)) {
      v = 0.0;
    }
    vel[k] = v;
  }
}

fn liquid(i: i32, j: i32) -> bool {
  return !solid(i, j) && water_in(i, j) > 0.0;
}

@compute @workgroup_size(16, 16)
fn diverge(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= nx() || id.y >= ny()) {
    return;
  }
  let i = id.x;
  let j = id.y;
  let c = ci(i, j);
  /* ⚠️ THE LAST STEP'S PRESSURE IS KEPT AS THIS STEP'S FIRST GUESS. Jacobi spreads a correction
     a cell a pass, so forty passes from zero never reach the bottom of a pool; measured on a still
     pool 24 cells deep, starting from zero each step let it sink to 17% of its volume in six
     seconds (2,736 wet cells to 468), and starting from the last answer kept it to within 2%
     (2,781) and level to half a cell. Water's pressure changes little in a 120th of a second.
     (A push apart for crowded cells, the usual FLIP volume fix, was tried too: with nothing to pull
     back it only ever pushed, and the same pool swelled 11%.) */
  if (!liquid(i32(i), i32(j))) {
    div[c] = 0.0;
    pres[c] = 0.0;
    return;
  }
  var d = vel[ui(i + 1u, j)] - vel[ui(i, j)] + vel[vi(i, j + 1u)] - vel[vi(i, j)];
  div[c] = d;
}

fn p_at(i: i32, j: i32) -> f32 {
  return pres[ci(u32(i), u32(j))];
}

@compute @workgroup_size(16, 16)
fn jacobi(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= nx() || id.y >= ny()) {
    return;
  }
  let i = i32(id.x);
  let j = i32(id.y);
  let c = ci(id.x, id.y);
  if (!liquid(i, j)) {
    pnext[c] = 0.0;
    return;
  }
  var sum = 0.0;
  var n = 0.0;
  for (var k = 0; k < 4; k++) {
    let o = array(vec2i(-1, 0), vec2i(1, 0), vec2i(0, -1), vec2i(0, 1))[k];
    if (!solid(i + o.x, j + o.y)) {
      n += 1.0;
      if (liquid(i + o.x, j + o.y)) {
        sum += p_at(i + o.x, j + o.y);
      }
    }
  }
  /* ⚠️ NEVER BELOW ZERO: water pushes and cannot pull. With suction allowed, water that condensed
     under the cold plate hung from the ceiling for good, held up by the pressure that kept its
     top cells from leaving the rock — a lid it could not let go of. */
  pnext[c] = max(0.0, select(0.0, (sum - div[c]) / n, n > 0.0));
}

/** the copy back after each pair of Jacobi passes: pres ← pnext */
@compute @workgroup_size(256)
fn swap(@builtin(global_invocation_id) id: vec3u) {
  if (id.x < nx() * ny()) {
    pres[id.x] = pnext[id.x];
  }
}

fn pressure(i: i32, j: i32) -> f32 {
  if (!liquid(i, j)) {
    return 0.0;
  }
  return p_at(i, j);
}

@compute @workgroup_size(256)
fn project(@builtin(global_invocation_id) id: vec3u) {
  let n = (nx() + 1u) * ny();
  let m = nx() * (ny() + 1u);
  if (id.x < n) {
    let i = i32(id.x % (nx() + 1u));
    let j = i32(id.x / (nx() + 1u));
    if (solid(i - 1, j) || solid(i, j)) {
      vel[id.x] = 0.0;
    } else if (liquid(i - 1, j) || liquid(i, j)) {
      vel[id.x] -= pressure(i, j) - pressure(i - 1, j);
    }
  }
  if (id.x < m) {
    let i = i32(id.x % nx());
    let j = i32(id.x / nx());
    let k = n + id.x;
    if (solid(i, j - 1) || solid(i, j)) {
      vel[k] = 0.0;
    } else if (liquid(i, j - 1) || liquid(i, j)) {
      vel[k] -= pressure(i, j) - pressure(i, j - 1);
    }
  }
}

/** the grid's u at a point, from `which` (vel or old) */
fn sample_u(p: vec2f, now: bool) -> f32 {
  let s = splat_at(p - vec2f(0.0, 0.5));
  let i = clamp(s.i, vec2i(0), vec2i(i32(nx()) - 1, i32(ny()) - 2));
  let f = clamp(p - vec2f(0.0, 0.5) - vec2f(i), vec2f(0), vec2f(1));
  let a = ui(u32(i.x), u32(i.y));
  let b = ui(u32(i.x + 1), u32(i.y));
  let c = ui(u32(i.x), u32(i.y + 1));
  let d = ui(u32(i.x + 1), u32(i.y + 1));
  if (now) {
    return mix(mix(vel[a], vel[b], f.x), mix(vel[c], vel[d], f.x), f.y);
  }
  return mix(mix(old[a], old[b], f.x), mix(old[c], old[d], f.x), f.y);
}
fn sample_v(p: vec2f, now: bool) -> f32 {
  let i = clamp(vec2i(floor(p - vec2f(0.5, 0.0))), vec2i(0), vec2i(i32(nx()) - 2, i32(ny()) - 1));
  let f = clamp(p - vec2f(0.5, 0.0) - vec2f(i), vec2f(0), vec2f(1));
  let a = vi(u32(i.x), u32(i.y));
  let b = vi(u32(i.x + 1), u32(i.y));
  let c = vi(u32(i.x), u32(i.y + 1));
  let d = vi(u32(i.x + 1), u32(i.y + 1));
  if (now) {
    return mix(mix(vel[a], vel[b], f.x), mix(vel[c], vel[d], f.x), f.y);
  }
  return mix(mix(old[a], old[b], f.x), mix(old[c], old[d], f.x), f.y);
}

fn blocked(p: vec2f) -> bool {
  let c = vec2i(floor(p));
  if (c.x < 0 || c.y < 0 || c.x >= i32(nx()) || c.y >= i32(ny())) {
    return true;
  }
  return mask[ci(u32(c.x), u32(c.y))] != 0u;
}

fn hash(n: u32) -> f32 {
  var h = n * 747796405u + 2891336453u;
  h = ((h >> ((h >> 28u) + 4u)) ^ h) * 277803737u;
  return f32((h >> 22u) ^ h) / 4294967295.0;
}

/** a drop's temperature after dt near a source: warm() in waterworks.ts */
fn warm(t: f32, aim: f32, strength: f32) -> f32 {
  let toRoom = 0.05;
  let k = strength + toRoom;
  let goal = (aim * strength + ROOM * toRoom) / k;
  return goal + (t - goal) * exp(-k * P.dt);
}

/** a drop's next state: phase() in waterworks.ts */
fn phase(state: f32, t: f32) -> f32 {
  if (state == WATER) {
    if (t < FREEZE) {
      return ICE;
    }
    if (t > BOIL) {
      return STEAM;
    }
  } else if (state == ICE) {
    if (t > MELT) {
      return WATER;
    }
  } else if (state == STEAM) {
    if (t < CONDENSE) {
      return WATER;
    }
  }
  return state;
}

/** a move from p by d that stops at solids, an axis at a time, zeroing the speed that was stopped */
struct Move {
  p: vec2f,
  v: vec2f,
}
fn move_by(p: vec2f, v: vec2f, d: vec2f) -> Move {
  var m: Move;
  m.p = p;
  m.v = v;
  let px = vec2f(p.x + d.x, p.y);
  if (blocked(px)) {
    m.v.x = 0.0;
  } else {
    m.p = px;
  }
  let py = vec2f(m.p.x, m.p.y + d.y);
  if (blocked(py)) {
    m.v.y = 0.0;
  } else {
    m.p = py;
  }
  return m;
}

@compute @workgroup_size(64)
fn g2p(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= P.count) {
    return;
  }
  var a = drops[id.x * 2u];
  var b = drops[id.x * 2u + 1u];
  if (b.y == 0.0) {
    return;
  }
  // heat: the level's plates where the drop is, and the finger's lamp or ice pack
  let cell = clamp(vec2i(floor(a.xy)), vec2i(0), vec2i(P.grid) - 1);
  var h = heat[ci(u32(cell.x), u32(cell.y))];
  if (P.tool != 0u && distance(a.xy, P.toolAt) < P.toolR) {
    h = vec2f(select(-40.0, 160.0, P.tool == 1u), 4.0);
  }
  // heatStep() in waterworks.ts: steam with nothing near it keeps its heat — a game rule, see there
  if (b.y != STEAM || h.y > 0.0) {
    b.x = warm(b.x, h.x, h.y);
  }
  if (b.y == WATER) {
    let now = vec2f(sample_u(a.xy, true), sample_v(a.xy, true));
    let before = vec2f(sample_u(a.xy, false), sample_v(a.xy, false));
    let v = mix(now, a.zw + now - before, P.flip);
    let m = move_by(a.xy, v, v * P.dt);
    a = vec4f(m.p, m.v);
  } else if (b.y == STEAM) {
    /* steam rises, slowed by the air, wanders — and SPREADS: it is pushed from where there is more
       of it to where there is less, as a gas fills a room. ⚠️ Without the push it rose in a column,
       pooled under the ceiling over the kettle, and never crossed the wall to the cold plate:
       measured, 1,300 frames of boiling and not a drop in the cup */
    let r = vec2f(hash(id.x * 2u + u32(P.time * 977.0)), hash(id.x * 2u + 1u + u32(P.time * 977.0))) - 0.5;
    let crowd = vec2f(steam_in(cell.x + 1, cell.y) - steam_in(cell.x - 1, cell.y),
                      steam_in(cell.x, cell.y + 1) - steam_in(cell.x, cell.y - 1));
    var v = a.zw * exp(-2.0 * P.dt) + (vec2f(0.0, -40.0) + r * 160.0 - crowd * 150.0) * P.dt;
    let m = move_by(a.xy, v, v * P.dt);
    a = vec4f(m.p, m.v);
  } else {
    a = vec4f(a.xy, 0.0, 0.0);
  }
  let next = phase(b.y, b.x);
  if (next != b.y) {
    // a new state starts still: ice and condensed water from rest, steam with a little lift
    a = vec4f(a.xy, 0.0, select(0.0, -5.0, next == STEAM));
  }
  b.y = next;
  drops[id.x * 2u] = a;
  drops[id.x * 2u + 1u] = b;
}

@compute @workgroup_size(64)
fn count_cup(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= P.count) {
    return;
  }
  let a = drops[id.x * 2u];
  let b = drops[id.x * 2u + 1u];
  let c = P.cup;
  if (b.y == WATER && a.x >= c.x && a.x < c.x + c.z && a.y >= c.y && a.y < c.y + c.w) {
    atomicAdd(&tally[0], 1u);
  }
}
