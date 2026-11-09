// The Lab's paint mixer, in one fullscreen pass: the target as a paint chip, and the cup — a disc
// of paint with a soft sheen, where a new drop arrives as a streak of its own colour and is stirred
// in along a spiral until the cup is one colour again. Side by side on a wide stage, one above the
// other on a tall one.

struct U {
  // canvas size; seconds since the last drop; time
  view: vec4f,
  // the target colour; 1 once matched (`target` is a reserved word in WGSL)
  goal: vec4f,
  // the cup now; 1 if the cup is empty
  cup: vec4f,
  // the cup before the last drop; unused
  before: vec4f,
  // the last drop's own paint; unused
  drop: vec4f,
}

@group(0) @binding(0) var<uniform> u: U;

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

fn rounded_box(p: vec2f, half: vec2f, r: f32) -> f32 {
  let q = abs(p) - half + vec2f(r);
  return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

fn hash(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
}
fn noise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = p - i;
  let w = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2f(1.0, 0.0)), w.x), mix(hash(i + vec2f(0.0, 1.0)), hash(i + vec2f(1.0, 1.0)), w.x), w.y);
}

@fragment
fn paint(in: Cover) -> @location(0) vec4f {
  let size = u.view.xy;
  let since = u.view.z;
  let t = u.view.w;
  let wide = size.x > size.y * 1.15;
  let unit = select(min(size.x * 0.92, size.y * 0.46), min(size.x * 0.46, size.y * 0.92), wide);
  let r = unit * 0.42;
  let chip_c = select(vec2f(size.x * 0.5, size.y * 0.27), vec2f(size.x * 0.27, size.y * 0.5), wide);
  let cup_c = select(vec2f(size.x * 0.5, size.y * 0.73), vec2f(size.x * 0.73, size.y * 0.5), wide);
  let p = in.pos.xy;
  var col = vec3f(0.11, 0.12, 0.15) + 0.03 * (1.0 - p.y / size.y);

  // the target: a paint chip with a white border, ringed green once matched
  let d_chip = rounded_box(p - chip_c, vec2f(r * 0.95), r * 0.12);
  let border = clamp(0.5 - (d_chip - 0.0), 0.0, 1.0);
  col = mix(col, vec3f(0.96), border);
  let inner = clamp(0.5 - (d_chip + r * 0.06), 0.0, 1.0);
  col = mix(col, u.goal.rgb, inner);
  if (u.goal.w > 0.5) {
    col = mix(col, vec3f(0.3, 0.9, 0.5), clamp(3.0 - abs(d_chip - 6.0), 0.0, 1.0));
  }

  // the cup: a rim, then the paint
  let q = (p - cup_c) / r;
  let dr = length(q);
  let rim = clamp((1.08 - dr) * r, 0.0, 1.0);
  col = mix(col, vec3f(0.85, 0.86, 0.9), rim);
  let in_cup = clamp((1.0 - dr) * r, 0.0, 1.0);
  var paint = select(u.cup.rgb, vec3f(0.93), u.cup.w > 0.5);
  if (since < 2.0 && u.cup.w < 0.5) {
    // stirring: a spiral that turns the new colour in from the old, carrying a streak of the drop
    let k = clamp(since / 1.6, 0.0, 1.0);
    let ang = atan2(q.y, q.x) + dr * 7.0 - since * 5.0;
    let swirl = 0.5 + 0.5 * sin(ang * 2.0 + noise(q * 3.0 + vec2f(t * 0.3)) * 3.0);
    let blend = smoothstep(0.0, 1.0, k * 1.6 - swirl * 0.6);
    paint = mix(u.before.rgb, u.cup.rgb, clamp(blend, 0.0, 1.0));
    let streak = clamp(1.0 - abs(sin(ang * 1.0)) * 6.0, 0.0, 1.0) * (1.0 - k);
    paint = mix(paint, u.drop.rgb, streak * 0.8);
  }
  // a soft sheen across the surface, and a little shading at the rim
  let sheen = exp(-length(q - vec2f(-0.35, -0.4)) * 4.0) * 0.25;
  paint = paint * (1.0 - 0.18 * dr * dr) + vec3f(sheen);
  col = mix(col, paint, in_cup);
  return vec4f(col, 1.0);
}
