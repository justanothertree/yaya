// Kaleidoscope: strokes are painted as they were drawn into one fading texture, and the screen
// samples that texture at every turn of the symmetry — so whatever you draw appears in every
// wedge at once, and drawing across a wedge's edge just works, because nothing was folded.
//
// Coordinates are CENTRED: (0, 0) is the middle of the canvas, y runs -0.5 (top) to 0.5, and x as
// far as the aspect allows — so a turn about the origin is a turn about the middle of the screen.
//
// ⚠️ `Kaleido` IS PACKED BY HAND IN kaleido.ts (`KALEIDO`); kaleido.test.ts lays it out from here.

struct Kaleido {
  a: vec2f, // the stroke this frame runs from a…
  b: vec2f, // …to b (equal for a dab)
  color: vec4f,
  aspect: f32,
  radius: f32, // the brush, in the same centred units
  fade: f32, // how much of the painting survives this frame
  n: u32, // how many turns of symmetry
  mirror: u32, // 1 to reflect each wedge as well, as a real kaleidoscope's mirrors do
  drawing: u32, // 1 when a stroke is to be painted this frame
}

@group(0) @binding(0) var<uniform> K: Kaleido;
@group(0) @binding(1) var lin: sampler;
@group(0) @binding(2) var prev: texture_2d<f32>;

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

fn centred(uv: vec2f) -> vec2f {
  return vec2f((uv.x - 0.5) * K.aspect, uv.y - 0.5);
}

// The painting at a centred point, and nothing outside the canvas: clamping to the edge would
// smear the border into every wedge that reaches past it.
fn painted(c: vec2f) -> vec3f {
  let uv = vec2f(c.x / K.aspect + 0.5, c.y + 0.5);
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0))) {
    return vec3f(0.0);
  }
  return textureSampleLevel(prev, lin, uv, 0.0).rgb;
}

// distance from p to the segment a–b
fn to_segment(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let ab = b - a;
  let t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-9), 0.0, 1.0);
  return length(p - (a + ab * t));
}

// The painting, one frame on: what was there, faded, with this frame's stroke laid over it.
@fragment
fn paint(p: Px) -> @location(0) vec4f {
  let c = centred(p.uv);
  let old = textureSampleLevel(prev, lin, p.uv, 0.0).rgb * K.fade;
  if (K.drawing == 0u) {
    return vec4f(old, 1.0);
  }
  let d = to_segment(c, K.a, K.b);
  let ink = smoothstep(K.radius, K.radius * 0.35, d);
  // max, not add: crossing your own stroke keeps its colour rather than burning to white
  return vec4f(max(old, K.color.rgb * ink), 1.0);
}

// The screen: the painting seen at every turn, and in every mirror, at once.
@fragment
fn show(p: Px) -> @location(0) vec4f {
  let c = centred(p.uv);
  let step = 6.2831853 / f32(K.n);
  var col = vec3f(0.0);
  for (var k = 0u; k < K.n; k++) {
    let s = sin(step * f32(k));
    let q = cos(step * f32(k));
    let r = vec2f(c.x * q - c.y * s, c.x * s + c.y * q);
    col = max(col, painted(r));
    if (K.mirror == 1u) {
      col = max(col, painted(vec2f(r.x, -r.y)));
    }
  }
  let bg = vec3f(0.02, 0.02, 0.05);
  return vec4f(bg + col * (1.0 - bg), 1.0);
}
