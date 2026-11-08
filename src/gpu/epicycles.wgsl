// The Lab's epicycles. Three passes, all instanced so a pixel only pays for what covers it: a faint
// grid behind; every circle an arm turns in, as a quad drawn as a thin ring; and every line — the
// drawing, the trail the pen has left, the arms themselves — as a quad drawn as a soft capsule,
// ADDED, so where the trail runs over the drawing it glows brighter rather than hiding it.

struct U {
  // canvas size; where (0, 0) of the drawing lands, in pixels
  view: vec4f,
  // pixels per unit of drawing, time, unused ×2
  more: vec4f,
}

@group(0) @binding(0) var<uniform> u: U;
// per line: (x0, y0, x1, y1) then (r, g, b, half-width in pixels)
@group(0) @binding(1) var<storage, read> lines: array<vec4f>;
// per ring: (cx, cy, r, brightness)
@group(0) @binding(2) var<storage, read> rings: array<vec4f>;

const CORNERS = array<vec2f, 6>(
  vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(0.0, 1.0),
  vec2f(0.0, 1.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0),
);

struct Cover {
  @builtin(position) pos: vec4f,
}

@vertex
fn cover(@builtin(vertex_index) i: u32) -> Cover {
  let xy = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  var o: Cover;
  o.pos = vec4f(xy * 2.0 - 1.0, 0.0, 1.0);
  return o;
}

@fragment
fn grid(in: Cover) -> @location(0) vec4f {
  let p = vec2f(in.pos.x - u.view.z, u.view.w - in.pos.y) / u.more.x;
  var col = vec3f(0.03, 0.035, 0.06);
  // a line every quarter unit: the distance to the nearest, in pixels
  let g = abs(fract(p * 4.0 + 0.5) - 0.5) * (u.more.x / 4.0);
  let line = 1.0 - smoothstep(0.0, 1.0, min(g.x, g.y));
  col += vec3f(0.035) * line;
  let axis = 1.0 - smoothstep(0.0, 1.5, min(abs(p.x), abs(p.y)) * u.more.x);
  col += vec3f(0.05) * axis;
  return vec4f(col, 1.0);
}

struct Line {
  @builtin(position) pos: vec4f,
  @location(0) px: vec2f, // this fragment, in pixels
  @location(1) @interpolate(flat) a: vec2f,
  @location(2) @interpolate(flat) b: vec2f,
  @location(3) @interpolate(flat) colour: vec4f,
}

fn to_px(p: vec2f) -> vec2f {
  return vec2f(u.view.z + p.x * u.more.x, u.view.w - p.y * u.more.x);
}

@vertex
fn line_vs(@builtin(vertex_index) i: u32, @builtin(instance_index) j: u32) -> Line {
  let ab = lines[j * 2u];
  let c = lines[j * 2u + 1u];
  let a = to_px(ab.xy);
  let b = to_px(ab.zw);
  // a box round the capsule wide enough to hold its whole halo — a box narrower than the halo cut
  // it off in a visible square round the pen
  let pad = c.w * 5.0 + 4.0;
  let lo = min(a, b) - vec2f(pad);
  let hi = max(a, b) + vec2f(pad);
  let corner = lo + (hi - lo) * CORNERS[i];
  var o: Line;
  o.pos = vec4f(corner.x / u.view.x * 2.0 - 1.0, 1.0 - corner.y / u.view.y * 2.0, 0.0, 1.0);
  o.px = corner;
  o.a = a;
  o.b = b;
  o.colour = c;
  return o;
}

@fragment
fn line_fs(in: Line) -> @location(0) vec4f {
  let ab = in.b - in.a;
  let t = clamp(dot(in.px - in.a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
  let d = length(in.px - in.a - ab * t);
  let w = in.colour.w;
  let core = 1.0 - smoothstep(w - 0.5, w + 0.5, d);
  let glow = exp(-d / (w * 1.5 + 1.0)) * 0.35;
  return vec4f(in.colour.rgb * (core + glow), 1.0);
}

struct Ring {
  @builtin(position) pos: vec4f,
  @location(0) px: vec2f,
  @location(1) @interpolate(flat) c: vec4f, // centre (px), radius (px), brightness
}

@vertex
fn ring_vs(@builtin(vertex_index) i: u32, @builtin(instance_index) j: u32) -> Ring {
  let r = rings[j];
  let c = to_px(r.xy);
  let rad = r.z * u.more.x;
  let lo = c - vec2f(rad + 2.0);
  let hi = c + vec2f(rad + 2.0);
  let corner = lo + (hi - lo) * CORNERS[i];
  var o: Ring;
  o.pos = vec4f(corner.x / u.view.x * 2.0 - 1.0, 1.0 - corner.y / u.view.y * 2.0, 0.0, 1.0);
  o.px = corner;
  o.c = vec4f(c, rad, r.w);
  return o;
}

@fragment
fn ring_fs(in: Ring) -> @location(0) vec4f {
  let d = abs(length(in.px - in.c.xy) - in.c.z);
  let a = (1.0 - smoothstep(0.4, 1.4, d)) * in.c.w;
  return vec4f(vec3f(0.5, 0.6, 0.95) * a, 1.0);
}
