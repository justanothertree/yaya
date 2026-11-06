// Stained glass: lead drawn into a grid, the panes found by labelling, a tap filling a pane, and the
// sun's light through the window onto the floor. See glass.ts.
//
// ⚠️ `Glass` IS PACKED BY HAND IN glass.ts (`GLASS`); glass.test.ts lays it out from here.

struct Glass {
  size: vec2u, // the canvas, in pixels
  grid: vec2u, // the window's cells across and down
  sun: vec2f, // across (−1..1), how high (0..1)
  tap: vec2i, // a cell to fill from, or −1
  colour: vec4f, // what a tap fills with
  dabs: u32,
  brush: f32, // of a lead dab, cells
  floor: f32, // how much of the canvas, from the bottom, is floor
}

@group(0) @binding(0) var<uniform> G: Glass;

const LEAD = 0xffffffffu;

@group(0) @binding(1) var<storage, read_write> lead: array<u32>;
@group(0) @binding(2) var<storage, read> label_in: array<u32>;
@group(0) @binding(3) var<storage, read_write> label_out: array<u32>;
@group(0) @binding(4) var<storage, read_write> colour: array<vec4f>;
@group(0) @binding(5) var<storage, read> dab: array<vec4f>; // x, y, 1 to lay lead / 0 to lift it, -

fn inside(c: vec2i) -> bool {
  return c.x >= 0 && c.y >= 0 && c.x < i32(G.grid.x) && c.y < i32(G.grid.y);
}

fn at(c: vec2i) -> u32 {
  return u32(c.y) * G.grid.x + u32(c.x);
}

@compute @workgroup_size(8, 8)
fn paint(@builtin(global_invocation_id) id: vec3u) {
  let c = vec2i(id.xy);
  if (!inside(c)) {
    return;
  }
  // the frame round the window is always lead
  if (c.x < 2 || c.y < 2 || c.x >= i32(G.grid.x) - 2 || c.y >= i32(G.grid.y) - 2) {
    lead[at(c)] = 1u;
    return;
  }
  for (var k = 0u; k < G.dabs; k++) {
    let d = dab[k];
    if (distance(vec2f(c) + 0.5, d.xy) <= G.brush) {
      lead[at(c)] = u32(d.z);
    }
  }
}

// every glass cell its own label, lead none: where the labelling starts again after the lead moved
@compute @workgroup_size(8, 8)
fn seed(@builtin(global_invocation_id) id: vec3u) {
  let c = vec2i(id.xy);
  if (!inside(c)) {
    return;
  }
  let i = at(c);
  label_out[i] = select(i, LEAD, lead[i] == 1u);
}

fn neighbour(c: vec2i, m: u32) -> u32 {
  if (!inside(c) || lead[at(c)] == 1u) {
    return m;
  }
  return min(m, label_in[at(c)]);
}

// glass.ts `labelPass`: the least label round, then the label that label has
@compute @workgroup_size(8, 8)
fn label(@builtin(global_invocation_id) id: vec3u) {
  let c = vec2i(id.xy);
  if (!inside(c)) {
    return;
  }
  let i = at(c);
  if (lead[i] == 1u) {
    label_out[i] = LEAD;
    return;
  }
  var m = label_in[i];
  m = neighbour(c + vec2i(-1, 0), m);
  m = neighbour(c + vec2i(1, 0), m);
  m = neighbour(c + vec2i(0, -1), m);
  m = neighbour(c + vec2i(0, 1), m);
  m = min(m, label_in[m]);
  label_out[i] = m;
}

// a tap: every cell of the tapped pane takes the colour
@compute @workgroup_size(8, 8)
fn fill(@builtin(global_invocation_id) id: vec3u) {
  let c = vec2i(id.xy);
  if (!inside(c) || !inside(G.tap)) {
    return;
  }
  let want = label_in[at(G.tap)];
  if (want != LEAD && label_in[at(c)] == want) {
    colour[at(c)] = G.colour;
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

@group(0) @binding(6) var<storage, read> shown_lead: array<u32>;
@group(0) @binding(7) var<storage, read> shown_colour: array<vec4f>;

fn hash2(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
}

// how much lead there is round a point of the window (0..1), read between cells so it is smooth
fn lead_at(p: vec2f) -> f32 {
  let f = p - 0.5;
  let c = vec2i(floor(f));
  let t = f - floor(f);
  let g = vec2i(G.grid) - 1;
  let a = f32(shown_lead[at(clamp(c, vec2i(0), g))]);
  let b = f32(shown_lead[at(clamp(c + vec2i(1, 0), vec2i(0), g))]);
  let d = f32(shown_lead[at(clamp(c + vec2i(0, 1), vec2i(0), g))]);
  let e = f32(shown_lead[at(clamp(c + vec2i(1, 1), vec2i(0), g))]);
  return mix(mix(a, b, t.x), mix(d, e, t.x), t.y);
}

// the glass at a point of the window: its colour, and how much light gets through (lead: none)
fn glass_at(p: vec2f) -> vec4f {
  let g = vec2i(G.grid) - 1;
  let c = clamp(vec2i(floor(p)), vec2i(0), g);
  let k = shown_colour[at(c)];
  // unglazed glass is pale and cloudy; coloured glass lets its colour through
  var tint = select(vec3f(0.82, 0.84, 0.8), k.rgb, k.a > 0.5);
  let l = smoothstep(0.35, 0.6, lead_at(p));
  return vec4f(tint, 1.0 - l);
}

@fragment
fn show(px: Px) -> @location(0) vec4f {
  let canvas = vec2f(G.size);
  let window_h = 1.0 - G.floor;
  let sun_bright = 0.55 + 0.6 * G.sun.y;
  if (px.uv.y < window_h) {
    // the window, seen from inside: lit from behind by the sky, brightest where the sun is
    let wuv = vec2f(px.uv.x, px.uv.y / window_h);
    let p = wuv * vec2f(G.grid);
    let gl = glass_at(p);
    // seedy glass: a little ripple and bubble in every pane
    let ripple = 0.93 + 0.07 * sin(p.x * 0.9 + sin(p.y * 0.7) * 2.0) * sin(p.y * 1.1);
    let bubble = smoothstep(0.985, 1.0, hash2(floor(p * 2.0)));
    let sun_at = vec2f(0.5 + 0.45 * G.sun.x, 0.9 - 0.8 * G.sun.y);
    let glow = exp(-dot(wuv - sun_at, wuv - sun_at) * 6.0) * 0.8;
    var c = gl.rgb * (sun_bright * ripple + glow) + bubble * 0.25;
    // lead: dark, with a highlight on its upper edge
    let l = smoothstep(0.35, 0.6, lead_at(p));
    let edge = lead_at(p - vec2f(0.0, 0.6)) - lead_at(p + vec2f(0.0, 0.6));
    let lead_c = vec3f(0.12, 0.12, 0.13) + vec3f(0.25) * max(0.0, -edge);
    c = mix(c, lead_c, l);
    return vec4f(1.0 - exp(-c * 1.3), 1.0);
  }
  // the floor: stone flags in perspective, and the window's light thrown across them
  let t = (px.uv.y - window_h) / G.floor; // 0 at the foot of the window, 1 nearest you
  let depth = 0.12 + t * 1.6; // how far out from the window, in window heights
  let spread = 1.0 + t * 0.8;
  let x = (px.uv.x - 0.5) * spread; // across, in window widths
  // back along the sun's ray from here to the window: it meets the window this high and this far across
  let slope = mix(0.35, 2.4, G.sun.y);
  let hit = vec2f(x + 0.5 - depth * G.sun.x * 0.9 * (canvas.y / canvas.x) * 2.0, 1.0 - depth * slope);
  var light = vec3f(0.0);
  if (hit.x > 0.0 && hit.x < 1.0 && hit.y > 0.0 && hit.y < 1.0) {
    let gl = glass_at(hit * vec2f(G.grid));
    light = gl.rgb * gl.a * (0.4 + 0.7 * G.sun.y);
  }
  let flag = vec2f(x * 6.0, depth * 5.0);
  let joint = min(abs(fract(flag.x) - 0.5), abs(fract(flag.y) - 0.5));
  var stone = vec3f(0.33, 0.31, 0.29) * (0.85 + 0.15 * hash2(floor(flag)));
  stone *= 0.75 + 0.25 * smoothstep(0.0, 0.04, joint);
  let c = stone * (0.5 + light * 1.4) * (0.6 + 0.4 * t);
  return vec4f(1.0 - exp(-c * 2.0), 1.0);
}
