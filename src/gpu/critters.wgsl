// Critters: a race of up to 256 copies of one body, each with its own brain. A WORKGROUP IS A
// CREATURE and a thread is one of its joints: the joints live in the workgroup's shared memory for
// the whole call, which runs many substeps — gravity, a guess, Jacobi passes over the bones (each
// joint gathers what its own bones ask of it, so no two threads ever write the same joint), the
// ground with friction, the velocity from the move — and only then goes back to the buffer.
// simulate() in critters.ts is this, line for line. Then the race is drawn: every copy faint, the
// best bright, bones as capsules and joints as dots, over the sky and a measured ground.

struct Race {
  size: vec2u,
  joints: u32,
  bones: u32,
  count: u32,
  steps: u32,
  time: f32,
  scale: f32,
  cam: vec2f,
  best: u32,
  build: u32,
}

@group(0) @binding(0) var<uniform> P: Race;
@group(0) @binding(1) var<storage, read> bones: array<vec4f>;
@group(0) @binding(2) var<storage, read> adjacency: array<i32>;
@group(0) @binding(3) var<storage, read> brains: array<f32>;
@group(0) @binding(4) var<storage, read_write> state: array<vec4f>;
@group(0) @binding(5) var<storage, read> pose: array<vec4f>;

const MAX_JOINTS = 16u;
const MAX_BONES = 32u;
const MAX_DEGREE = 8u;
const BRAIN_FLOATS = 68u;
const DT = 0.004166666666666667;
const ITERATIONS = 6;
const G = 9.8;
const FRICTION = 0.85;
const REACH = 0.2;
const DRAG = 1.5;
const PI = 3.14159265;

var<workgroup> X: array<f32, 16>;
var<workgroup> Y: array<f32, 16>;

fn bone_length(c: u32, b: vec4f, t: f32) -> f32 {
  if (b.w < 0.0) {
    return b.z;
  }
  let base = c * BRAIN_FLOATS;
  let m = u32(b.w);
  let phase = brains[base + m];
  let strength = brains[base + MAX_BONES + m];
  let beat = brains[base + MAX_BONES * 2u];
  return b.z * (1.0 + REACH * strength * sin(2.0 * PI * (beat * t + phase)));
}

@compute @workgroup_size(16)
fn race(@builtin(local_invocation_id) l: vec3u, @builtin(workgroup_id) w: vec3u) {
  let c = w.x;
  let i = l.x;
  let mine = i < P.joints && c < P.count;
  let k = c * MAX_JOINTS + i;
  var v = vec2f(0);
  if (mine) {
    let s = state[k];
    X[i] = s.x;
    Y[i] = s.y;
    v = s.zw;
  }
  workgroupBarrier();
  for (var step = 0u; step < P.steps; step++) {
    let t = P.time + f32(step) * DT;
    var prev = vec2f(0);
    if (mine) {
      v *= 1.0 - DRAG * DT;
      v.y -= G * DT;
      prev = vec2f(X[i], Y[i]);
      X[i] += v.x * DT;
      Y[i] += v.y * DT;
    }
    workgroupBarrier();
    for (var it = 0; it < ITERATIONS; it++) {
      var d = vec2f(0);
      var n = 0.0;
      if (mine) {
        for (var a = 0u; a < MAX_DEGREE; a++) {
          let bi = adjacency[i * MAX_DEGREE + a];
          if (bi < 0) {
            break;
          }
          let b = bones[u32(bi)];
          let ia = u32(b.x);
          let ib = u32(b.y);
          let e = vec2f(X[ib] - X[ia], Y[ib] - Y[ia]);
          let len = max(length(e), 1e-9);
          let corr = e * (0.5 * (len - bone_length(c, b, t)) / len);
          d += select(-corr, corr, ia == i);
          n += 1.0;
        }
      }
      workgroupBarrier();
      if (mine && n > 0.0) {
        X[i] += d.x / n;
        Y[i] += d.y / n;
      }
      workgroupBarrier();
    }
    if (mine) {
      if (Y[i] < 0.0) {
        Y[i] = 0.0;
        X[i] = prev.x + (X[i] - prev.x) * (1.0 - FRICTION);
      }
      v = (vec2f(X[i], Y[i]) - prev) / DT;
    }
    workgroupBarrier();
  }
  if (mine) {
    state[k] = vec4f(X[i], Y[i], v);
  }
}

// ---------------------------------------------------------------- drawing

fn to_screen(p: vec2f) -> vec4f {
  let size = vec2f(P.size);
  let s = (p - P.cam) * P.scale;
  return vec4f(s.x / size.x * 2.0, s.y / size.y * 2.0 - 0.0, 0, 1);
}

@vertex
fn cover(@builtin(vertex_index) v: u32) -> @builtin(position) vec4f {
  let p = array(vec2f(-1, -3), vec2f(3, 1), vec2f(-1, 1))[v];
  return vec4f(p, 0, 1);
}

@fragment
fn ground(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let size = vec2f(P.size);
  let p = P.cam + vec2f(pos.x - size.x * 0.5, size.y * 0.5 - pos.y) / P.scale;
  let px = 1.0 / P.scale;
  var c = mix(vec3f(0.85, 0.92, 0.98), vec3f(0.55, 0.72, 0.92), clamp(p.y / 6.0, 0.0, 1.0));
  if (P.build == 1u) {
    // the building grid, a line every 10 cm, firmer every metre
    let g = abs(fract(p / 0.1 + 0.5) - 0.5) * 0.1;
    let m = abs(fract(p + 0.5) - 0.5);
    c = mix(c, vec3f(0.6, 0.7, 0.8), smoothstep(px, 0.0, min(g.x, g.y)) * 0.5);
    c = mix(c, vec3f(0.4, 0.5, 0.65), smoothstep(px * 1.5, 0.0, min(m.x, m.y)) * 0.6);
  }
  if (p.y < 0.0) {
    c = mix(vec3f(0.45, 0.65, 0.3), vec3f(0.35, 0.25, 0.18), smoothstep(0.0, 0.25, -p.y));
    // a mark every metre, and a longer one every five, and the start line
    let m = abs(fract(p.x + 0.5) - 0.5);
    let tall = select(0.15, 0.4, abs(fract(p.x / 5.0 + 0.5) - 0.5) * 5.0 < 0.5);
    if (m < px * 1.5 && -p.y < tall) {
      c = vec3f(0.95);
    }
    if (abs(p.x) < px * 2.5 && -p.y < 0.6) {
      c = vec3f(0.9, 0.2, 0.2);
    }
  }
  return vec4f(c, 1);
}

struct Stroke {
  @builtin(position) pos: vec4f,
  @location(0) local: vec2f,
  @location(1) @interpolate(flat) colour: vec4f,
  @location(2) @interpolate(flat) half: vec2f,
}

fn creature_alpha(c: u32) -> f32 {
  return select(0.07, 1.0, c == P.best || P.build == 1u);
}

/** a bone: a capsule quad from joint a to joint b of creature (instance / bones) */
@vertex
fn bone_vs(@builtin(vertex_index) v: u32, @builtin(instance_index) n: u32) -> Stroke {
  // the best creature is drawn last, on top, by giving it the last instances
  var c = n / P.bones;
  let bi = n % P.bones;
  if (c == P.count - 1u) {
    c = P.best;
  } else if (c >= P.best) {
    c = c + 1u;
  }
  let b = bones[bi];
  let a = pose[c * MAX_JOINTS + u32(b.x)].xy;
  let z = pose[c * MAX_JOINTS + u32(b.y)].xy;
  let r = select(0.035, 0.05, b.w >= 0.0) * select(1.0, 1.3, P.build == 1u);
  let dir = normalize(z - a + vec2f(1e-6, 0));
  let side = vec2f(-dir.y, dir.x);
  let len = length(z - a);
  let corner = array(vec2f(0, -1), vec2f(1, -1), vec2f(0, 1), vec2f(0, 1), vec2f(1, -1), vec2f(1, 1))[v];
  let along = mix(-r, len + r, corner.x);
  let p = a + dir * along + side * corner.y * r;
  var o: Stroke;
  o.pos = to_screen(p);
  o.local = vec2f(along, corner.y * r);
  o.half = vec2f(len, r);
  let muscle = b.w >= 0.0;
  let col = select(vec3f(0.35, 0.35, 0.4), vec3f(0.9, 0.3, 0.3), muscle);
  o.colour = vec4f(col, creature_alpha(c));
  return o;
}

@fragment
fn bone_fs(i: Stroke) -> @location(0) vec4f {
  let q = vec2f(i.local.x - clamp(i.local.x, 0.0, i.half.x), i.local.y);
  if (length(q) > i.half.y) {
    discard;
  }
  return i.colour;
}

/** a joint: a dot */
@vertex
fn joint_vs(@builtin(vertex_index) v: u32, @builtin(instance_index) n: u32) -> Stroke {
  var c = n / P.joints;
  let j = n % P.joints;
  if (c == P.count - 1u) {
    c = P.best;
  } else if (c >= P.best) {
    c = c + 1u;
  }
  let p = pose[c * MAX_JOINTS + j].xy;
  let r = select(0.06, 0.08, P.build == 1u);
  let corner = array(vec2f(-1, -1), vec2f(1, -1), vec2f(-1, 1), vec2f(-1, 1), vec2f(1, -1), vec2f(1, 1))[v];
  var o: Stroke;
  o.pos = to_screen(p + corner * r);
  o.local = corner * r;
  o.half = vec2f(0, r);
  o.colour = vec4f(0.15, 0.15, 0.2, creature_alpha(c));
  return o;
}

@fragment
fn joint_fs(i: Stroke) -> @location(0) vec4f {
  if (length(i.local) > i.half.y) {
    discard;
  }
  return i.colour;
}
