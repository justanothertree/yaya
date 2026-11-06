// Night crossing. `remember` keeps a map of the channel, a few texels a unit, each the brightest it
// has been lit lately: the beam's light now (`light`, the same as lightAt in crossing.ts: in range,
// inside the beam, no rock between it and the lamp), or what was there before, fading. It runs only
// over the rows near the boat. `show` draws the night from that map: black water and shore where
// nothing is lit, the beam's haze and the shadows rocks throw, rocks only where they are lit or
// remembered, the buoys' own small lights, the boat, and the harbour's lamps at the far end.

struct Night {
  size: vec2u,
  map: vec2u,
  cam: vec4f,
  lamp: vec4f,
  boat: vec4f,
  rows: vec2u,
  rocks: u32,
  buoys: u32,
  time: f32,
  length: f32,
  fade: f32,
}

const WIDE = 12.0;
const PER = 6.0;
const NARROW = 0.16;
const WIDE_HALF = 0.75;
const NARROW_RANGE = 13.0;
const WIDE_RANGE = 5.5;
const BOAT_R = 0.35;

@group(0) @binding(0) var<uniform> N: Night;
@group(0) @binding(1) var<storage, read> rocks: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> seen: array<f32>;
@group(0) @binding(3) var<storage, read> buoys: array<vec4f>;

fn blocked(a: vec2f, b: vec2f) -> bool {
  let d = b - a;
  let len2 = max(dot(d, d), 1e-9);
  for (var k = 0u; k < N.rocks; k++) {
    let r = rocks[k];
    let t = clamp(dot(r.xy - a, d) / len2, 0.0, 1.0);
    let c = a + d * t - r.xy;
    let end = distance(b, r.xy) < r.z;
    if (!end && dot(c, c) < (r.z * 0.98) * (r.z * 0.98)) {
      return true;
    }
  }
  return false;
}

/** lightAt in crossing.ts, line for line */
fn light(p: vec2f) -> f32 {
  let w = clamp(N.lamp.w, 0.0, 1.0);
  let half_ = NARROW + (WIDE_HALF - NARROW) * w;
  let range = NARROW_RANGE + (WIDE_RANGE - NARROW_RANGE) * w;
  let d = distance(p, N.lamp.xy);
  if (d < 1e-6) {
    return 1.0;
  }
  if (d > range) {
    return 0.0;
  }
  let v = p - N.lamp.xy;
  var off = atan2(v.y, v.x) - N.lamp.z;
  off = atan2(sin(off), cos(off));
  if (abs(off) > half_) {
    return 0.0;
  }
  if (blocked(N.lamp.xy, p)) {
    return 0.0;
  }
  let axis = 1.0 - (abs(off) / half_) * (abs(off) / half_);
  let fall = 1.0 - (d / range) * (d / range);
  return max(0.0, axis * fall);
}

/** a texel of the map to the channel: texel centres, PER a unit */
fn texel_at(c: vec2u) -> vec2f {
  return (vec2f(c) + 0.5) / PER;
}

@compute @workgroup_size(8, 8)
fn remember(@builtin(global_invocation_id) id: vec3u) {
  let x = id.x;
  let y = id.y + N.rows.x;
  if (x >= N.map.x || id.y >= N.rows.y || y >= N.map.y) {
    return;
  }
  let i = y * N.map.x + x;
  seen[i] = max(seen[i] * N.fade, light(texel_at(vec2u(x, y))));
}

// ---------------------------------------------------------------- drawing

@vertex
fn cover(@builtin(vertex_index) v: u32) -> @builtin(position) vec4f {
  let p = array(vec2f(-1, -3), vec2f(3, 1), vec2f(-1, 1))[v];
  return vec4f(p, 0, 1);
}

/** a pixel to the channel: the camera at cam.xy, the stage's height cam.z units, y up (toWorld) */
fn to_world(pos: vec2f) -> vec3f {
  let size = vec2f(N.size);
  let k = N.cam.z / size.y;
  return vec3f(N.cam.x + (pos.x - size.x * 0.5) * k, N.cam.y - (pos.y - size.y * 0.5) * k, k);
}

/** the memory map, read between texels */
fn seen_at(p: vec2f) -> f32 {
  let q = p * PER - 0.5;
  let c = vec2i(floor(q));
  let f = q - floor(q);
  let mx = i32(N.map.x) - 1;
  let my = i32(N.map.y) - 1;
  let x0 = clamp(c.x, 0, mx);
  let x1 = clamp(c.x + 1, 0, mx);
  let y0 = clamp(c.y, 0, my);
  let y1 = clamp(c.y + 1, 0, my);
  let w = i32(N.map.x);
  let a = mix(seen[y0 * w + x0], seen[y0 * w + x1], f.x);
  let b = mix(seen[y1 * w + x0], seen[y1 * w + x1], f.x);
  return mix(a, b, f.y);
}

@fragment
fn show(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let wp = to_world(pos.xy);
  let p = wp.xy;
  let px = wp.z;
  let s = select(0.0, seen_at(p), p.x > -2.0 && p.x < WIDE + 2.0 && p.y > -2.0);
  // the water: black, with swell the light picks out
  let swell = 0.5 + 0.5 * sin(p.x * 3.1 + sin(p.y * 1.7 + N.time * 0.8) * 1.6 + N.time * 0.6);
  var col = vec3f(0.004, 0.008, 0.02) + vec3f(0.12, 0.2, 0.3) * s * (0.55 + 0.45 * swell);
  // the shore either side, dark rock, lit like the rocks
  if (p.x < 0.0 || p.x > WIDE) {
    col = vec3f(0.02, 0.02, 0.025) + vec3f(0.3, 0.28, 0.25) * s;
  }
  // rocks: seen only where lit or remembered
  for (var k = 0u; k < N.rocks; k++) {
    let r = rocks[k];
    let d = distance(p, r.xy) - r.z;
    if (d < px) {
      let grain = 0.85 + 0.15 * sin(distance(p, r.xy) * 9.0 + r.x * 7.0) * cos(atan2(p.y - r.y, p.x - r.x) * 5.0);
      let rock = vec3f(0.55, 0.52, 0.48) * grain * (0.012 + s * 1.1);
      col = mix(col, rock, smoothstep(px, -px, d));
      // white water round a rock, where it can be seen
      col += vec3f(0.5, 0.6, 0.7) * smoothstep(0.25, 0.0, abs(d - 0.08)) * s * 0.35;
    }
  }
  // the buoys: each its own small light, blinking; gold once rung
  for (var k = 0u; k < N.buoys; k++) {
    let b = buoys[k];
    let d = distance(p, b.xy);
    let blink = select(0.35 + 0.65 * step(0.5, fract(N.time * 0.8 + f32(k) * 0.37)), 1.0, b.z > 0.5);
    let tint = select(vec3f(1.0, 0.25, 0.2), vec3f(1.0, 0.8, 0.3), b.z > 0.5);
    col += tint * (smoothstep(0.16, 0.0, d) + exp(-d * 2.5) * 0.25) * blink;
  }
  // the harbour: a row of warm lamps across the far end, and its quay
  let home = N.length;
  if (abs(p.y - home - 0.6) < 0.25) {
    col = mix(col, vec3f(0.25, 0.2, 0.15), 0.8);
  }
  let lamps = fract(p.x / 1.5) - 0.5;
  let dl = length(vec2f(lamps * 1.5, p.y - home - 1.0));
  col += vec3f(1.0, 0.75, 0.35) * (smoothstep(0.12, 0.0, dl) + exp(-dl * 1.8) * 0.15);
  // the boat: a hull pointing its heading, with a deck lamp; red while shaken from a hit
  let bo = N.boat;
  let fwd = vec2f(cos(bo.z), sin(bo.z));
  let side = vec2f(-fwd.y, fwd.x);
  let q = vec2f(dot(p - bo.xy, fwd), dot(p - bo.xy, side));
  let hull = length(vec2f(q.x / (BOAT_R * 1.3), q.y / (BOAT_R * 0.6))) - 1.0;
  let tint = mix(vec3f(0.85, 0.82, 0.75), vec3f(1.0, 0.25, 0.2), clamp(bo.w, 0.0, 1.0));
  col = mix(col, tint, smoothstep(px * 2.0, -px * 2.0, hull * BOAT_R));
  col += vec3f(1.0, 0.9, 0.6) * exp(-distance(p, bo.xy) * 3.0) * 0.25;
  return vec4f(col, 1);
}
