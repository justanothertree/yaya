// The Lab's colour-vision tool: the picture, fitted to the stage, typical on the left of the divider
// and as the chosen kind of colour vision sees it on the right. The matrix is vision.ts's, applied
// to LINEAR light — the texture holds sRGB bytes, so each pixel is decoded first and encoded after,
// which is where tools that skip the step go wrong (vision.test.ts plants exactly that fault).

struct U {
  // pixels per picture pixel, unused, offset x, offset y
  view: vec4f,
  // picture width, height, split (0..1 across the picture), divider shown (0/1)
  pic: vec4f,
  // the three rows of the matrix
  m0: vec4f,
  m1: vec4f,
  m2: vec4f,
  // the two picked points in picture pixels (negative: none)
  marks: vec4f,
}

@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var pic: texture_2d<f32>;
@group(0) @binding(2) var smp: sampler;

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

fn to_linear(c: vec3f) -> vec3f {
  return select(pow((c + 0.055) / 1.055, vec3f(2.4)), c / 12.92, c <= vec3f(0.04045));
}

fn to_srgb(l: vec3f) -> vec3f {
  let c = clamp(l, vec3f(0.0), vec3f(1.0));
  return select(1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055, 12.92 * c, c <= vec3f(0.0031308));
}

fn ring(p: vec2f, c: vec2f, r: f32, w: f32) -> f32 {
  return 1.0 - smoothstep(w * 0.5, w * 0.5 + 1.0, abs(length(p - c) - r));
}

@fragment
fn view(in: Cover) -> @location(0) vec4f {
  let px = in.pos.xy;
  let size = u.pic.xy;
  let p = (px - u.view.zw) / u.view.x;
  if (p.x < 0.0 || p.y < 0.0 || p.x >= size.x || p.y >= size.y) {
    return vec4f(0.02, 0.02, 0.05, 1.0);
  }
  let uv = p / size;
  let photo = textureSampleLevel(pic, smp, uv, 0.0).rgb;
  var out = photo;
  if (uv.x >= u.pic.z) {
    let l = to_linear(photo);
    out = to_srgb(vec3f(dot(u.m0.xyz, l), dot(u.m1.xyz, l), dot(u.m2.xyz, l)));
  }
  // the divider: a light line with a dark edge, readable on any picture
  if (u.pic.w > 0.5) {
    let dx = abs(px.x - (u.view.z + u.pic.z * size.x * u.view.x));
    out = mix(out, vec3f(0.0), 1.0 - smoothstep(2.0, 3.0, dx));
    out = mix(out, vec3f(1.0), 1.0 - smoothstep(0.5, 1.5, dx));
  }
  // the picked points, A and B: a white ring with a dark one inside
  for (var i = 0; i < 2; i++) {
    let m = select(u.marks.xy, u.marks.zw, i == 1);
    if (m.x < 0.0) { continue; }
    let c = u.view.zw + (m + 0.5) * u.view.x;
    out = mix(out, vec3f(1.0), ring(px, c, 11.0, 3.0));
    out = mix(out, vec3f(0.0), ring(px, c, 8.0, 1.5));
  }
  return vec4f(out, 1.0);
}
