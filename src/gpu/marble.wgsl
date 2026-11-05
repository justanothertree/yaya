// Paper marbling: ink floated on water and pulled into patterns, after Aubrey Jaffer's
// "Mathematical Marbling". Every action is an exact warp of the whole tray, done as one pass that
// reads the paper and writes it moved — and every warp is written INVERTED, asking for each pixel
// "where did the ink that is here now come from?", so nothing tears and nothing is left blank.
//
// Both warps keep area, as ink on water does: a drop pushes the ink round it outward to make room
// and loses none of it, and a tine shears ink along its stroke without thinning it. marble.test.ts
// and the Lab's GPU probe hold the shader to that.
//
// Coordinates are CENTRED, as the kaleidoscope's: y from -0.5 (top) to 0.5, x as far as the
// aspect allows, so a drop is round on any screen.
//
// ⚠️ `Marble` IS PACKED BY HAND IN marble.ts (`MARBLE`); marble.test.ts lays it out from here.

struct Marble {
  color: vec4f, // a drop's ink
  a: vec2f, // a drop's centre, or where a stroke starts
  b: vec2f, // where a stroke ends
  aspect: f32,
  radius: f32, // a drop's radius
  sharp: f32, // a tine's reach: how far from its line the pull is felt
  spacing: f32, // between a comb's tines; 0 for a single stylus
  op: u32, // 1 drop, 2 stroke
}

@group(0) @binding(0) var<uniform> M: Marble;
@group(0) @binding(1) var lin: sampler;
@group(0) @binding(2) var paper: texture_2d<f32>;

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
  return vec2f((uv.x - 0.5) * M.aspect, uv.y - 0.5);
}

// mirrored in marble.ts as PAPER; marble.test.ts checks the two agree
const PAPER = vec3f(0.95, 0.92, 0.84);

// The paper at a centred point. ⚠️ PAST THE TRAY'S EDGE IS CLEAN PAPER, not the edge's own colour:
// a stroke drags in whatever lies beyond the edge, and clamping there smeared the last column of
// ink inward as a solid block. Real marbling pulls clean water in from outside.
fn at(c: vec2f) -> vec4f {
  let uv = vec2f(c.x / M.aspect + 0.5, c.y + 0.5);
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0))) {
    return vec4f(PAPER, 1.0);
  }
  return textureSampleLevel(paper, lin, uv, 0.0);
}

// One action, applied to the whole tray.
@fragment
fn act(p: Px) -> @location(0) vec4f {
  let q = centred(p.uv);
  if (M.op == 1u) {
    // A drop at a pushes everything outward so that p lands at a + (p - a)·√(1 + r²/|p - a|²).
    // Inverted: inside the drop is the new ink; outside, the ink came from √(1 - r²/|q - a|²) of
    // the way out — which is exactly area-preserving, since the ring between |p| and |q| holds r².
    let d = q - M.a;
    let d2 = dot(d, d);
    let r2 = M.radius * M.radius;
    if (d2 <= r2) {
      return M.color;
    }
    return at(M.a + d * sqrt(1.0 - r2 / d2));
  }
  // A stroke from a to b drags ink along it by z = |b - a| · λ / (dist + λ): the full length of
  // the stroke right on the line, falling off with distance from it. A shear along m keeps area,
  // because it moves each point PARALLEL to the line, never towards or away from it.
  let ab = M.b - M.a;
  let len = length(ab);
  if (len < 1e-6) {
    return at(q);
  }
  let m = ab / len;
  var dist: f32;
  if (M.spacing > 0.0) {
    // a comb: tines spaced right across the tray, so distance is to the nearest one — and the
    // comb is infinitely long, as a real one reaches across the whole tray
    let across = abs(dot(q - M.a, vec2f(-m.y, m.x)));
    let s = M.spacing;
    dist = s * 0.5 - abs(s * 0.5 - (across % s));
  } else {
    // a stylus: one point dragged through the ink, so distance is to the stroke itself
    let t = clamp(dot(q - M.a, m), 0.0, len);
    dist = length(q - (M.a + m * t));
  }
  let z = len * M.sharp / (dist + M.sharp);
  return at(q - m * z);
}

// The paper as it is seen: the ink, with a faint grain so it reads as paper rather than a screen.
@fragment
fn show(p: Px) -> @location(0) vec4f {
  let c = textureSampleLevel(paper, lin, p.uv, 0.0).rgb;
  let grain = fract(sin(dot(floor(p.clip.xy), vec2f(12.9898, 78.233))) * 43758.5453) - 0.5;
  return vec4f(c * (1.0 + grain * 0.035), 1.0);
}
