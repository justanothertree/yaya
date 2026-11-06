// A jelly picture: every vertex of a mesh over the picture works out its own move from the handles
// (moving least squares), then the mesh is drawn with the picture on it. See squish.ts.
//
// ⚠️ `Squish` IS PACKED BY HAND IN squish.ts (`SQUISH`); squish.test.ts lays it out from here.

struct Squish {
  size: vec2u, // the canvas, in pixels
  grid: vec2u, // the mesh's vertices across and down
  image: vec2u, // the picture, in pixels
  handles: u32, // how many handles: the pins first, then the fingers and the wobbling
  mode: u32, // 0 rigid, 1 stretchy
  pins: u32, // how many of the handles are pins
}

@group(0) @binding(0) var<uniform> S: Squish;
@group(0) @binding(1) var<storage, read> handle: array<vec4f>; // p.xy where it was, q.zw where it is held

// mirrored in squish.ts (`deform`)
fn deform(v: vec2f) -> vec2f {
  let n = S.handles;
  if (n == 0u) {
    return v;
  }
  var sw = 0.0;
  var ps = vec2f(0.0);
  var qs = vec2f(0.0);
  for (var i = 0u; i < n; i++) {
    let h = handle[i];
    let d = h.xy - v;
    let d2 = dot(d, d);
    if (d2 < 1e-12) {
      return h.zw;
    }
    let w = 1.0 / d2;
    sw += w;
    ps += w * h.xy;
    qs += w * h.zw;
  }
  ps /= sw;
  qs /= sw;
  let dv = v - ps;
  if (n == 1u) {
    return v + qs - ps;
  }
  if (S.mode == 1u) {
    var a11 = 0.0;
    var a12 = 0.0;
    var a22 = 0.0;
    var b11 = 0.0;
    var b12 = 0.0;
    var b21 = 0.0;
    var b22 = 0.0;
    for (var i = 0u; i < n; i++) {
      let h = handle[i];
      let d = h.xy - v;
      let w = 1.0 / dot(d, d);
      let u = h.xy - ps;
      let s = h.zw - qs;
      a11 += w * u.x * u.x;
      a12 += w * u.x * u.y;
      a22 += w * u.y * u.y;
      b11 += w * u.x * s.x;
      b12 += w * u.x * s.y;
      b21 += w * u.y * s.x;
      b22 += w * u.y * s.y;
    }
    let det = a11 * a22 - a12 * a12;
    if (abs(det) < 1e-9) {
      return v + qs - ps;
    }
    let i11 = a22 / det;
    let i12 = -a12 / det;
    let i22 = a11 / det;
    let m11 = i11 * b11 + i12 * b21;
    let m12 = i11 * b12 + i12 * b22;
    let m21 = i12 * b11 + i22 * b21;
    let m22 = i12 * b12 + i22 * b22;
    return vec2f(dv.x * m11 + dv.y * m21, dv.x * m12 + dv.y * m22) + qs;
  }
  var dt = 0.0;
  var cr = 0.0;
  for (var i = 0u; i < n; i++) {
    let h = handle[i];
    let d = h.xy - v;
    let w = 1.0 / dot(d, d);
    let u = h.xy - ps;
    let s = h.zw - qs;
    dt += w * dot(u, s);
    cr += w * (u.x * s.y - u.y * s.x);
  }
  let l = length(vec2f(dt, cr));
  var c = 1.0;
  var sn = 0.0;
  if (l > 1e-12) {
    c = dt / l;
    sn = cr / l;
  }
  return vec2f(c * dv.x - sn * dv.y, sn * dv.x + c * dv.y) + qs;
}

fn rest(i: u32) -> vec2f {
  let g = vec2f(f32(i % S.grid.x), f32(i / S.grid.x)) / vec2f(S.grid - 1u);
  return g * vec2f(S.image);
}

@group(0) @binding(2) var<storage, read_write> bent: array<vec2f>;

@compute @workgroup_size(64)
fn bend(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= S.grid.x * S.grid.y) {
    return;
  }
  bent[id.x] = deform(rest(id.x));
}

// ---- drawing

@group(0) @binding(3) var<storage, read> shown: array<vec2f>;
@group(0) @binding(4) var picture: texture_2d<f32>;
@group(0) @binding(5) var lin: sampler;

// the picture fitted into the middle of the canvas, with room round it to be pulled into
fn to_clip(p: vec2f) -> vec4f {
  let canvas = vec2f(S.size);
  let img = vec2f(S.image);
  let scale = min(canvas.x / img.x, canvas.y / img.y) * 0.78;
  let at = (p - img * 0.5) * scale + canvas * 0.5;
  return vec4f(at.x / canvas.x * 2.0 - 1.0, 1.0 - at.y / canvas.y * 2.0, 0.0, 1.0);
}

struct Vx {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn mesh(@builtin(vertex_index) v: u32) -> Vx {
  let quad = v / 6u;
  let k = v % 6u;
  let gx = S.grid.x - 1u;
  let q = vec2u(quad % gx, quad / gx);
  let off = array<vec2u, 6>(vec2u(0u, 0u), vec2u(1u, 0u), vec2u(0u, 1u), vec2u(1u, 0u), vec2u(1u, 1u), vec2u(0u, 1u));
  let g = q + off[k];
  let i = g.y * S.grid.x + g.x;
  var o: Vx;
  o.clip = to_clip(shown[i]);
  o.uv = vec2f(g) / vec2f(S.grid - 1u);
  return o;
}

@fragment
fn paint(px: Vx) -> @location(0) vec4f {
  return vec4f(textureSample(picture, lin, px.uv).rgb, 1.0);
}

struct Dot {
  @builtin(position) clip: vec4f,
  @location(0) at: vec2f,
  @location(1) @interpolate(flat) pin: u32,
}

// a marker at every handle: a red pin, or a soft ring where a finger holds the jelly
@vertex
fn marker(@builtin(vertex_index) v: u32, @builtin(instance_index) n: u32) -> Dot {
  let corner = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));
  let c = corner[v % 6u];
  let clip = to_clip(handle[n].zw);
  let r = 14.0 / vec2f(S.size) * 2.0;
  var o: Dot;
  o.clip = vec4f(clip.xy + c * r, 0.0, 1.0);
  o.at = c;
  o.pin = select(0u, 1u, n < S.pins);
  return o;
}

@fragment
fn dot_colour(px: Dot) -> @location(0) vec4f {
  let d = length(px.at);
  if (px.pin == 1u) {
    let a = 1.0 - smoothstep(0.45, 0.6, d);
    let c = mix(vec3f(0.85, 0.12, 0.2), vec3f(1.0, 0.6, 0.6), 1.0 - smoothstep(0.0, 0.25, length(px.at + vec2f(0.15, 0.15))));
    return vec4f(c * a, a);
  }
  let ring = smoothstep(0.55, 0.7, d) * (1.0 - smoothstep(0.85, 1.0, d));
  return vec4f(vec3f(1.0) * ring * 0.8, ring * 0.8);
}
