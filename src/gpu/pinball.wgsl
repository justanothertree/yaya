// Pinball workshop. `bake` runs only when the table changes: every texel of a field over the table
// gets its distance to the nearest wall (r), bumper (g) and target (b) — `distanceAt` in pinball.ts,
// a channel a kind. `show` draws each frame from that field: neon walls that glow by their distance,
// bumpers ringed and flashing when struck, targets lit or waiting, the flippers, the ball and its
// trail, and the plunger's pull — with the table fitted upright on the stage (tableFit).

struct Table {
  size: vec2u,
  field: vec2u,
  ball: vec2f,
  pull: vec2f,
  flipL: vec4f,
  flipR: vec4f,
  segs: u32,
  items: u32,
  time: f32,
  building: u32,
}

const W = 10.0;
const H = 18.0;
const BALL_R = 0.24;
const WALL_R = 0.1;
const BUMPER_R = 0.55;
const TARGET_R = 0.22;
const FLIP_R = 0.2;
const LANE_X = 9.2;

@group(0) @binding(0) var<uniform> T: Table;
/** every wall segment, the frame's and yours */
@group(0) @binding(1) var<storage, read> segs: array<vec4f>;
/** bumpers and targets: (x, y, kind 0 bumper / 1 target, glow 0..1) */
@group(0) @binding(2) var<storage, read> items: array<vec4f>;
@group(0) @binding(3) var field: texture_storage_2d<rgba16float, write>;

fn seg_d(p: vec2f, s: vec4f) -> f32 {
  let ab = s.zw - s.xy;
  let t = clamp(dot(p - s.xy, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
  return distance(p, s.xy + ab * t);
}

/** a texel of the field to the table: texel centres spread evenly over W × H */
fn texel_at(c: vec2u) -> vec2f {
  return (vec2f(c) + 0.5) / vec2f(T.field) * vec2f(W, H);
}

@compute @workgroup_size(8, 8)
fn bake(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= T.field.x || id.y >= T.field.y) {
    return;
  }
  let p = texel_at(id.xy);
  var dw = 1e3;
  for (var k = 0u; k < T.segs; k++) {
    dw = min(dw, seg_d(p, segs[k]) - WALL_R);
  }
  var db = 1e3;
  var dt = 1e3;
  for (var k = 0u; k < T.items; k++) {
    let it = items[k];
    if (it.z < 0.5) {
      db = min(db, distance(p, it.xy) - BUMPER_R);
    } else {
      dt = min(dt, distance(p, it.xy) - TARGET_R);
    }
  }
  textureStore(field, vec2i(id.xy), vec4f(dw, db, dt, 0));
}

// ---------------------------------------------------------------- drawing

@group(1) @binding(0) var seen: texture_2d<f32>;
@group(1) @binding(1) var smp: sampler;
@group(1) @binding(2) var<storage, read> trail: array<vec2f, 32>;

@vertex
fn cover(@builtin(vertex_index) v: u32) -> @builtin(position) vec4f {
  let p = array(vec2f(-1, -3), vec2f(3, 1), vec2f(-1, 1))[v];
  return vec4f(p, 0, 1);
}

/** a pixel to the table: the table upright, as big as fits with half a unit round it, y up (tableFit) */
fn to_table(pos: vec2f) -> vec3f {
  let size = vec2f(T.size);
  let s = min(size.x / (W + 1.0), size.y / (H + 1.0));
  let o = (size - vec2f(W, H) * s) * 0.5;
  return vec3f((pos.x - o.x) / s, H - (pos.y - o.y) / s, 1.0 / s);
}

fn glow(d: f32, px: f32, tint: vec3f) -> vec3f {
  let core = smoothstep(px * 1.5, 0.0, d);
  let halo = exp(-max(d, 0.0) * 6.0) * 0.35;
  return tint * (core + halo);
}

@fragment
fn show(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let t3 = to_table(pos.xy);
  let p = t3.xy;
  let px = t3.z;
  var col = vec3f(0.02, 0.02, 0.05);
  let inside = p.x > -0.3 && p.x < W + 0.3 && p.y > -0.6 && p.y < H + 0.3;
  if (!inside) {
    return vec4f(col, 1);
  }
  // the playfield: a deep blue with a faint grid, darker in the lane
  let grid = step(0.96, fract(p.x)) + step(0.96, fract(p.y));
  col = vec3f(0.05, 0.06, 0.13) + grid * 0.02;
  if (p.x > LANE_X) {
    col *= 0.7;
  }
  if (T.building == 1u && p.y > 3.9 && p.x < LANE_X - 0.4 && p.x > 0.4 && p.y < 16.6) {
    col += vec3f(0.02, 0.04, 0.02);
  }
  // the field's row 0 is the table's bottom (texel_at), so v runs up the table with y. Past its edge
  // a sample would clamp to the edge texel and smear the outer walls outward; read the nearest point
  // inside instead and add the way out to it, which keeps it a distance
  let pc = clamp(p, vec2f(0), vec2f(W, H));
  let f = textureSampleLevel(seen, smp, pc / vec2f(W, H), 0.0) + distance(p, pc);
  col += glow(f.r, px, vec3f(0.25, 0.85, 1.0));
  col += glow(f.g, px, vec3f(1.0, 0.3, 0.8)) * 0.6;
  col += glow(f.b, px, vec3f(1.0, 0.75, 0.2)) * 0.5;
  // bumpers flash and targets light: their own glow from the item list
  for (var k = 0u; k < T.items; k++) {
    let it = items[k];
    let d = distance(p, it.xy);
    if (it.z < 0.5) {
      let ring = abs(d - BUMPER_R * 0.6);
      col += vec3f(1.0, 0.4, 0.85) * (smoothstep(px * 2.0, 0.0, ring - 0.04) * (0.5 + it.w));
      col += vec3f(1.0, 0.6, 0.9) * smoothstep(BUMPER_R, 0.0, d) * it.w * 0.8;
    } else {
      col += vec3f(1.0, 0.8, 0.25) * smoothstep(TARGET_R, 0.0, d) * (0.15 + it.w * 0.9);
    }
  }
  // the flippers
  for (var k = 0; k < 2; k++) {
    let fl = select(T.flipL, T.flipR, k == 1);
    let d = seg_d(p, fl) - FLIP_R;
    col = mix(col, vec3f(0.95, 0.95, 1.0), smoothstep(px, -px, d));
    col += glow(d, px, vec3f(0.6, 0.6, 1.0)) * 0.4;
  }
  // the ball's trail, then the ball
  var tr = 0.0;
  for (var k = 1u; k < 32u; k++) {
    let a = trail[k - 1u];
    let b = trail[k];
    if (distance(a, b) < 2.0) {
      tr = max(tr, smoothstep(BALL_R * 0.8, 0.0, seg_d(p, vec4f(a, b))) * (1.0 - f32(k) / 32.0));
    }
  }
  col += vec3f(0.7, 0.8, 1.0) * tr * 0.25;
  let db = distance(p, T.ball);
  let shade = 0.65 + 0.35 * clamp(dot(normalize(p - T.ball + vec2f(0.0001)), vec2f(-0.5, 0.7)), 0.0, 1.0);
  col = mix(col, vec3f(0.85, 0.88, 0.95) * shade, smoothstep(px, -px, db - BALL_R));
  // the plunger's pull, as a bar filling up the lane under the waiting ball
  if (T.pull.x > 0.0 && p.x > LANE_X + 0.15 && p.x < W - 0.15 && p.y > 0.4 && p.y < 0.4 + T.pull.x * 2.4) {
    col = mix(col, vec3f(1.0, 0.5 + 0.5 * (1.0 - T.pull.x), 0.15), 0.55);
  }
  return vec4f(col, 1);
}
