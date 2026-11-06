// The water and the ground, one compute pass per step of erosion.ts: flux, water, erode, settle —
// plus paint (rain, and the finger) before them and pick (where the finger meets the land) before
// that. Joined after erosion-types.wgsl.

@group(0) @binding(1) var<storage, read_write> a: array<vec4f>; // this step's cells: b, d, s, b0
@group(0) @binding(2) var<storage, read_write> o: array<vec4f>; // the other half of the pair
@group(0) @binding(3) var<storage, read_write> flux: array<vec4f>; // left, right, up, down
@group(0) @binding(4) var<storage, read_write> vel: array<vec2f>;
@group(0) @binding(5) var<storage, read_write> hit: vec4f; // x, y (cells), 1 if the ray found land

// mirrored in erosion.ts
const G = 9.81;
const KC = 0.12;
const KS = 0.3;
const KD = 0.4;
const KE = 0.03;
const MIN_TILT = 0.05;
const DEPTH_CAP = 0.6;
const TALUS = 1.4;
const KT = 4.0;
const FRICTION = 0.6;
const RAIN = 0.04;

fn hash(a0: u32, b0: u32) -> f32 {
  var x = a0 * 747796405u + b0 * 2891336453u;
  x = ((x >> ((x >> 28u) + 4u)) ^ x) * 277803737u;
  x = (x >> 22u) ^ x;
  return f32(x) / 4294967295.0;
}

fn cell(id: vec3u) -> vec2i {
  return vec2i(id.xy);
}

fn inside(p: vec2i) -> bool {
  return p.x >= 0 && p.y >= 0 && p.x < i32(L.n) && p.y < i32(L.n);
}

// where the finger's ray first meets the land or water: one thread walks it across the heights
@compute @workgroup_size(1)
fn pick() {
  hit = vec4f(0.0);
  if (L.tool == 0u) {
    return;
  }
  let half = f32(L.n) * 0.5;
  var t = 0.0;
  var last = 0.0;
  for (var k = 0; k < 4000; k++) {
    let p = L.ray_o + L.ray_d * t;
    let c = vec2i(floor(p.xz + half));
    if (inside(c)) {
      let v = a[ix(c.x, c.y)];
      if (p.y <= v.x + v.y) {
        // back up half a step and settle between the two
        let q = L.ray_o + L.ray_d * (t + last) * 0.5;
        hit = vec4f(q.xz + half, 1.0, 0.0);
        return;
      }
    } else if (t > 0.0 && p.y < 0.0) {
      return;
    }
    last = t;
    t += 0.5;
  }
}

// rain everywhere if it is raining, and whatever the finger is doing where it touches
@compute @workgroup_size(8, 8)
fn paint(@builtin(global_invocation_id) id: vec3u) {
  let c = cell(id);
  if (!inside(c)) {
    return;
  }
  let i = ix(c.x, c.y);
  var v = a[i];
  // a storm falls evenly, with a little unevenness so streams have somewhere to start
  v.y += RAIN * L.rain * L.dt * (0.5 + hash(i, L.step));
  if (hit.z > 0.5) {
    let r = distance(vec2f(c) + 0.5, hit.xy);
    let w = exp(-(r * r) / (L.radius * L.radius));
    if (L.tool == 1u) {
      v.y += 0.12 * w;
    } else if (L.tool == 2u) {
      v.x += 0.3 * w;
      v.w += 0.3 * w;
    } else if (L.tool == 3u) {
      let dug = min(v.x, 0.3 * w);
      v.x -= dug;
      v.w -= dug;
    }
  }
  a[i] = v;
}

const DIRS = array<vec2i, 4>(vec2i(-1, 0), vec2i(1, 0), vec2i(0, -1), vec2i(0, 1));

// 1 — erosion.ts `stepFlux`
@compute @workgroup_size(8, 8)
fn flow(@builtin(global_invocation_id) id: vec3u) {
  let c = cell(id);
  if (!inside(c)) {
    return;
  }
  let i = ix(c.x, c.y);
  let v = a[i];
  let h = v.x + v.y;
  var f = flux[i];
  var sum = 0.0;
  for (var k = 0; k < 4; k++) {
    let q = c + DIRS[k];
    var out = 0.0;
    if (inside(q) || L.open == 1u) {
      var hn = v.x;
      if (inside(q)) {
        let w = a[ix(q.x, q.y)];
        hn = w.x + w.y;
      }
      out = max(0.0, f[k] * (1.0 - FRICTION * L.dt) + L.dt * G * (h - hn));
    }
    f[k] = out;
    sum += out;
  }
  var scale = 0.0;
  if (sum > 0.0) {
    scale = min(1.0, v.y / (sum * L.dt));
  }
  flux[i] = f * scale;
}

// 2 — erosion.ts `stepWater`: a → o
@compute @workgroup_size(8, 8)
fn water(@builtin(global_invocation_id) id: vec3u) {
  let c = cell(id);
  if (!inside(c)) {
    return;
  }
  let i = ix(c.x, c.y);
  let v = a[i];
  let f = flux[i];
  var inflow = vec4f(0.0);
  // in from the left is the left neighbour's flow right, and so on round
  let back = array<u32, 4>(1u, 0u, 3u, 2u);
  for (var k = 0; k < 4; k++) {
    let q = c + DIRS[k];
    if (inside(q)) {
      inflow[k] = flux[ix(q.x, q.y)][back[k]];
    }
  }
  let out = f.x + f.y + f.z + f.w;
  let dn = max(0.0, v.y + L.dt * (inflow.x + inflow.y + inflow.z + inflow.w - out));
  let wx = (inflow.x - f.x + f.y - inflow.y) / 2.0;
  let wy = (inflow.z - f.z + f.w - inflow.w) / 2.0;
  let mean = (v.y + dn) / 2.0;
  var u = vec2f(0.0);
  if (mean > 1e-4) {
    u = vec2f(wx, wy) / mean;
  }
  vel[i] = u;
  o[i] = vec4f(v.x, dn, v.z, v.w);
}

fn tilt_at(c: vec2i) -> f32 {
  let gx = (o[ix(c.x + 1, c.y)].x - o[ix(c.x - 1, c.y)].x) / 2.0;
  let gy = (o[ix(c.x, c.y + 1)].x - o[ix(c.x, c.y - 1)].x) / 2.0;
  let g2 = gx * gx + gy * gy;
  return max(MIN_TILT, sqrt(g2 / (1.0 + g2)));
}

// 3 — erosion.ts `stepErode`: o → a
@compute @workgroup_size(8, 8)
fn erode(@builtin(global_invocation_id) id: vec3u) {
  let c = cell(id);
  if (!inside(c)) {
    return;
  }
  let i = ix(c.x, c.y);
  var v = o[i];
  let capacity = KC * tilt_at(c) * length(vel[i]) * min(1.0, v.y / DEPTH_CAP);
  var moved = 0.0;
  if (capacity > v.z) {
    moved = KS * (capacity - v.z) * L.dt;
  } else {
    moved = -KD * (v.z - capacity) * L.dt;
  }
  let m = max(-v.z, moved);
  v.x -= m;
  v.z += m;
  v.y *= 1.0 - KE * L.dt;
  a[i] = v;
}

// 4 — erosion.ts `stepSettle`: a → o
@compute @workgroup_size(8, 8)
fn settle(@builtin(global_invocation_id) id: vec3u) {
  let c = cell(id);
  if (!inside(c)) {
    return;
  }
  let i = ix(c.x, c.y);
  let v = a[i];
  let nf = f32(L.n) - 1.0;
  let p = clamp(vec2f(c) - vel[i] * L.dt, vec2f(0.0), vec2f(nf));
  let p0 = vec2i(floor(p));
  let fr = p - vec2f(p0);
  let s00 = a[ix(p0.x, p0.y)].z;
  let s10 = a[ix(p0.x + 1, p0.y)].z;
  let s01 = a[ix(p0.x, p0.y + 1)].z;
  let s11 = a[ix(p0.x + 1, p0.y + 1)].z;
  let s = (s00 * (1.0 - fr.x) + s10 * fr.x) * (1.0 - fr.y) + (s01 * (1.0 - fr.x) + s11 * fr.x) * fr.y;
  var slump = 0.0;
  for (var k = 0; k < 4; k++) {
    let q = c + DIRS[k];
    if (!inside(q)) {
      continue;
    }
    let diff = a[ix(q.x, q.y)].x - v.x;
    slump += max(0.0, diff - TALUS) - max(0.0, -diff - TALUS);
  }
  o[i] = vec4f(v.x + KT * L.dt * slump * 0.25, v.y, s, v.w);
}
