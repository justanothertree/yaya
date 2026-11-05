// A harmonograph: the pen's path, a thread a segment, each walking its own pixels and adding ink
// with integer atomics; then the paper drawn from how much ink each pixel holds. See harmonograph.ts.
//
// ⚠️ `Draw` IS PACKED BY HAND IN harmonograph.ts (`DRAW`); harmonograph.test.ts lays it out from here.

struct Draw {
  size: vec2u, // the canvas, in pixels
  paper: vec2u, // the paper, in pixels
  first: f32, // the time the first segment starts
  dt: f32, // how long a segment lasts
  segments: u32,
  colour: u32, // the ink, 0xRRGGBB
  freq: vec4f, // the four pendulums: two across, two up and down
  phase: vec4f,
  amp: vec4f,
  decay: vec4f,
}

@group(0) @binding(0) var<uniform> D: Draw;
// four channels a pixel: red, green and blue ink, and all the ink
@group(0) @binding(1) var<storage, read_write> ink: array<atomic<u32>>;

const INK = 256u;
const MAX_STEPS = 64u;

// harmonograph.ts `pen`
fn pen(t: f32) -> vec2f {
  // ⚠️ the angle runs to hundreds of radians, and WGSL holds sin to its precision only on −π..π —
  // unwrapped, SwiftShader's pen landed up to a quarter of a step's ink away from the CPU's
  let a = D.freq * t + D.phase;
  let wrapped = a - 6.2831853 * floor(a / 6.2831853 + 0.5);
  let s = D.amp * sin(wrapped) * exp(-D.decay * t);
  let half = f32(min(D.paper.x, D.paper.y)) * 0.5;
  return vec2f(s.x + s.y, s.z + s.w) * half + vec2f(D.paper) * 0.5;
}

fn add(c: vec2i, w: u32) {
  if (w == 0u || c.x < 0 || c.y < 0 || c.x >= i32(D.paper.x) || c.y >= i32(D.paper.y)) {
    return;
  }
  let i = (u32(c.y) * D.paper.x + u32(c.x)) * 4u;
  // harmonograph.ts `inkChannels`
  atomicAdd(&ink[i], w * ((D.colour >> 16u) & 255u) / 255u);
  atomicAdd(&ink[i + 1u], w * ((D.colour >> 8u) & 255u) / 255u);
  atomicAdd(&ink[i + 2u], w * (D.colour & 255u) / 255u);
  atomicAdd(&ink[i + 3u], w);
}

// harmonograph.ts `inkSegment`: a step a pixel, each step's INK shared between the four pixels round it
@compute @workgroup_size(64)
fn draw(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= D.segments) {
    return;
  }
  let t0 = D.first + f32(id.x) * D.dt;
  let a = pen(t0);
  let b = pen(t0 + D.dt);
  let d = abs(b - a);
  let steps = min(MAX_STEPS, max(1u, u32(ceil(max(d.x, d.y)))));
  for (var k = 0u; k < steps; k++) {
    let t = (f32(k) + 0.5) / f32(steps);
    let p = mix(a, b, t) - 0.5;
    let c = vec2i(floor(p));
    let f = p - floor(p);
    let w10 = u32(floor(f32(INK) * f.x * (1.0 - f.y)));
    let w01 = u32(floor(f32(INK) * (1.0 - f.x) * f.y));
    let w11 = u32(floor(f32(INK) * f.x * f.y));
    add(c, INK - w10 - w01 - w11);
    add(c + vec2i(1, 0), w10);
    add(c + vec2i(0, 1), w01);
    add(c + vec2i(1, 1), w11);
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

@group(0) @binding(2) var<storage, read> shown: array<u32>;

@fragment
fn paper(px: Px) -> @location(0) vec4f {
  let c = min(vec2u(px.uv * vec2f(D.paper)), D.paper - 1u);
  let i = (c.y * D.paper.x + c.x) * 4u;
  let total = f32(shown[i + 3u]);
  // the paper: warm, a little grain
  let grain = fract(sin(dot(vec2f(c), vec2f(12.9898, 78.233))) * 43758.5453);
  let sheet = vec3f(0.96, 0.93, 0.85) * (0.97 + 0.03 * grain);
  if (total <= 0.0) {
    return vec4f(sheet, 1.0);
  }
  // the ink's own colour, and how much of the paper it covers — a single pass faint, many dark
  let hue = vec3f(f32(shown[i]), f32(shown[i + 1u]), f32(shown[i + 2u])) / total;
  let cover = 1.0 - exp(-total / f32(INK) * 0.55);
  return vec4f(mix(sheet, hue * 0.85, cover), 1.0);
}
