// The harp's strings, drawn straight from the physics: every point of every string is worked out
// in the vertex shader as the sum of its standing waves since its last pluck — see harp.ts for why
// there is no simulation. Each string is a ribbon of quads a few pixels wide, glowing at the core
// and soft at the edge, added together where they cross.
//
// ⚠️ `Harp` IS PACKED BY HAND IN harp.ts (`HARP`), and `modeAmp` and `displacement` are mirrored
// there; harp.test.ts and the Lab's GPU probe hold the two together.

struct Harp {
  size: vec2u, // the canvas, in pixels
  time: f32,
  count: u32, // strings
  width: f32, // a string's glow, in pixels either side
  modes: u32,
}

@group(0) @binding(0) var<uniform> H: Harp;
// each string: [2i] x, top, bottom, midi · [2i + 1] when it was plucked, where, how hard
@group(0) @binding(1) var<storage, read> strings: array<vec4f>;

const PI = 3.14159265;
const DECAY = 0.9;
const SEGMENTS = 96u;

fn mode_amp(n: f32, where_: f32) -> f32 {
  let p = clamp(where_, 0.02, 0.98);
  return 2.0 * sin(n * PI * p) / (n * n * PI * PI * p * (1.0 - p));
}

fn visual_frequency(midi: f32) -> f32 {
  return 2.2 * pow(2.0, (midi - 60.0) / 24.0);
}

// mirrors `displacement` in harp.ts, in units of the pluck's height
fn displacement(i: u32, s: f32) -> f32 {
  let pl = strings[2u * i + 1u];
  let since = H.time - pl.x;
  if (pl.z <= 0.0 || since < 0.0) {
    return 0.0;
  }
  let w = visual_frequency(strings[2u * i].w) * 2.0 * PI;
  var y = 0.0;
  for (var k = 1u; k <= H.modes; k++) {
    let n = f32(k);
    y += mode_amp(n, pl.y) * sin(n * PI * s) * cos(n * w * since) * exp(-DECAY * n * since);
  }
  return y * pl.z;
}

struct Px {
  @builtin(position) clip: vec4f,
  @location(0) across: f32,
  @location(1) colour: vec3f,
}

fn hue(h: f32) -> vec3f {
  return 0.5 + 0.5 * cos(6.2831853 * (h + vec3f(0.0, 0.33, 0.67)));
}

@vertex
fn string(@builtin(vertex_index) v: u32) -> Px {
  let i = v / (SEGMENTS * 6u);
  let seg = (v / 6u) % SEGMENTS;
  let corner = array<vec2u, 6>(vec2u(0u, 0u), vec2u(1u, 0u), vec2u(0u, 1u), vec2u(1u, 0u), vec2u(1u, 1u), vec2u(0u, 1u));
  let c = corner[v % 6u];
  let s = f32(seg + c.x) / f32(SEGMENTS);
  let side = f32(c.y) * 2.0 - 1.0;
  let a = strings[2u * i];
  let pl = strings[2u * i + 1u];
  // a pluck of strength 1 pulls the string aside by a tenth of the gap to its neighbour's spot
  let pull = min(f32(H.size.x) / f32(max(H.count, 2u)), 120.0) * 0.45;
  let x = a.x + displacement(i, s) * pull + side * H.width;
  let y = mix(a.y, a.z, s);
  var o: Px;
  o.clip = vec4f(x / f32(H.size.x) * 2.0 - 1.0, 1.0 - y / f32(H.size.y) * 2.0, 0.0, 1.0);
  o.across = side;
  // the string's colour runs round the wheel from low to high; it brightens while it rings
  let since = H.time - pl.x;
  let ring = select(0.0, pl.z * exp(-DECAY * since), pl.z > 0.0 && since >= 0.0);
  o.colour = hue(f32(i) / f32(max(H.count, 1u)) * 0.8 + 0.55) * (0.35 + 2.2 * ring);
  return o;
}

@fragment
fn glow(px: Px) -> @location(0) vec4f {
  // a bright core and a soft halo, in one quad
  let d = abs(px.across);
  let core = exp(-d * d * 60.0);
  let halo = exp(-d * d * 4.0) * 0.35;
  let a = core + halo;
  return vec4f(px.colour * a, a);
}
