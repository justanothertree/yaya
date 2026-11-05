// A snow crystal, grown by Reiter's model on a lattice of hexagons and drawn as ice.
// See snowflake.ts for the model; `mark` and `grow` together are its `stepFlake`.
//
// ⚠️ `Flake` IS PACKED BY HAND IN snowflake.ts (`FLAKE`); snowflake.test.ts lays it out from here.

struct Flake {
  size: vec2u, // the canvas, in pixels
  w: u32, // cells each way of the lattice
  radius: f32, // past this hex distance from the middle, the open air, held at β
  alpha: f32,
  beta: f32,
  gamma: f32,
  breath: f32, // 0..1: somebody blowing on the microphone — more vapour in the air
  finger: vec2f, // where a finger breathes on it, in axial cells from the middle
  reach: f32, // how much it breathes (0: no finger)
  sym: u32, // 1: the breath lands six ways round the middle, as the air round a crystal does
}

@group(0) @binding(0) var<uniform> F: Flake;

const SQRT3 = 1.7320508;
// mirrored in snowflake.ts (`NEIGHBOURS`)
const NB = array<vec2i, 6>(vec2i(1, 0), vec2i(-1, 0), vec2i(0, 1), vec2i(0, -1), vec2i(1, -1), vec2i(-1, 1));
// how much more vapour the air holds at full breath
const BREATH_VAPOUR = 0.35;
const BREATH_WIDTH = 9.0;

fn hex_distance(d: vec2i) -> f32 {
  return f32(abs(d.x) + abs(d.y) + abs(d.x + d.y)) / 2.0;
}

fn plane(c: vec2f) -> vec2f {
  return vec2f(c.x + c.y * 0.5, c.y * SQRT3 * 0.5);
}

@group(0) @binding(1) var<storage, read> s_in: array<f32>;
@group(0) @binding(2) var<storage, read_write> s_out: array<f32>;
@group(0) @binding(3) var<storage, read_write> receptive: array<u32>;

fn at(c: vec2i) -> i32 {
  let w = i32(F.w);
  if (c.x < 0 || c.y < 0 || c.x >= w || c.y >= w) {
    return -1;
  }
  return c.y * w + c.x;
}

fn frozen(c: vec2i) -> bool {
  let i = at(c);
  return i >= 0 && s_in[i] >= 1.0;
}

// first: which cells are ice or touch it
@compute @workgroup_size(8, 8)
fn mark(@builtin(global_invocation_id) id: vec3u) {
  let c = vec2i(id.xy);
  let i = at(c);
  if (i < 0) {
    return;
  }
  var rec = frozen(c);
  for (var k = 0; k < 6; k++) {
    rec = rec || frozen(c + NB[k]);
  }
  receptive[i] = select(0u, 1u, rec);
}

// how much a finger's breath adds to the air at this cell, a step
fn breathed(d: vec2i) -> f32 {
  if (F.reach <= 0.0) {
    return 0.0;
  }
  var f = F.finger;
  var sum = 0.0;
  let turns = select(1, 6, F.sym == 1u);
  for (var k = 0; k < turns; k++) {
    let gap = plane(vec2f(d)) - plane(f);
    sum += exp(-dot(gap, gap) / (BREATH_WIDTH * BREATH_WIDTH));
    // a sixth of a turn: (q, r) → (−r, q + r)
    f = vec2f(-f.y, f.x + f.y);
  }
  return F.reach * sum;
}

// then: every cell's vapour diffuses; receptive cells also keep what they have and gain γ
@compute @workgroup_size(8, 8)
fn grow(@builtin(global_invocation_id) id: vec3u) {
  let c = vec2i(id.xy);
  let i = at(c);
  if (i < 0) {
    return;
  }
  let mid = i32(F.w - 1u) / 2;
  let air = F.beta + BREATH_VAPOUR * F.breath;
  if (hex_distance(c - vec2i(mid)) > F.radius) {
    s_out[i] = air;
    return;
  }
  var mean = 0.0;
  for (var k = 0; k < 6; k++) {
    let j = at(c + NB[k]);
    var u = air;
    if (j >= 0) {
      u = select(s_in[j], 0.0, receptive[j] == 1u);
    }
    mean += u;
  }
  mean /= 6.0;
  // a receptive cell keeps what it has, gains γ, and holds no diffusing vapour of its own — but
  // still draws vapour in from the air beside it (snowflake.ts says why that matters)
  let rec = receptive[i] == 1u;
  let kept = select(0.0, s_in[i] + F.gamma, rec);
  let here = select(s_in[i] + breathed(c - vec2i(mid)), 0.0, rec);
  s_out[i] = kept + here + F.alpha * 0.5 * (mean - here);
}

// ---- drawing

struct Px {
  @builtin(position) clip: vec4f,
  @location(0) ndc: vec2f,
}

@vertex
fn cover(@builtin(vertex_index) v: u32) -> Px {
  let p = vec2f(f32((v << 1u) & 2u), f32(v & 2u)) * 2.0 - 1.0;
  var o: Px;
  o.clip = vec4f(p, 0.0, 1.0);
  o.ndc = p;
  return o;
}

@group(0) @binding(4) var<storage, read> shown: array<f32>;

fn cell_value(c: vec2i) -> f32 {
  let w = i32(F.w);
  let q = clamp(c, vec2i(0), vec2i(w - 1));
  return shown[q.y * w + q.x];
}

// the lattice read between cell centres: linear across the triangle of the three nearest
fn sample(p: vec2f) -> f32 {
  let mid = f32(F.w - 1u) * 0.5;
  let r = p.y * 2.0 / SQRT3;
  let a = vec2f(p.x - r * 0.5, r) + mid;
  let a0 = floor(a);
  let f = a - a0;
  let c = vec2i(a0);
  if (f.x + f.y < 1.0) {
    return cell_value(c) * (1.0 - f.x - f.y) + cell_value(c + vec2i(1, 0)) * f.x + cell_value(c + vec2i(0, 1)) * f.y;
  }
  return cell_value(c + vec2i(1, 1)) * (f.x + f.y - 1.0) + cell_value(c + vec2i(1, 0)) * (1.0 - f.y) + cell_value(c + vec2i(0, 1)) * (1.0 - f.x);
}

@fragment
fn show(px: Px) -> @location(0) vec4f {
  let aspect = f32(F.size.x) / f32(F.size.y);
  // the whole disc of air fits the shorter side
  let fit = (F.radius + 4.0) * select(1.0, 1.0 / aspect, aspect < 1.0);
  let p = vec2f(px.ndc.x * aspect, -px.ndc.y) * fit;
  let s = sample(p);
  let e = 0.5;
  let gx = sample(p + vec2f(e, 0.0)) - sample(p - vec2f(e, 0.0));
  let gy = sample(p + vec2f(0.0, e)) - sample(p - vec2f(0.0, e));
  // the air: deep blue night, paler where it holds more vapour — so the crystal's thirst shows
  let air = F.beta + BREATH_VAPOUR * F.breath;
  let damp = clamp(s / max(air, 0.05), 0.0, 1.5);
  var c = mix(vec3f(0.01, 0.02, 0.06), vec3f(0.08, 0.13, 0.26), damp * 0.8);
  if (length(p) > F.radius * 0.866) {
    c *= 0.85;
  }
  // the ice: an edge where the water crosses 1, thicker where it has grown longest, lit across
  let ice = smoothstep(0.985, 1.0, s);
  let thick = clamp((s - 1.0) * 6.0, 0.0, 1.0);
  let n = normalize(vec3f(-gx * 12.0, -gy * 12.0, 1.0));
  let light = normalize(vec3f(-0.4, -0.6, 0.7));
  let diffuse = max(0.0, dot(n, light));
  let glint = pow(max(0.0, dot(reflect(-light, n), vec3f(0.0, 0.0, 1.0))), 30.0);
  let rim = 1.0 - n.z;
  var frost = mix(vec3f(0.55, 0.72, 0.95), vec3f(0.9, 0.96, 1.0), thick) * (0.55 + 0.5 * diffuse);
  frost += vec3f(1.0) * glint * 0.9 + vec3f(0.6, 0.85, 1.0) * rim * 1.5;
  c = mix(c, frost, ice);
  return vec4f(c, 1.0);
}
