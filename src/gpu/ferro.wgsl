// Ferrofluid. A step of the surface is six dispatches:
//   grow   — real space: the field's growth, the quadratic and cubic terms, a breath of noise
//   rows   — a forward FFT of every row, one workgroup a row, in shared memory
//   cols   — and of every column
//   damp   — in Fourier space, the stiff part, exactly: each mode times 1/(1+dt((k₀²−k²)/k₀²)²)
//   rows, cols again, inverse (INVERSE is an override constant: four pipelines from two entries)
//   settle — back to the real field
// and then one fullscreen pass draws it: a pool of glossy black liquid in a dish, its height the
// pool's heap plus the spikes, lit by a studio's reflection.

struct Ferro {
  size: vec2u,
  grid: vec2u,
  m0: vec4f,
  m1: vec4f,
  m2: vec4f,
  m3: vec4f,
  count: u32,
  dt: f32,
  k0: f32,
  g: f32,
  spike: vec2f,
  light: vec2f,
  tick: u32,
}

@group(0) @binding(0) var<uniform> P: Ferro;
@group(0) @binding(1) var<storage, read_write> u: array<f32>;
@group(0) @binding(2) var<storage, read_write> work: array<vec2f>;
@group(0) @binding(3) var<storage, read> twiddle: array<vec2f>;
@group(0) @binding(4) var<storage, read> surface: array<f32>;

const N = 256u;
const BITS = 8u;
const PI = 3.14159265;
const REACH = 60.0;
const R_REST = -0.15;
const R_GAIN = 0.4;
const POOL = 0.3;

override INVERSE: bool = false;

fn magnet(k: u32) -> vec4f {
  switch k {
    case 0u: { return P.m0; }
    case 1u: { return P.m1; }
    case 2u: { return P.m2; }
    default: { return P.m3; }
  }
}

/** the magnets' field at a cell, as `field` in ferro.ts */
fn field(p: vec2f) -> f32 {
  var b = 0.0;
  for (var k = 0u; k < P.count; k++) {
    let m = magnet(k);
    let d2 = dot(p - m.xy, p - m.xy) / (REACH * REACH);
    b += m.z / pow(1.0 + d2, 1.5);
  }
  return b;
}

/**
 * How much liquid is here, 0..1: a puddle in the middle of the dish, drawn out toward each magnet
 * by how hard it pulls.
 */
fn pool(p: vec2f) -> f32 {
  let c = vec2f(f32(N) * 0.5);
  var amount = smoothstep(f32(N) * POOL, f32(N) * POOL - 10.0, length(p - c));
  for (var k = 0u; k < P.count; k++) {
    let m = magnet(k);
    let d2 = dot(p - m.xy, p - m.xy) / (REACH * REACH * 0.7);
    amount += m.z * exp(-d2) * 0.9;
  }
  return smoothstep(0.35, 0.65, amount);
}

fn hash(p: vec2u, t: u32) -> f32 {
  var h = p.x * 1973u + p.y * 9277u + t * 26699u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  return f32(h ^ (h >> 16u)) / 4294967295.0;
}

@compute @workgroup_size(16, 16)
fn grow(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= N || id.y >= N) {
    return;
  }
  let i = id.y * N + id.x;
  let p = vec2f(id.xy) + 0.5;
  let wet = pool(p);
  // flat, firmly, where there is no liquid; the field's growth where there is
  let r = mix(-1.0, R_REST + R_GAIN * field(p), wet);
  let v = u[i] + (hash(id.xy, P.tick) - 0.5) * 2e-3 * wet;
  work[i] = vec2f(v + P.dt * (r * v + P.g * v * v - v * v * v), 0.0);
}

var<workgroup> line: array<vec2f, 256>;

fn cmul(a: vec2f, b: vec2f) -> vec2f {
  return vec2f(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}

/** one FFT of N points along a line of `work`, start `base`, `stride` apart; 128 threads */
fn fft_line(t: u32, base: u32, stride: u32) {
  for (var k = 0u; k < 2u; k++) {
    let i = t * 2u + k;
    line[reverseBits(i) >> (32u - BITS)] = work[base + i * stride];
  }
  workgroupBarrier();
  for (var half = 1u; half < N; half *= 2u) {
    let j = t % half;
    let i = (t / half) * half * 2u + j;
    var w = twiddle[j * (N / 2u / half)];
    if (INVERSE) {
      w.y = -w.y;
    }
    let b = cmul(line[i + half], w);
    let a = line[i];
    line[i + half] = a - b;
    line[i] = a + b;
    workgroupBarrier();
  }
  let scale = select(1.0, 1.0 / f32(N), INVERSE);
  for (var k = 0u; k < 2u; k++) {
    let i = t * 2u + k;
    work[base + i * stride] = line[i] * scale;
  }
}

@compute @workgroup_size(128)
fn rows(@builtin(local_invocation_id) l: vec3u, @builtin(workgroup_id) w: vec3u) {
  fft_line(l.x, w.x * N, 1u);
}

@compute @workgroup_size(128)
fn cols(@builtin(local_invocation_id) l: vec3u, @builtin(workgroup_id) w: vec3u) {
  fft_line(l.x, w.x, N);
}

fn wave(i: u32) -> f32 {
  var k = f32(i);
  if (i > N / 2u) {
    k -= f32(N);
  }
  return k * 2.0 * PI / f32(N);
}

@compute @workgroup_size(16, 16)
fn damp(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= N || id.y >= N) {
    return;
  }
  let kx = wave(id.x);
  let ky = wave(id.y);
  let s = (P.k0 * P.k0 - kx * kx - ky * ky) / (P.k0 * P.k0);
  work[id.y * N + id.x] *= 1.0 / (1.0 + P.dt * s * s);
}

@compute @workgroup_size(16, 16)
fn settle(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= N || id.y >= N) {
    return;
  }
  let i = id.y * N + id.x;
  u[i] = work[i].x;
}

// ---------------------------------------------------------------- drawing

@vertex
fn cover(@builtin(vertex_index) v: u32) -> @builtin(position) vec4f {
  let p = array(vec2f(-1, -3), vec2f(3, 1), vec2f(-1, 1))[v];
  return vec4f(p, 0, 1);
}

fn at(c: vec2i) -> f32 {
  let q = clamp(c, vec2i(0), vec2i(i32(N) - 1));
  return surface[u32(q.y) * N + u32(q.x)];
}

/** the surface between cells */
fn sample(p: vec2f) -> f32 {
  let q = p - 0.5;
  let c = vec2i(floor(q));
  let f = q - floor(q);
  return mix(mix(at(c), at(c + vec2i(1, 0)), f.x), mix(at(c + vec2i(0, 1)), at(c + vec2i(1, 1)), f.x), f.y);
}

/** the liquid's height: its heap, more under a magnet, and the spikes on top */
fn height(p: vec2f) -> f32 {
  let wet = pool(p);
  return wet * (P.spike.y * (0.6 + field(p)) + P.spike.x * sample(p));
}

/** the studio the liquid reflects: dark walls, two softboxes overhead, a warm card low on one side */
fn studio(r: vec3f) -> vec3f {
  var c = vec3f(0.05, 0.05, 0.07) + vec3f(0.08, 0.08, 0.1) * max(r.z, 0.0);
  // the big soft light overhead, which is what a flat pool shows from above
  c += vec3f(0.3, 0.31, 0.34) * smoothstep(0.42, 0.12, length(r.xy - vec2f(0.12, -0.16)));
  let box1 = smoothstep(0.25, 0.18, length(r.xy - vec2f(-0.35, -0.45)));
  let box2 = smoothstep(0.18, 0.12, length(r.xy - vec2f(0.5, -0.2)));
  c += vec3f(0.95, 0.97, 1.0) * box1 * 1.4 + vec3f(0.8, 0.85, 1.0) * box2 * 0.9;
  c += vec3f(1.0, 0.55, 0.25) * smoothstep(0.3, 0.9, -r.y - r.x * 0.2) * smoothstep(0.6, 0.0, r.z) * 0.5;
  return c;
}

@fragment
fn show(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let size = vec2f(P.size);
  let side = min(size.x, size.y);
  // the dish fills the shorter side, centred; p is in cells
  let p = (pos.xy - (size - side) * 0.5) / side * f32(N);
  let c = vec2f(f32(N) * 0.5);
  let d = length(p - c) / (f32(N) * 0.5);
  // the table, the dish's rim, and its floor
  var col = vec3f(0.16, 0.12, 0.1) * (0.8 + 0.2 * (1.0 - pos.y / size.y));
  if (d < 1.0) {
    col = mix(vec3f(0.82, 0.83, 0.86), vec3f(0.92, 0.93, 0.95), 1.0 - d);
    col *= 1.0 - 0.25 * smoothstep(0.9, 1.0, d);
    col += vec3f(0.12) * smoothstep(0.93, 0.97, d) * smoothstep(1.0, 0.97, d);
    // the magnets under the glass: a faint ring each
    for (var k = 0u; k < P.count; k++) {
      let m = magnet(k);
      let ring = abs(length(p - m.xy) - 9.0);
      col -= vec3f(0.18) * smoothstep(1.6, 0.4, ring) * min(m.z, 1.0);
    }
  }
  let wet = pool(p);
  if (wet <= 0.0 || d >= 1.0) {
    return vec4f(col, 1);
  }
  // the liquid's surface: slope from neighbours, lit by what it reflects
  let e = 0.75;
  let hx = height(p + vec2f(e, 0)) - height(p - vec2f(e, 0));
  let hy = height(p + vec2f(0, e)) - height(p - vec2f(0, e));
  let n = normalize(vec3f(-hx, -hy, 2.0 * e));
  let r = reflect(vec3f(0, 0, -1), n);
  let fresnel = 0.05 + 0.95 * pow(1.0 - n.z, 4.0);
  var liquid = vec3f(0.012, 0.012, 0.016) + studio(r) * mix(0.35, 1.0, fresnel);
  let l = normalize(vec3f(P.light, 0.7));
  liquid += vec3f(1.0) * pow(max(dot(r, l), 0.0), 220.0) * 1.6;
  // its edge, where it thins to nothing on the dish, darkens the dish under it a little
  return vec4f(mix(col * 0.55, liquid, smoothstep(0.0, 0.5, wet)), 1);
}
