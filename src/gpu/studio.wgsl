// The studio: a progressive path tracer. Every frame each pixel traces `spp` more paths through
// the scene — spheres, boxes and capsules (an actor is a dozen of them), a floor and a back wall,
// and up to three round lamps — and adds what they bring back to a running sum; the picture is the
// sum over the count, so it starts noisy and settles. Light is gathered by sampling each lamp
// directly at every diffuse bounce (next-event estimation) and by following the bounce; a thin lens
// gives depth of field. Nothing is precomputed: move anything and the sum starts again.

struct Shot {
  size: vec2u,
  frame: u32,
  spp: u32,
  eye: vec4f,
  fwd: vec4f,
  right: vec4f,
  up: vec4f,
  sky: vec4f,
  floor: vec4f,
  lamp0: vec4f,
  lamp1: vec4f,
  lamp2: vec4f,
  glow0: vec4f,
  glow1: vec4f,
  glow2: vec4f,
}

@group(0) @binding(0) var<uniform> P: Shot;
@group(0) @binding(1) var<storage, read> prims: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> sum: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> ids: array<i32>;
@group(0) @binding(4) var<storage, read> shown: array<vec4f>;

const PI = 3.14159265;
const FAR = 1e9;
/** what a pixel's first hit is, in `ids`: a thing's index, or one of these */
const ID_NONE = -1;
const ID_LAMP = 1000;
const ID_FLOOR = 2000;
const ID_WALL = 3000;

// ---------------------------------------------------------------- randomness

var<private> seed: u32;
fn rnd() -> f32 {
  seed = seed * 747796405u + 2891336453u;
  var w = ((seed >> ((seed >> 28u) + 4u)) ^ seed) * 277803737u;
  w = (w >> 22u) ^ w;
  return f32(w) / 4294967295.0;
}

// ---------------------------------------------------------------- shapes, as studio.ts

fn hit_sphere(c: vec3f, r: f32, o: vec3f, d: vec3f) -> f32 {
  let oc = o - c;
  let b = dot(oc, d);
  let k = dot(oc, oc) - r * r;
  let h = b * b - k;
  if (h < 0.0) {
    return FAR;
  }
  let s = sqrt(h);
  var t = -b - s;
  if (t <= 1e-4) {
    t = -b + s;
  }
  return select(FAR, t, t > 1e-4);
}

fn to_box(v: vec3f, yaw: f32) -> vec3f {
  let c = cos(yaw);
  let s = sin(yaw);
  return vec3f(v.x * c - v.z * s, v.y, v.x * s + v.z * c);
}
fn from_box(v: vec3f, yaw: f32) -> vec3f {
  return to_box(v, -yaw);
}

fn hit_box(c: vec3f, half: vec3f, yaw: f32, o: vec3f, d: vec3f) -> f32 {
  let ro = to_box(o - c, yaw);
  let rd = to_box(d, yaw);
  let inv = 1.0 / select(rd, vec3f(1e-12), abs(rd) < vec3f(1e-12));
  let t1 = (-half - ro) * inv;
  let t2 = (half - ro) * inv;
  let near = max(max(min(t1.x, t2.x), min(t1.y, t2.y)), min(t1.z, t2.z));
  let far = min(min(max(t1.x, t2.x), max(t1.y, t2.y)), max(t1.z, t2.z));
  if (near > far || far < 1e-4) {
    return FAR;
  }
  return select(far, near, near > 1e-4);
}

fn hit_capsule(pa: vec3f, pb: vec3f, r: f32, o: vec3f, d: vec3f) -> f32 {
  let ba = pb - pa;
  let oa = o - pa;
  let baba = dot(ba, ba);
  let bard = dot(ba, d);
  let baoa = dot(ba, oa);
  let rdoa = dot(d, oa);
  let oaoa = dot(oa, oa);
  let a = baba - bard * bard;
  var b = baba * rdoa - baoa * bard;
  var c = baba * oaoa - baoa * baoa - r * r * baba;
  var h = b * b - a * c;
  if (h >= 0.0 && a > 1e-12) {
    let t = (-b - sqrt(h)) / a;
    let y = baoa + t * bard;
    if (y > 0.0 && y < baba && t > 1e-4) {
      return t;
    }
    var oc = o - pb;
    if (y <= 0.0) {
      oc = oa;
    }
    b = dot(d, oc);
    c = dot(oc, oc) - r * r;
    h = b * b - c;
    if (h > 0.0) {
      let t2 = -b - sqrt(h);
      if (t2 > 1e-4) {
        return t2;
      }
    }
    return FAR;
  }
  return min(hit_sphere(pa, r, o, d), hit_sphere(pb, r, o, d));
}

struct Hit {
  t: f32,
  n: vec3f,
  colour: vec3f,
  mat: f32,
  id: i32,
}

fn lamp(k: u32) -> vec4f {
  switch k {
    case 0u: { return P.lamp0; }
    case 1u: { return P.lamp1; }
    default: { return P.lamp2; }
  }
}
fn glow(k: u32) -> vec3f {
  switch k {
    case 0u: { return P.glow0.rgb; }
    case 1u: { return P.glow1.rgb; }
    default: { return P.glow2.rgb; }
  }
}

/** the first thing a ray meets; `lamps` says whether the lamps' own bulbs count */
fn trace(o: vec3f, d: vec3f, lamps: bool) -> Hit {
  var h: Hit;
  h.t = FAR;
  h.id = ID_NONE;
  // the floor and the back wall
  if (d.y < 0.0) {
    let t = -o.y / d.y;
    if (t > 1e-4) {
      h.t = t;
      h.n = vec3f(0, 1, 0);
      h.colour = P.floor.rgb;
      h.mat = 0.0;
      h.id = ID_FLOOR;
    }
  }
  if (d.z < 0.0) {
    let t = (P.floor.w - o.z) / d.z;
    if (t > 1e-4 && t < h.t) {
      h.t = t;
      h.n = vec3f(0, 0, 1);
      h.colour = P.floor.rgb * 0.9 + 0.05;
      h.mat = 0.0;
      h.id = ID_WALL;
    }
  }
  let n = u32(P.up.w);
  for (var i = 0u; i < n; i++) {
    let a = prims[i * 4u];
    let b = prims[i * 4u + 1u];
    var t = FAR;
    let kind = u32(a.w);
    let extra = prims[i * 4u + 3u];
    if (kind == 0u) {
      t = hit_sphere(a.xyz, b.w, o, d);
    } else if (kind == 1u) {
      t = hit_box(a.xyz, b.xyz, extra.x, o, d);
    } else {
      t = hit_capsule(a.xyz, b.xyz, b.w, o, d);
    }
    if (t < h.t) {
      h.t = t;
      let p = o + d * t;
      if (kind == 0u) {
        h.n = normalize(p - a.xyz);
      } else if (kind == 1u) {
        let q = to_box(p - a.xyz, extra.x) / b.xyz;
        let m = abs(q);
        var ln = vec3f(sign(q.x), 0, 0);
        if (m.y >= m.x && m.y >= m.z) {
          ln = vec3f(0, sign(q.y), 0);
        } else if (m.z >= m.x) {
          ln = vec3f(0, 0, sign(q.z));
        }
        h.n = from_box(ln, extra.x);
      } else {
        let ba = b.xyz - a.xyz;
        let s = clamp(dot(p - a.xyz, ba) / dot(ba, ba), 0.0, 1.0);
        h.n = normalize(p - (a.xyz + ba * s));
      }
      let look = prims[i * 4u + 2u];
      h.colour = look.rgb;
      h.mat = look.w;
      h.id = i32(extra.y);
    }
  }
  if (lamps) {
    for (var k = 0u; k < u32(P.sky.w); k++) {
      let l = lamp(k);
      let t = hit_sphere(l.xyz, l.w, o, d);
      if (t < h.t) {
        h.t = t;
        h.n = normalize(o + d * t - l.xyz);
        h.colour = glow(k);
        h.mat = 4.0;
        h.id = ID_LAMP + i32(k);
      }
    }
  }
  return h;
}

/** a lamp's radiance: its glow spread over its own disc */
fn radiance(k: u32) -> vec3f {
  let r = lamp(k).w;
  return glow(k) / (PI * r * r);
}

/** a direction about n, cosine-weighted */
fn cosine(n: vec3f) -> vec3f {
  let a = 2.0 * PI * rnd();
  let r = sqrt(rnd());
  let t = select(vec3f(1, 0, 0), vec3f(0, 1, 0), abs(n.x) > 0.5);
  let u = normalize(cross(t, n));
  let v = cross(n, u);
  return normalize(u * cos(a) * r + v * sin(a) * r + n * sqrt(1.0 - r * r));
}

/** each lamp seen from a point, by sampling its cone: what light it brings straight there */
fn direct(p: vec3f, n: vec3f) -> vec3f {
  var sumL = vec3f(0);
  for (var k = 0u; k < u32(P.sky.w); k++) {
    let l = lamp(k);
    let to = l.xyz - p;
    let dist2 = dot(to, to);
    if (dist2 <= l.w * l.w) {
      continue;
    }
    let cmax = sqrt(1.0 - l.w * l.w / dist2);
    // a direction uniformly inside the cone toward the lamp
    let z = 1.0 - rnd() * (1.0 - cmax);
    let rr = sqrt(max(0.0, 1.0 - z * z));
    let a = 2.0 * PI * rnd();
    let w = normalize(to);
    let t = select(vec3f(1, 0, 0), vec3f(0, 1, 0), abs(w.x) > 0.5);
    let u = normalize(cross(t, w));
    let v = cross(w, u);
    let dir = normalize(u * cos(a) * rr + v * sin(a) * rr + w * z);
    let cosn = dot(dir, n);
    if (cosn <= 0.0) {
      continue;
    }
    let s = trace(p + n * 1e-3, dir, false);
    let lt = hit_sphere(l.xyz, l.w, p + n * 1e-3, dir);
    if (s.t < lt) {
      continue;
    }
    let solid = 2.0 * PI * (1.0 - cmax);
    sumL += radiance(k) * cosn * solid / PI;
  }
  return sumL;
}

fn reflect_rough(d: vec3f, n: vec3f, rough: f32) -> vec3f {
  let r = reflect(d, n);
  let j = vec3f(rnd(), rnd(), rnd()) * 2.0 - 1.0;
  var out = normalize(r + j * rough);
  if (dot(out, n) <= 0.0) {
    out = r;
  }
  return out;
}

/** one path from the camera through a pixel, and the light it brings back */
fn path(px: vec2f) -> vec3f {
  let size = vec2f(P.size);
  let aspect = size.x / size.y;
  let uv = vec2f((px.x / size.x) * 2.0 - 1.0, 1.0 - (px.y / size.y) * 2.0);
  let tanHalf = P.eye.w;
  var d = normalize(P.fwd.xyz + P.right.xyz * uv.x * tanHalf * aspect + P.up.xyz * uv.y * tanHalf);
  var o = P.eye.xyz;
  // the thin lens: a point on the aperture, aimed at where this ray crosses the plane in focus
  let aperture = P.fwd.w;
  if (aperture > 0.0) {
    let focus = o + d * (P.right.w / dot(d, P.fwd.xyz));
    let a = 2.0 * PI * rnd();
    let r = aperture * sqrt(rnd());
    o = o + (P.right.xyz * cos(a) + P.up.xyz * sin(a)) * r;
    d = normalize(focus - o);
  }
  var light = vec3f(0);
  var through = vec3f(1);
  var specular = true;
  for (var bounce = 0; bounce < 4; bounce++) {
    let h = trace(o, d, specular);
    if (h.t >= FAR) {
      light += through * P.sky.rgb;
      break;
    }
    if (h.mat >= 3.5) {
      // a lamp's bulb, seen by the camera or in a mirror
      light += through * h.colour / (PI * 0.0625) * 0.15;
      break;
    }
    if (h.mat >= 2.5) {
      // a glowing thing: light of its own
      light += through * h.colour * 3.0;
      break;
    }
    let p = o + d * h.t;
    let n = select(h.n, -h.n, dot(h.n, d) > 0.0);
    o = p + n * 1e-3;
    if (h.mat >= 1.5) {
      // metal: a tinted, slightly blurred mirror
      through *= h.colour;
      d = reflect_rough(d, n, 0.08);
      specular = true;
      continue;
    }
    // gloss: a clear coat over the colour, more of a mirror at a glancing angle
    let fres = 0.04 + 0.96 * pow(1.0 - max(dot(-d, n), 0.0), 5.0);
    if (h.mat >= 0.5 && rnd() < fres) {
      d = reflect_rough(d, n, 0.04);
      specular = true;
      continue;
    }
    through *= h.colour;
    light += through * direct(p, n);
    d = cosine(n);
    specular = false;
  }
  return light;
}

@compute @workgroup_size(8, 8)
fn render(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= P.size.x || id.y >= P.size.y) {
    return;
  }
  let i = id.y * P.size.x + id.x;
  seed = i * 9781u + P.frame * 6271u + 1u;
  var acc = vec4f(0);
  if (P.frame > 0u) {
    acc = sum[i];
  }
  for (var s = 0u; s < P.spp; s++) {
    let jitter = vec2f(rnd(), rnd());
    let c = path(vec2f(id.xy) + jitter);
    // a firefly clamp: one path cannot bring back more than a bright lamp would
    acc += vec4f(min(c, vec3f(20.0)), 1.0);
  }
  sum[i] = acc;
  // what the pixel's centre sees first, through a pinhole: for picking and for the probe
  if (P.frame == 0u) {
    let size = vec2f(P.size);
    let uv = vec2f(((f32(id.x) + 0.5) / size.x) * 2.0 - 1.0, 1.0 - ((f32(id.y) + 0.5) / size.y) * 2.0);
    let d = normalize(P.fwd.xyz + P.right.xyz * uv.x * P.eye.w * (size.x / size.y) + P.up.xyz * uv.y * P.eye.w);
    ids[i] = trace(P.eye.xyz, d, true).id;
  }
}

@vertex
fn cover(@builtin(vertex_index) v: u32) -> @builtin(position) vec4f {
  let p = array(vec2f(-1, -3), vec2f(3, 1), vec2f(-1, 1))[v];
  return vec4f(p, 0, 1);
}

/** ACES, the filmic curve: highlights roll off instead of clipping */
fn aces(x: vec3f) -> vec3f {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0), vec3f(1));
}

@fragment
fn develop(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let i = u32(pos.y) * P.size.x + u32(pos.x);
  let s = shown[i];
  let c = s.rgb / max(s.a, 1.0);
  return vec4f(pow(aces(c * 1.2), vec3f(1.0 / 2.2)), 1);
}
