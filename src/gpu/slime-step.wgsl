// The mould: paint the grid, move every agent, spread the trail. See slime.ts. Joined after
// slime-types.wgsl; all three passes share one bind group.

@group(0) @binding(1) var<storage, read_write> agents: array<vec4f>; // x, y, heading, -
@group(0) @binding(2) var<storage, read> trail_in: array<f32>;
@group(0) @binding(3) var<storage, read_write> trail_out: array<f32>;
// ⚠️ ATOMIC: many agents land on one cell in the same step, and every one must count
@group(0) @binding(4) var<storage, read_write> deposits: array<atomic<u32>>;
@group(0) @binding(5) var<storage, read_write> kinds: array<u32>;
@group(0) @binding(6) var<storage, read> dabs: array<vec4f>; // x, y, radius, kind

const FOOD_SMELL = 4.0;
// food feeds the trail every step, so its scent spreads: see FOOD_SOURCE in slime.ts
const FOOD_SOURCE = 40.0;
const TAU = 6.2831853;

fn hash(a: u32, b: u32) -> f32 {
  var x = a * 747796405u + b * 2891336453u + 12345u;
  x = ((x >> ((x >> 28u) + 4u)) ^ x) * 277803737u;
  x = (x >> 22u) ^ x;
  return f32(x) / 4294967295.0;
}

fn cell(p: vec2f) -> u32 {
  let c = clamp(vec2i(floor(p)), vec2i(0), vec2i(S.size) - 1);
  return u32(c.y) * S.size.x + u32(c.x);
}

fn inside(p: vec2f) -> bool {
  return all(p >= vec2f(0.0)) && all(p < vec2f(S.size));
}

// what an agent smells at p: the trail, food far stronger, a wall or the edge as nothing at all
fn smell(p: vec2f) -> f32 {
  if (!inside(p)) {
    return -1e3;
  }
  let i = cell(p);
  let k = kinds[i];
  if (k == WALL) {
    return -1e3;
  }
  return trail_in[i] + select(0.0, FOOD_SMELL * S.deposit * 10.0, k == FOOD);
}

// mirrors `turnFor` in slime.ts
fn turn_for(front: f32, left: f32, right: f32, roll: f32) -> f32 {
  if (front > left && front > right) {
    return 0.0;
  }
  if (front < left && front < right) {
    return select(S.turn, -S.turn, roll < 0.5);
  }
  if (left > right) {
    return S.turn;
  }
  if (right > left) {
    return -S.turn;
  }
  return 0.0;
}

@compute @workgroup_size(8, 8)
fn paint(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= S.size)) {
    return;
  }
  let here = vec2f(id.xy) + 0.5;
  let i = id.y * S.size.x + id.x;
  for (var k = 0u; k < S.dabs; k++) {
    let d = dabs[k];
    let what = u32(d.w);
    if (what != SPORES && distance(here, d.xy) <= d.z) {
      kinds[i] = what;
    }
  }
}

@compute @workgroup_size(64)
fn walk(@builtin(global_invocation_id) id: vec3u) {
  let n = id.x;
  if (n >= S.agents) {
    return;
  }
  var a = agents[n];
  var p = a.xy;
  var h = a.z;
  // spores: while a finger blows them, a few agents a step are thrown out of it
  for (var k = 0u; k < S.dabs; k++) {
    let d = dabs[k];
    if (u32(d.w) == SPORES && hash(n, S.step * 7u + k) < 0.004) {
      h = hash(n, S.step + 99u) * TAU;
      p = d.xy + vec2f(cos(h), sin(h)) * hash(n, S.step + 7u) * d.z;
    }
  }
  let front = smell(p + vec2f(cos(h), sin(h)) * S.sense_dist);
  let left = smell(p + vec2f(cos(h + S.sense_angle), sin(h + S.sense_angle)) * S.sense_dist);
  let right = smell(p + vec2f(cos(h - S.sense_angle), sin(h - S.sense_angle)) * S.sense_dist);
  h += turn_for(front, left, right, hash(n, S.step));
  let next = p + vec2f(cos(h), sin(h)) * S.speed;
  if (!inside(next) || kinds[cell(next)] == WALL) {
    // blocked: stay, and face somewhere new
    h = hash(n, S.step + 31u) * TAU;
  } else {
    p = next;
  }
  agents[n] = vec4f(p, h, 0.0);
  atomicAdd(&deposits[cell(p)], 1u);
}

@compute @workgroup_size(8, 8)
fn spread(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= S.size)) {
    return;
  }
  let i = id.y * S.size.x + id.x;
  let landed = atomicExchange(&deposits[i], 0u);
  if (kinds[i] == WALL) {
    trail_out[i] = 0.0;
    return;
  }
  // mirrors `stepTrail` in slime.ts: part way to the 3×3 mean, decayed, plus what landed
  var s = 0.0;
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let q = vec2i(id.xy) + vec2i(dx, dy);
      if (any(q < vec2i(0)) || any(q >= vec2i(S.size))) {
        continue;
      }
      s += trail_in[u32(q.y) * S.size.x + u32(q.x)];
    }
  }
  let mine = trail_in[i];
  let spread = mine + (s / 9.0 - mine) * S.diffuse;
  trail_out[i] = spread * (1.0 - S.decay) + f32(landed) * S.deposit + select(0.0, FOOD_SOURCE, kinds[i] == FOOD);
}
