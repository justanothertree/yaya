// Gust: the air of an air-hockey rink, as a stable-fluids solver, and the puck it carries. Each
// frame: `force` — each blowing fan pushes the air near it toward the puck and colours it with its
// player's dye; `advect` — the air carries itself and the dye; `walls` — no air through the walls
// (except at the goal mouths), none through the bumpers, and the air inside the puck moves with it;
// `diverge`, `red`/`black` (Gauss-Seidel, warm-started) and `project` make the air incompressible; `puck` — one thread
// feels the air round the puck and steps it (stepPuck in gust.ts, line for line); `show` draws it.

struct Rink {
  size: vec2u,
  grid: vec2u,
  fan0: vec4f,
  fan1: vec4f,
  dt: f32,
  time: f32,
  pause: u32,
}

@group(0) @binding(0) var<uniform> P: Rink;
@group(0) @binding(1) var<storage, read_write> vel: array<vec2f>;
@group(0) @binding(2) var<storage, read_write> velNext: array<vec2f>;
@group(0) @binding(3) var<storage, read_write> dye: array<vec2f>;
@group(0) @binding(4) var<storage, read_write> dyeNext: array<vec2f>;
@group(0) @binding(5) var<storage, read_write> pres: array<f32>;
@group(0) @binding(6) var<storage, read_write> div: array<f32>;
@group(0) @binding(7) var<storage, read_write> puck: array<vec4f>;

const PUCK_R = 4.0;
const DRAG = 6.5;
const BOUNCE = 0.82;
const GOAL = 14.0;
const FAN_R = 6.0;
const JET = 20.0;
const FAN_PUSH = 850.0;
const SLOPE = 8.0;
const TIP = 40.0;
const BUMPERS = array(vec3f(56, 28, 5), vec3f(56, 62, 5), vec3f(104, 28, 5), vec3f(104, 62, 5));

fn W() -> i32 { return i32(P.grid.x); }
fn H() -> i32 { return i32(P.grid.y); }
fn idx(c: vec2i) -> u32 { return u32(c.y * W() + c.x); }
fn inside(c: vec2i) -> bool { return c.x >= 0 && c.y >= 0 && c.x < W() && c.y < H(); }

fn in_bumper(p: vec2f) -> bool {
  for (var k = 0; k < 4; k++) {
    let b = BUMPERS[k];
    if (distance(p, b.xy) < b.z) {
      return true;
    }
  }
  return false;
}

fn fan(k: u32) -> vec4f {
  return select(P.fan0, P.fan1, k == 1u);
}

@compute @workgroup_size(16, 16)
fn force(@builtin(global_invocation_id) id: vec3u) {
  let c = vec2i(id.xy);
  if (!inside(c)) {
    return;
  }
  let i = idx(c);
  let p = vec2f(c) + 0.5;
  let pk = puck[0];
  var v = vel[i];
  var d = dye[i] * 0.994;
  for (var k = 0u; k < 2u; k++) {
    let f = fan(k);
    if (f.z < 0.5) {
      continue;
    }
    // a jet: FAN_R wide across, fading over JET cells along, starting just behind the fan
    let to = pk.xy - f.xy;
    let dir = to / max(length(to), 1e-3);
    let along = dot(p - f.xy, dir);
    let across = length(p - f.xy - dir * along);
    if (along < -2.0) {
      continue;
    }
    let fall = exp(-across * across / (FAN_R * FAN_R)) * exp(-max(along, 0.0) / JET);
    v += dir * FAN_PUSH * fall * P.dt;
    if (k == 0u) {
      d.x += fall * 3.0 * P.dt;
    } else {
      d.y += fall * 3.0 * P.dt;
    }
  }
  vel[i] = v;
  dye[i] = d;
}

fn sample_vel(p: vec2f) -> vec2f {
  let q = clamp(p - 0.5, vec2f(0), vec2f(f32(W() - 1), f32(H() - 1)));
  let c = vec2i(floor(q));
  let f = q - floor(q);
  let c1 = min(c + 1, vec2i(W() - 1, H() - 1));
  let a = mix(vel[idx(c)], vel[idx(vec2i(c1.x, c.y))], f.x);
  let b = mix(vel[idx(vec2i(c.x, c1.y))], vel[idx(c1)], f.x);
  return mix(a, b, f.y);
}
fn sample_dye(p: vec2f) -> vec2f {
  let q = clamp(p - 0.5, vec2f(0), vec2f(f32(W() - 1), f32(H() - 1)));
  let c = vec2i(floor(q));
  let f = q - floor(q);
  let c1 = min(c + 1, vec2i(W() - 1, H() - 1));
  let a = mix(dye[idx(c)], dye[idx(vec2i(c1.x, c.y))], f.x);
  let b = mix(dye[idx(vec2i(c.x, c1.y))], dye[idx(c1)], f.x);
  return mix(a, b, f.y);
}

@compute @workgroup_size(16, 16)
fn advect(@builtin(global_invocation_id) id: vec3u) {
  let c = vec2i(id.xy);
  if (!inside(c)) {
    return;
  }
  let p = vec2f(c) + 0.5;
  let back = p - vel[idx(c)] * P.dt;
  velNext[idx(c)] = sample_vel(back) * 0.998;
  dyeNext[idx(c)] = sample_dye(back);
}

/** the walls: no air into them but at the goal mouths, none in the bumpers, the puck's own inside */
@compute @workgroup_size(16, 16)
fn walls(@builtin(global_invocation_id) id: vec3u) {
  let c = vec2i(id.xy);
  if (!inside(c)) {
    return;
  }
  let i = idx(c);
  let p = vec2f(c) + 0.5;
  var v = velNext[i];
  let mouth = abs(p.y - f32(H()) * 0.5) < GOAL;
  if ((c.x == 0 && v.x < 0.0 && !mouth) || (c.x == W() - 1 && v.x > 0.0 && !mouth)) {
    v.x = 0.0;
  }
  if ((c.y == 0 && v.y < 0.0) || (c.y == H() - 1 && v.y > 0.0)) {
    v.y = 0.0;
  }
  if (in_bumper(p)) {
    v = vec2f(0);
  }
  let pk = puck[0];
  if (distance(p, pk.xy) < PUCK_R) {
    v = pk.zw;
  }
  vel[i] = v;
  dye[i] = dyeNext[i];
}

fn solid(c: vec2i) -> bool {
  return !inside(c) || in_bumper(vec2f(c) + 0.5);
}
fn vel_at(c: vec2i) -> vec2f {
  if (solid(c)) {
    return vec2f(0);
  }
  return vel[idx(c)];
}

@compute @workgroup_size(16, 16)
fn diverge(@builtin(global_invocation_id) id: vec3u) {
  let c = vec2i(id.xy);
  if (!inside(c)) {
    return;
  }
  div[idx(c)] = 0.5 * (vel_at(c + vec2i(1, 0)).x - vel_at(c - vec2i(1, 0)).x + vel_at(c + vec2i(0, 1)).y - vel_at(c - vec2i(0, 1)).y);
}

fn p_at(c: vec2i, here: f32) -> f32 {
  // a solid neighbour reflects this cell's own pressure (no flow through it); the open goal mouth
  // beyond an end wall is the outside, at zero
  if (!inside(c)) {
    let mouth = abs(f32(c.y) + 0.5 - f32(H()) * 0.5) < GOAL;
    if ((c.x < 0 || c.x >= W()) && mouth) {
      return 0.0;
    }
    return here;
  }
  if (in_bumper(vec2f(c) + 0.5)) {
    return here;
  }
  return pres[idx(c)];
}

/** Gauss-Seidel in red-black halves: a red cell reads only black neighbours, so a half is safe in place */
fn relax(c: vec2i, parity: i32) {
  if (!inside(c) || ((c.x + c.y) & 1) != parity) {
    return;
  }
  let here = pres[idx(c)];
  let s = p_at(c + vec2i(1, 0), here) + p_at(c - vec2i(1, 0), here) + p_at(c + vec2i(0, 1), here) + p_at(c - vec2i(0, 1), here);
  pres[idx(c)] = (s - div[idx(c)]) * 0.25;
}
@compute @workgroup_size(16, 16)
fn red(@builtin(global_invocation_id) id: vec3u) {
  relax(vec2i(id.xy), 0);
}
@compute @workgroup_size(16, 16)
fn black(@builtin(global_invocation_id) id: vec3u) {
  relax(vec2i(id.xy), 1);
}

@compute @workgroup_size(16, 16)
fn project(@builtin(global_invocation_id) id: vec3u) {
  let c = vec2i(id.xy);
  if (!inside(c) || solid(c)) {
    return;
  }
  let here = pres[idx(c)];
  let g = 0.5 * vec2f(p_at(c + vec2i(1, 0), here) - p_at(c - vec2i(1, 0), here), p_at(c + vec2i(0, 1), here) - p_at(c - vec2i(0, 1), here));
  vel[idx(c)] -= g;
}

/** the puck: the air round it (a ring just outside it), its drag, its move, its walls and bumpers */
@compute @workgroup_size(1)
fn step_puck() {
  var pk = puck[0];
  var state = puck[1];
  if (P.pause == 1u || state.x != 0.0) {
    return;
  }
  var air = vec2f(0);
  var n = 0.0;
  for (var dy = -7; dy <= 7; dy++) {
    for (var dx = -7; dx <= 7; dx++) {
      let c = vec2i(floor(pk.xy)) + vec2i(dx, dy);
      let d = distance(vec2f(c) + 0.5, pk.xy);
      if (inside(c) && d >= PUCK_R && d < PUCK_R + 3.0 && !in_bumper(vec2f(c) + 0.5)) {
        air += vel[idx(c)];
        n += 1.0;
      }
    }
  }
  if (n > 0.0) {
    air /= n;
  }
  let k = 1.0 - exp(-DRAG * P.dt);
  pk = vec4f(pk.xy, pk.zw + (air - pk.zw) * k);
  if (abs(pk.y - f32(H()) * 0.5) < GOAL - PUCK_R * 0.5) {
    if (pk.x < SLOPE) {
      pk.z -= TIP * P.dt;
    }
    if (pk.x > f32(W()) - SLOPE) {
      pk.z += TIP * P.dt;
    }
  }
  pk = vec4f(pk.xy + pk.zw * P.dt, pk.zw);
  let w = f32(W());
  let h = f32(H());
  let mouth = abs(pk.y - h * 0.5) < GOAL - PUCK_R * 0.5;
  if (pk.x < PUCK_R && !mouth) {
    pk.x = PUCK_R;
    pk.z = abs(pk.z) * BOUNCE;
  }
  if (pk.x > w - PUCK_R && !mouth) {
    pk.x = w - PUCK_R;
    pk.z = -abs(pk.z) * BOUNCE;
  }
  if (pk.y < PUCK_R) {
    pk.y = PUCK_R;
    pk.w = abs(pk.w) * BOUNCE;
  }
  if (pk.y > h - PUCK_R) {
    pk.y = h - PUCK_R;
    pk.w = -abs(pk.w) * BOUNCE;
  }
  for (var b = 0; b < 4; b++) {
    let bp = BUMPERS[b];
    let dd = pk.xy - bp.xy;
    let d = length(dd);
    let lo = bp.z + PUCK_R;
    if (d < lo && d > 1e-9) {
      let nn = dd / d;
      pk = vec4f(bp.xy + nn * lo, pk.zw);
      let vn = dot(pk.zw, nn);
      if (vn < 0.0) {
        pk = vec4f(pk.xy, pk.zw - (1.0 + BOUNCE) * vn * nn);
      }
    }
  }
  // past a goal line: stop, and say which goal (1 the left, 2 the right) for the CPU to score
  if (pk.x < -PUCK_R) {
    state.x = 1.0;
    pk = vec4f(pk.xy, 0.0, 0.0);
  } else if (pk.x > w + PUCK_R) {
    state.x = 2.0;
    pk = vec4f(pk.xy, 0.0, 0.0);
  }
  state.y = air.x;
  state.z = air.y;
  puck[0] = pk;
  puck[1] = state;
}

// ---------------------------------------------------------------- drawing

@group(1) @binding(0) var<storage, read> seen: array<vec2f>;
@group(1) @binding(1) var<storage, read> airSeen: array<vec2f>;
@group(1) @binding(2) var<storage, read> puckSeen: array<vec4f>;

@vertex
fn cover(@builtin(vertex_index) v: u32) -> @builtin(position) vec4f {
  let p = array(vec2f(-1, -3), vec2f(3, 1), vec2f(-1, 1))[v];
  return vec4f(p, 0, 1);
}

/**
 * where a pixel is on the rink, and how many cells a pixel is: the rink and a margin for the goals,
 * as big as fits — turned upright on a tall stage, Blue's goal at the bottom (rinkFit in gust.ts)
 */
fn to_rink(pos: vec2f) -> vec3f {
  let size = vec2f(P.size);
  let w = f32(W());
  let h = f32(H());
  if (size.y > size.x) {
    let s = min(size.x / (h + 6.0), size.y / (w + 12.0));
    let o = (size - vec2f(h, w) * s) * 0.5;
    return vec3f(w - (pos.y - o.y) / s, (pos.x - o.x) / s, 1.0 / s);
  }
  let s = min(size.x / (w + 12.0), size.y / (h + 6.0));
  let o = (size - vec2f(w, h) * s) * 0.5;
  return vec3f((pos - o) / s, 1.0 / s);
}

fn ring(p: vec2f, c: vec2f, r: f32, w: f32) -> f32 {
  return smoothstep(w, 0.0, abs(distance(p, c) - r));
}

@fragment
fn show(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let r = to_rink(pos.xy);
  let q = r.xy;
  let px = r.z;
  let w = f32(W());
  let h = f32(H());
  var col = vec3f(0.1, 0.11, 0.15);
  let mouth = abs(q.y - h * 0.5) < GOAL;
  // the goals behind the end walls, in their defenders' colours
  if (mouth && q.x < 0.0 && q.x > -5.0) {
    col = vec3f(0.2, 0.45, 0.9);
  }
  if (mouth && q.x > w && q.x < w + 5.0) {
    col = vec3f(0.95, 0.5, 0.15);
  }
  if (q.x >= 0.0 && q.y >= 0.0 && q.x < w && q.y < h) {
    let c = vec2i(floor(q));
    let d = seen[idx(c)];
    let a = airSeen[idx(c)];
    // the ice, the dye each side has blown, and a faint shimmer where the air is fast
    col = vec3f(0.9, 0.94, 0.98);
    col = mix(col, vec3f(0.2, 0.45, 0.95), clamp(d.x * 0.8, 0.0, 0.85));
    col = mix(col, vec3f(0.98, 0.5, 0.12), clamp(d.y * 0.8, 0.0, 0.85));
    col *= 1.0 - clamp(length(a) / 400.0, 0.0, 0.15);
    // the centre line and circle
    col = mix(col, vec3f(0.85, 0.3, 0.35), smoothstep(px * 1.2, 0.0, abs(q.x - w * 0.5)) * 0.6);
    col = mix(col, vec3f(0.85, 0.3, 0.35), ring(q, vec2f(w, h) * 0.5, 12.0, px * 1.2) * 0.6);
  }
  for (var k = 0; k < 4; k++) {
    let b = BUMPERS[k];
    let d = distance(q, b.xy);
    col = mix(col, vec3f(0.2, 0.22, 0.28), smoothstep(px, -px, d - b.z));
    col = mix(col, vec3f(0.5, 0.55, 0.65), ring(q, b.xy, b.z - 0.6, px * 1.2));
  }
  // the fans: a ring, a breath arc, a glow while blowing
  for (var k = 0u; k < 2u; k++) {
    let fn_ = fan(k);
    let tint = select(vec3f(0.15, 0.35, 0.9), vec3f(0.95, 0.45, 0.1), k == 1u);
    let d = distance(q, fn_.xy);
    if (fn_.z > 0.5) {
      col = mix(col, tint, smoothstep(FAN_R, 0.0, d) * 0.35);
    }
    col = mix(col, tint, ring(q, fn_.xy, 3.0, px * 2.0));
    let ang = atan2(q.y - fn_.y, q.x - fn_.x) / 6.2832 + 0.5;
    if (abs(d - 4.4) < 0.6 && ang < fn_.w) {
      col = mix(col, tint * 0.7, 0.9);
    }
  }
  // the puck, with a shadow
  let pk = puckSeen[0];
  let d = distance(q, pk.xy);
  col = mix(col, col * 0.7, smoothstep(PUCK_R + 1.2, PUCK_R, distance(q, pk.xy + vec2f(0.6, 0.8))));
  col = mix(col, vec3f(0.12, 0.12, 0.14), smoothstep(px, -px, d - PUCK_R));
  col = mix(col, vec3f(0.85), ring(q, pk.xy, PUCK_R * 0.6, px * 1.2));
  return vec4f(col, 1);
}
