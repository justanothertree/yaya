// A black hole: every pixel follows its own ray of light from the eye, bent by the hole's gravity,
// to the sky, the disk or nothing. See blackhole.ts for the bending and why it is written so.
//
// ⚠️ `Hole` IS PACKED BY HAND IN blackhole.ts (`HOLE`); blackhole.test.ts lays it out from here.

struct Hole {
  size: vec2u,
  time: f32,
  focal: f32,
  at: vec2f, // where the hole is on screen (y −1..1, x scaled by the aspect)
  dist: f32, // how far the eye is from it, in rs
  tilt: f32, // how far above the disk the eye is, radians
  roll: f32,
  sky: u32, // 0 stars, 1 grid, 2 nebula, 3 the escape direction itself (the probe's)
  disk: u32,
  steps: u32,
}

@group(0) @binding(0) var<uniform> H: Hole;

const PI = 3.14159265;
const TAU = 6.2831853;
const R_IN = 3.0;
const R_OUT = 12.0;

struct Px {
  @builtin(position) clip: vec4f,
  @location(0) ndc: vec2f,
}

@vertex
fn cover(@builtin(vertex_index) v: u32) -> Px {
  let p = vec2f(f32((v << 1u) & 2u), f32(v & 2u)) * 2.0 - 1.0;
  var o: Px;
  o.clip = vec4f(p, 0.0, 1.0);
  o.ndc = p;
  return o;
}

// Schwarzschild's pull on light, mirrored in blackhole.ts (`accel`)
fn accel(p: vec3f, h2: f32) -> vec3f {
  let r2 = dot(p, p);
  return -1.5 * h2 * p / (r2 * r2 * sqrt(r2));
}

fn hash3(p: vec3f) -> vec3f {
  var q = vec3u(vec3i(floor(p)) + vec3i(4096));
  q = q * vec3u(1597334673u, 3812015801u, 2798796415u);
  q = (q.x ^ q.y ^ q.z) * vec3u(1597334673u, 3812015801u, 2798796415u);
  return vec3f(q) / 4294967295.0;
}

fn noise3(p: vec3f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  var n = 0.0;
  for (var k = 0u; k < 8u; k++) {
    let o = vec3f(f32(k & 1u), f32((k >> 1u) & 1u), f32((k >> 2u) & 1u));
    let w = mix(1.0 - u, u, o);
    n += hash3(i + o).x * w.x * w.y * w.z;
  }
  return n;
}

fn stars(d: vec3f) -> vec3f {
  var c = vec3f(0.0);
  for (var layer = 0u; layer < 3u; layer++) {
    let n = 40.0 + 45.0 * f32(layer);
    let g = d * n;
    let cell = floor(g);
    let h = hash3(cell + f32(layer) * 31.0);
    if (h.x > 0.88) {
      let star = cell + 0.3 + 0.4 * h.yzx;
      let dd = length(g - star);
      let tint = mix(vec3f(1.0, 0.75, 0.55), vec3f(0.65, 0.8, 1.0), h.z);
      c += tint * exp(-dd * dd * 90.0) * (0.4 + 2.5 * pow(h.y, 6.0));
    }
  }
  // a faint band of the galaxy across the sky, tilted
  let band = exp(-pow(dot(d, normalize(vec3f(0.3, 1.0, 0.2))) * 4.0, 2.0));
  let dust = noise3(d * 6.0) * 0.6 + noise3(d * 14.0) * 0.4;
  return c + vec3f(0.35, 0.3, 0.4) * band * dust * 0.25;
}

fn grid(d: vec3f) -> vec3f {
  let lon = atan2(d.x, -d.z) / TAU * 24.0;
  let lat = asin(clamp(d.y, -1.0, 1.0)) / PI * 12.0;
  let w = 0.06;
  let line = max(1.0 - smoothstep(0.0, w, abs(fract(lon + 0.5) - 0.5)), 1.0 - smoothstep(0.0, w, abs(fract(lat + 0.5) - 0.5)));
  // two halves of the sky in two colours, so a ray that came round the hole shows where from
  let side = select(vec3f(0.95, 0.45, 0.25), vec3f(0.25, 0.6, 0.95), d.z < 0.0);
  return side * (0.08 + 0.9 * line);
}

fn nebula(d: vec3f) -> vec3f {
  var a = 0.0;
  var amp = 0.5;
  var q = d * 2.5;
  for (var k = 0; k < 4; k++) {
    a += noise3(q) * amp;
    q = q * 2.1 + 3.7;
    amp *= 0.5;
  }
  let b = noise3(d * 3.0 + 11.0);
  let c = mix(vec3f(0.35, 0.1, 0.5), vec3f(0.1, 0.45, 0.6), b) * pow(a, 2.5) * 2.2;
  return c + stars(d) * 0.6;
}

fn sky(d: vec3f) -> vec3f {
  switch (H.sky) {
    case 1u: {
      return grid(d);
    }
    case 2u: {
      return nebula(d);
    }
    case 3u: {
      return d * 0.5 + 0.5;
    }
    default: {
      return stars(d);
    }
  }
}

// a blackbody, near enough: x is temperature, 1 the disk's hottest standing still
fn heat(x: f32) -> vec3f {
  return clamp(vec3f(1.5 * x, 1.25 * x * x - 0.08, 1.05 * x * x * x - 0.2), vec3f(0.0), vec3f(4.0));
}

// the disk's glow where a ray going along v crosses it at q, and how much it hides behind it.
// The shift is blackhole.ts's `shiftAt`; the heat its `heatAt`.
fn disk(q: vec3f, v: vec3f) -> vec4f {
  let r = length(q.xz);
  let beta = sqrt(0.5 / r);
  let orbit = vec3f(-q.z, 0.0, q.x) / r * beta;
  let to_eye = -normalize(v);
  let g = sqrt(1.0 - 1.5 / r) / (1.0 - dot(orbit, to_eye));
  let t0 = pow(r, -0.75) * pow(1.0 - sqrt(R_IN / r), 0.25);
  let tmax = pow(R_IN * 49.0 / 36.0, -0.75) * pow(1.0 - sqrt(36.0 / 49.0), 0.25);
  let x = t0 / tmax * g;
  // streaks of hotter gas, wound round by the orbit (inner gas laps the outer)
  let phi = atan2(q.z, q.x) - H.time * 0.6 * pow(r / R_IN, -1.5);
  let swirl = noise3(vec3f(cos(phi) * 3.0, sin(phi) * 3.0, log(r) * 9.0));
  let edge = smoothstep(R_IN, R_IN + 0.4, r) * (1.0 - smoothstep(R_OUT - 4.0, R_OUT, r));
  let glow = heat(x) * x * x * (0.55 + 0.9 * swirl) * 1.6;
  return vec4f(glow * edge, edge * 0.92);
}

@fragment
fn show(px: Px) -> @location(0) vec4f {
  let aspect = f32(H.size.x) / f32(H.size.y);
  let s = vec2f(px.ndc.x * aspect, px.ndc.y);
  // the eye: above the disk by `tilt`, turned by `roll`, looking along fwd
  let t = H.tilt;
  let fwd = vec3f(0.0, -sin(t), cos(t));
  let r0 = vec3f(1.0, 0.0, 0.0);
  let u0 = vec3f(0.0, cos(t), sin(t));
  let right = r0 * cos(H.roll) + u0 * sin(H.roll);
  let up = u0 * cos(H.roll) - r0 * sin(H.roll);
  // stood back from the hole along the ray through where it is on screen
  let cam = -normalize(fwd * H.focal + right * H.at.x + up * H.at.y) * H.dist;
  var p = cam;
  var v = normalize(fwd * H.focal + right * s.x + up * s.y);
  let hv = cross(p, v);
  let h2 = dot(hv, hv);
  let far = H.dist * 1.2 + 30.0;
  var colour = vec3f(0.0);
  var through = 1.0;
  var fate = 0u; // 0 still circling, 1 fell in, 2 escaped
  for (var i = 0u; i < H.steps; i++) {
    let r = length(p);
    if (r < 1.0) {
      fate = 1u;
      break;
    }
    if (r > far && dot(p, v) > 0.0) {
      fate = 2u;
      break;
    }
    // mirrored in blackhole.ts: `stepAt`, then velocity Verlet
    let dt = clamp(0.06 * r * min(1.0, r / 4.0), 0.01, 2.0);
    let a = accel(p, h2);
    let pn = p + v * dt + 0.5 * a * dt * dt;
    let vn = v + 0.5 * (a + accel(pn, h2)) * dt;
    if (H.disk == 1u && sign(pn.y) != sign(p.y)) {
      let f = p.y / (p.y - pn.y);
      let q = mix(p, pn, f);
      let rq = length(q.xz);
      if (rq > R_IN && rq < R_OUT) {
        let e = disk(q, mix(v, vn, f));
        colour += through * e.rgb;
        through *= 1.0 - e.a;
      }
    }
    p = pn;
    v = vn;
    if (through < 0.01) {
      break;
    }
  }
  if (fate == 2u) {
    colour += through * sky(normalize(v));
  }
  if (H.sky == 3u) {
    return vec4f(colour, 1.0);
  }
  // a gentle curve, so the hottest gas does not just clip to white
  return vec4f(1.0 - exp(-colour * 1.2), 1.0);
}
