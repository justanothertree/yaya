// Lightning by dielectric breakdown: the field relaxed, a cell chosen by an exponential race, the
// channel grown into it, and the path to the ground lit when it arrives. See lightning.ts.
//
// ⚠️ `Bolt` IS PACKED BY HAND IN lightning.ts (`BOLT`); lightning.test.ts lays it out from here.

struct Bolt {
  size: vec2u, // the canvas, in pixels
  grid: vec2u, // cells across and down
  eta: f32, // how strongly the field decides: 1 wild, larger straighter
  step: u32, // the frame's step, for the drawing's flicker
  flash: f32, // 0..1: the return stroke
  fade: f32, // 0..1: how much of the last bolt still glows
  rods: u32, // how many lightning rods
}

@group(0) @binding(0) var<uniform> B: Bolt;

const AIR = 0u;
const CHANNEL = 1u;
const GROUND = 2u;
const ROD = 3u;
// a channel cell on the path the return stroke took
const PATH = 16u;
const NONE = 0xffffffffu;

fn hash(a0: u32, b0: u32) -> f32 {
  var x = a0 * 747796405u + b0 * 2891336453u;
  x = ((x >> ((x >> 28u) + 4u)) ^ x) * 277803737u;
  x = (x >> 22u) ^ x;
  return f32(x) / 4294967295.0;
}

@group(0) @binding(1) var<storage, read> phi_in: array<f32>;
@group(0) @binding(2) var<storage, read_write> phi_out: array<f32>;
@group(0) @binding(3) var<storage, read_write> kind: array<u32>; // low 4 bits: what; PATH; order << 8
@group(0) @binding(4) var<storage, read_write> parent: array<i32>;
// [0] earliest time's bits, [1] the winner, [2] arrived (cell + 1), [3] steps taken
@group(0) @binding(5) var<storage, read_write> race: array<atomic<u32>, 4>;

fn what(i: u32) -> u32 {
  return kind[i] & 15u;
}

fn index(c: vec2i) -> u32 {
  let g = vec2i(B.grid);
  let q = clamp(c, vec2i(0), g - 1);
  return u32(q.y * g.x + q.x);
}

fn inside(c: vec2i) -> bool {
  return c.x >= 0 && c.y >= 0 && c.x < i32(B.grid.x) && c.y < i32(B.grid.y);
}

// lightning.ts `relax`: the air to its four neighbours' mean, the sides reflecting
@compute @workgroup_size(8, 8)
fn relax(@builtin(global_invocation_id) id: vec3u) {
  let c = vec2i(id.xy);
  if (!inside(c)) {
    return;
  }
  let i = index(c);
  let k = what(i);
  if (k != AIR) {
    phi_out[i] = select(1.0, 0.0, k == CHANNEL);
    return;
  }
  let l = phi_in[index(c + vec2i(-1, 0))];
  let r = phi_in[index(c + vec2i(1, 0))];
  let u = phi_in[index(c + vec2i(0, -1))];
  let d = phi_in[index(c + vec2i(0, 1))];
  phi_out[i] = (l + r + u + d) * 0.25;
}

const NB8 = array<vec2i, 8>(vec2i(-1, -1), vec2i(0, -1), vec2i(1, -1), vec2i(-1, 0), vec2i(1, 0), vec2i(-1, 1), vec2i(0, 1), vec2i(1, 1));

fn candidate(c: vec2i) -> bool {
  if (what(index(c)) != AIR) {
    return false;
  }
  for (var k = 0; k < 8; k++) {
    let n = c + NB8[k];
    if (inside(n) && what(index(n)) == CHANNEL) {
      return true;
    }
  }
  return false;
}

// lightning.ts `raceTime`: −ln(u)/φ^η; a positive float, so its bits sort as it does
fn race_time(i: u32, step: u32) -> f32 {
  let w = pow(max(phi_out[i], 0.0), B.eta);
  if (w <= 0.0) {
    return 3.0e38;
  }
  let u = hash(i, step);
  return -log(max(u, 1e-12)) / w;
}

@compute @workgroup_size(8, 8)
fn enter(@builtin(global_invocation_id) id: vec3u) {
  let c = vec2i(id.xy);
  if (!inside(c) || atomicLoad(&race[2]) != 0u || !candidate(c)) {
    return;
  }
  let i = index(c);
  atomicMin(&race[0], bitcast<u32>(race_time(i, atomicLoad(&race[3]))));
}

// whoever ran the earliest time claims the win; a tie goes to the lower cell
@compute @workgroup_size(8, 8)
fn claim(@builtin(global_invocation_id) id: vec3u) {
  let c = vec2i(id.xy);
  if (!inside(c) || atomicLoad(&race[2]) != 0u || !candidate(c)) {
    return;
  }
  let i = index(c);
  if (bitcast<u32>(race_time(i, atomicLoad(&race[3]))) == atomicLoad(&race[0])) {
    atomicMin(&race[1], i);
  }
}

// one thread: the winner breaks down, remembers which channel it grew from, and if it has reached
// the ground the path back to the cloud is marked
@compute @workgroup_size(1)
fn grow() {
  let i = atomicLoad(&race[1]);
  let step = atomicLoad(&race[3]);
  atomicStore(&race[0], NONE);
  atomicStore(&race[1], NONE);
  if (i == NONE || atomicLoad(&race[2]) != 0u) {
    return;
  }
  atomicStore(&race[3], step + 1u);
  let c = vec2i(i32(i % B.grid.x), i32(i / B.grid.x));
  var grew_from = -1;
  var arrived = false;
  for (var k = 0; k < 8; k++) {
    let n = c + NB8[k];
    if (!inside(n)) {
      continue;
    }
    let w = what(index(n));
    if (w == CHANNEL && grew_from < 0) {
      grew_from = i32(index(n));
    }
    if (w == GROUND || w == ROD) {
      arrived = true;
    }
  }
  kind[i] = CHANNEL | ((step + 1u) << 8u);
  parent[i] = grew_from;
  if (arrived) {
    atomicStore(&race[2], i + 1u);
    var at = i32(i);
    for (var n = 0u; n < B.grid.x * B.grid.y && at >= 0; n++) {
      kind[at] = kind[at] | PATH;
      at = parent[at];
    }
  }
}

// ---- drawing

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

@group(0) @binding(6) var<storage, read> shown: array<u32>;
@group(0) @binding(7) var<storage, read> steps_taken: array<u32, 4>;

// how bright one cell of channel is: the path blazes in the flash, the newest leader cells glow,
// the rest dims as the bolt fades
fn light_of(i: u32) -> f32 {
  let k = shown[i];
  if ((k & 15u) != CHANNEL) {
    return 0.0;
  }
  let age = f32(steps_taken[3]) - f32(k >> 8u);
  let tip = exp(-age / 30.0);
  let base = (0.25 + 0.75 * tip) * B.fade;
  if ((k & PATH) != 0u) {
    return max(base, B.flash * 2.2 + 0.4 * B.fade);
  }
  return base;
}

@fragment
fn show(px: Px) -> @location(0) vec4f {
  let g = vec2f(B.grid);
  let p = px.uv * g;
  let c = vec2i(floor(p));
  // a glow: the channel blurred over a few cells, plus the cell itself sharp
  var glow = 0.0;
  for (var dy = -2; dy <= 2; dy++) {
    for (var dx = -2; dx <= 2; dx++) {
      let n = c + vec2i(dx, dy);
      if (!inside(n)) {
        continue;
      }
      let d = length(vec2f(n) + 0.5 - p);
      glow += light_of(index(n)) * exp(-d * d * 0.9);
    }
  }
  let core = light_of(index(c));
  // the night: a cloud bank above, lit from inside by the flash, and dark land below
  let y = px.uv.y;
  var sky = mix(vec3f(0.06, 0.05, 0.12), vec3f(0.02, 0.02, 0.05), y);
  // the cloud's texture: smooth noise, read between lattice points
  let q = vec2f(p.x * 0.12, p.y * 0.3);
  let q0 = floor(q);
  let qf = q - q0;
  let s = qf * qf * (3.0 - 2.0 * qf);
  let n00 = hash(u32(q0.x), u32(q0.y));
  let n10 = hash(u32(q0.x) + 1u, u32(q0.y));
  let n01 = hash(u32(q0.x), u32(q0.y) + 1u);
  let n11 = hash(u32(q0.x) + 1u, u32(q0.y) + 1u);
  let noise = mix(mix(n00, n10, s.x), mix(n01, n11, s.x), s.y);
  let cloud = smoothstep(0.22, 0.0, y) * (0.45 + 0.55 * noise);
  sky += vec3f(0.25, 0.25, 0.35) * cloud * (0.15 + 1.6 * B.flash);
  sky += vec3f(0.35, 0.35, 0.5) * B.flash * 0.25;
  let k = shown[index(c)] & 15u;
  if (k == GROUND) {
    sky = vec3f(0.02, 0.025, 0.02) + vec3f(0.2, 0.22, 0.3) * B.flash;
  }
  if (k == ROD) {
    sky = vec3f(0.55, 0.55, 0.6);
  }
  let bolt = vec3f(0.55, 0.65, 1.0) * glow * 0.45 + vec3f(0.95, 0.95, 1.0) * core;
  return vec4f(1.0 - exp(-(sky + bolt) * 1.4), 1.0);
}
