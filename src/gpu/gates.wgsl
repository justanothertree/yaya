// The Lab's logic gates. A fullscreen pass lays a dotted board; an instanced pass draws every shape
// over it, blended — wires as soft capsules that glow when they carry a 1, gates as labelled boxes
// (a small ring on the output of the inverting ones), switches and lamps, and the pins. The words
// come from an atlas the browser's own font drew, one label to a cell four times wider than tall.

struct U {
  // canvas size; the board's corner, in pixels
  view: vec4f,
  // pixels per unit, time, labels in the atlas, unused
  more: vec4f,
}

@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> shapes: array<vec4f>;
@group(0) @binding(2) var atlas: texture_2d<f32>;
@group(0) @binding(3) var smp: sampler;

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
fn board(in: Cover) -> @location(0) vec4f {
  let s = u.more.x;
  let g = (in.pos.xy - u.view.zw) / s;
  var col = vec3f(0.055, 0.065, 0.09);
  if (g.x >= 0.0 && g.y >= 0.0 && g.x <= 22.0 && g.y <= 12.0) {
    col = vec3f(0.075, 0.085, 0.115);
    let d = length((fract(g) - 0.5)) * s;
    col += vec3f(0.06) * clamp(1.6 - d, 0.0, 1.0);
  }
  return vec4f(col, 1.0);
}

const CORNERS = array<vec2f, 6>(
  vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(0.0, 1.0),
  vec2f(0.0, 1.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0),
);

struct Shape {
  @builtin(position) pos: vec4f,
  @location(0) p: vec2f, // board units
  @location(1) @interpolate(flat) a: vec4f,
  @location(2) @interpolate(flat) b: vec4f,
  @location(3) @interpolate(flat) c: vec4f,
}

@vertex
fn shape_vs(@builtin(vertex_index) i: u32, @builtin(instance_index) j: u32) -> Shape {
  let a = shapes[j * 3u];
  let b = shapes[j * 3u + 1u];
  let c = shapes[j * 3u + 2u];
  var lo: vec2f;
  var hi: vec2f;
  let pad = 0.6;
  if (a.x == 0.0) {
    lo = min(a.yz, b.xy) - vec2f(a.w + pad);
    hi = max(a.yz, b.xy) + vec2f(a.w + pad);
  } else if (a.x == 2.0) {
    lo = a.yz - vec2f(a.w + pad);
    hi = a.yz + vec2f(a.w + pad);
  } else {
    lo = a.yz - vec2f(pad);
    hi = a.yz + vec2f(a.w, b.x) + vec2f(pad);
  }
  let p = lo + (hi - lo) * CORNERS[i];
  let px = u.view.zw + p * u.more.x;
  var o: Shape;
  o.pos = vec4f(px.x / u.view.x * 2.0 - 1.0, 1.0 - px.y / u.view.y * 2.0, 0.0, 1.0);
  o.p = p;
  o.a = a;
  o.b = b;
  o.c = c;
  return o;
}

fn rounded_box(p: vec2f, lo: vec2f, size: vec2f, r: f32) -> f32 {
  let half = size * 0.5;
  let q = abs(p - (lo + half)) - half + vec2f(r);
  return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

/** coverage of label k, written across a box: centred, `h` units tall */
fn label(k: f32, p: vec2f, centre: vec2f, h: f32) -> f32 {
  let w = h * 4.0;
  let f = (p - centre) / vec2f(w, h) + 0.5;
  if (k < 0.0 || any(f < vec2f(0.0)) || any(f > vec2f(1.0))) {
    return 0.0;
  }
  return textureSampleLevel(atlas, smp, vec2f((k + f.x) / u.more.z, f.y), 0.0).a;
}

const ON = vec3f(0.35, 0.95, 0.6);
const OFF = vec3f(0.36, 0.4, 0.48);
const ACCENT = vec3f(0.35, 0.6, 1.0);

@fragment
fn shape_fs(in: Shape) -> @location(0) vec4f {
  let s = u.more.x;
  let a = in.a;
  let b = in.b;
  let c = in.c;
  let p = in.p;
  let on = b.w > 0.5;
  var col = vec3f(0.0);
  var alpha = 0.0;
  if (a.x == 0.0) {
    // a wire: a capsule, and a soft glow when it carries a 1
    let pa = p - a.yz;
    let ba = b.xy - a.yz;
    let t = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
    let d = length(pa - ba * t) * s;
    let w = a.w * s;
    let core = clamp(w - d + 0.5, 0.0, 1.0);
    var tone = select(OFF, ON, on);
    if (c.y > 0.5) {
      tone = mix(tone, ACCENT, 0.6);
    }
    // the glow must be gone before the edge of this segment's box (0.6 units out), or every
    // segment draws a faint rectangle where its glow is cut off
    let reach = 0.6 * s;
    let glow = select(0.0, exp(-d / max(w * 2.5, 2.0)) * 0.45 * (1.0 - smoothstep(reach * 0.45, reach * 0.9, d)), on);
    // a 1 travels along the wire: a slow ripple, left to right
    let ripple = select(0.0, 0.25 * (0.5 + 0.5 * sin((b.z - u.more.y * 0.6) * 18.0)), on);
    col = tone * (1.0 + ripple);
    alpha = max(core, glow);
  } else if (a.x == 1.0) {
    // a gate: a box with its kind written on it, edged by what it puts out
    let d = rounded_box(p, a.yz, vec2f(a.w, b.x), 0.25) * s;
    let fill = clamp(0.5 - d, 0.0, 1.0);
    let edge = clamp(1.6 - abs(d + 1.0), 0.0, 1.0);
    col = vec3f(0.14, 0.16, 0.22);
    col = mix(col, select(OFF, ON, on), edge);
    if (c.y > 0.5) {
      col = mix(col, ACCENT, clamp(2.2 - abs(d + 1.2), 0.0, 1.0));
    }
    col = mix(col, vec3f(0.94, 0.95, 0.98), label(c.x, p, a.yz + vec2f(a.w, b.x) * 0.5, 0.55));
    alpha = fill;
    if (b.y > 0.5) {
      // the ring that says "inverted"
      let ring = (length(p - (a.yz + vec2f(a.w + 0.12, b.x * 0.5))) - 0.13) * s;
      let r = clamp(1.2 - abs(ring), 0.0, 1.0);
      col = mix(col, select(OFF, ON, on), r * (1.0 - fill));
      alpha = max(alpha, r);
    }
  } else if (a.x == 2.0) {
    // a pin: filled by its value; an input with no wire is a hollow ring; the landing pin glows
    let d = (length(p - a.yz) - a.w) * s;
    let fill = clamp(0.5 - d, 0.0, 1.0);
    col = select(vec3f(0.55, 0.58, 0.66), ON, on);
    alpha = fill;
    if ((u32(c.y) & 1u) != 0u) {
      col = vec3f(0.98, 0.65, 0.25);
      alpha = clamp(1.4 - abs(d + 1.4), 0.0, 1.0);
    }
    if ((u32(c.y) & 2u) != 0u) {
      let halo = clamp(2.0 - abs(d - 3.0), 0.0, 1.0);
      col = mix(col, ACCENT, halo);
      alpha = max(alpha, halo);
    }
  } else {
    // a switch (b.y 0) or a lamp (b.y 1): a box filled when on, with its name
    let d = rounded_box(p, a.yz, vec2f(a.w, b.x), 0.3) * s;
    let fill = clamp(0.5 - d, 0.0, 1.0);
    let lamp = b.y > 0.5;
    let lit = select(vec3f(0.2, 0.62, 0.38), vec3f(0.98, 0.8, 0.25), lamp);
    col = select(vec3f(0.17, 0.19, 0.25), lit, on);
    col = mix(col, vec3f(0.55, 0.58, 0.66), clamp(1.4 - abs(d + 0.9), 0.0, 1.0));
    if (c.y > 0.5) {
      col = mix(col, vec3f(0.95, 0.25, 0.25), clamp(2.4 - abs(d + 1.4), 0.0, 1.0));
    }
    let ink = select(vec3f(0.93, 0.94, 0.97), vec3f(0.08, 0.08, 0.1), on);
    col = mix(col, ink, label(c.x, p, a.yz + vec2f(a.w, b.x) * 0.5, 0.5));
    alpha = fill;
  }
  return vec4f(col * alpha, alpha);
}
