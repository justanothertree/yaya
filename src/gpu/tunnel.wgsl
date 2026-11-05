// An endless tunnel, flown through. There is no geometry at all: every pixel casts a ray from the
// eye and SPHERE-TRACES it — asks a distance function how far the nearest surface is, steps that
// far (which can never pass through anything), and asks again — until it lands on the wall or an
// orb. The whole world is the two functions `wall` and `orb`.
//
// ⚠️ `Tunnel` IS PACKED BY HAND IN tunnel.ts (`TUNNEL`); tunnel.test.ts lays it out from here, and
// reads LAP, RADIUS, GAP, REACH and ORB back out of this file to check they agree with tunnel.ts.

struct Tunnel {
  eye: vec4f, // xyz the eye (z wrapped to one lap), w the time
  fwd: vec4f, // w the aspect
  right: vec4f, // w the speed
  up: vec4f, // w the flash of a catch, 1 falling to 0
  first: u32, // the next orb not yet reached
  ahead: f32, // how far ahead of the eye it is
  prev_taken: u32, // 1 if the one before it was caught, so is not drawn
  palette: u32,
}

@group(0) @binding(0) var<uniform> T: Tunnel;

const TAU = 6.2831853;
const LAP = 240.0;
const RADIUS = 1.6;
const GAP = 6.0;
const REACH = 0.6;
const ORB = 0.16;
const STEPS = 96;
const FAR = 42.0;

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

// mirrors `path` in tunnel.ts: whole turns per LAP, so a wrapped z draws the same tunnel
fn path(z: f32) -> vec2f {
  let w = TAU * z / LAP;
  return vec2f(2.2 * sin(3.0 * w) + 1.0 * sin(7.0 * w), 1.6 * cos(2.0 * w) + 0.7 * sin(5.0 * w));
}

// PCG's hash, mirrored in tunnel.ts — u32 arithmetic wraps the same way in both
fn hash(k: u32) -> f32 {
  var x = k * 747796405u + 2891336453u;
  x = ((x >> ((x >> 28u) + 4u)) ^ x) * 277803737u;
  x = (x >> 22u) ^ x;
  return f32(x) / 4294967295.0;
}

fn orb_offset(k: u32) -> vec2f {
  let a = hash(2u * k) * TAU;
  let r = RADIUS * REACH * (0.25 + 0.75 * hash(2u * k + 1u));
  return vec2f(cos(a), sin(a)) * r;
}

// The wall, as a distance: the radius less how far a point is from the centreline, rippled by
// angle and depth. ⚠️ × 0.7 BECAUSE IT IS NOT AN EXACT DISTANCE: the centreline bends, so
// "distance from path(p.z)" overstates the true one on the outside of a turn, and an overstated
// step walks through the wall. 0.7 covers the steepest bend this path has.
fn wall(p: vec3f) -> f32 {
  let q = p.xy - path(p.z);
  let a = atan2(q.y, q.x);
  let ripple = 0.08 * sin(a * 6.0 + p.z * 0.9) + 0.05 * sin(a * 11.0 - p.z * 1.7);
  return (RADIUS + ripple - length(q)) * 0.7;
}

// The nearest orb along z, as a distance, and its centre. Orbs hang GAP apart, so only the one in
// this slice of the tunnel can be near — domain repetition, with the slice found by rounding.
fn orb(p: vec3f) -> vec4f {
  let j = round((p.z - T.eye.z - T.ahead) / GAP);
  if (j < -1.0 || j > 31.0 || (j == -1.0 && T.prev_taken == 1u)) {
    return vec4f(1e3, 0.0, 0.0, 0.0);
  }
  let k = u32(i32(T.first) + i32(j));
  let z = T.eye.z + T.ahead + j * GAP;
  let c = vec3f(path(z) + orb_offset(k), z);
  return vec4f(length(p - c) - ORB, c);
}

fn theme(i: u32) -> array<vec3f, 4> {
  // walls, rings, orbs, fog
  switch (i) {
    case 1u: {
      return array<vec3f, 4>(vec3f(0.35, 0.08, 0.05), vec3f(1.0, 0.45, 0.1), vec3f(1.0, 0.85, 0.4), vec3f(0.06, 0.01, 0.0));
    }
    case 2u: {
      return array<vec3f, 4>(vec3f(0.45, 0.6, 0.75), vec3f(0.6, 0.95, 1.0), vec3f(1.0, 1.0, 1.0), vec3f(0.02, 0.04, 0.08));
    }
    case 3u: {
      return array<vec3f, 4>(vec3f(0.08, 0.3, 0.12), vec3f(0.95, 0.8, 0.2), vec3f(0.6, 1.0, 0.4), vec3f(0.0, 0.04, 0.02));
    }
    default: {
      return array<vec3f, 4>(vec3f(0.25, 0.08, 0.45), vec3f(0.1, 0.95, 1.0), vec3f(1.0, 0.35, 0.85), vec3f(0.02, 0.0, 0.05));
    }
  }
}

// the wall's own gradient points away from it, into the tunnel — which is the way it faces
fn wall_normal(p: vec3f) -> vec3f {
  let e = vec2f(0.002, 0.0);
  return normalize(vec3f(
    wall(p + e.xyy) - wall(p - e.xyy),
    wall(p + e.yxy) - wall(p - e.yxy),
    wall(p + e.yyx) - wall(p - e.yyx),
  ));
}

@fragment
fn fly(px: Px) -> @location(0) vec4f {
  let pal = theme(T.palette);
  let time = T.eye.w;
  let aspect = T.fwd.w;
  let speed = T.right.w;
  let s = px.ndc * vec2f(aspect, 1.0);
  // a wider view the faster you go — the oldest trick for making speed feel like speed
  let fov = 0.75 + speed * 0.012;
  let rd = normalize(T.fwd.xyz + (s.x * T.right.xyz + s.y * T.up.xyz) * fov);
  let ro = T.eye.xyz;

  var t = 0.05;
  var hit = 0; // 0 nothing, 1 wall, 2 orb
  var centre = vec3f(0.0);
  var glow = 0.0;
  for (var i = 0; i < STEPS; i++) {
    let p = ro + rd * t;
    let w = wall(p);
    let o = orb(p);
    // light gathered on the way past an orb, whether or not the ray ever lands on it
    glow += 0.0018 / (0.004 + o.x * o.x);
    let d = min(w, o.x);
    if (d < 0.0015 * t) {
      hit = select(1, 2, o.x < w);
      centre = o.yzw;
      break;
    }
    t += d;
    if (t > FAR) {
      break;
    }
  }

  let p = ro + rd * t;
  var col = pal[3];
  if (hit == 1) {
    let n = wall_normal(p);
    let q = p.xy - path(p.z);
    let a = atan2(q.y, q.x);
    // tiles: bands round the tunnel and along it, each a slightly different shade
    let tile = floor(vec2f(a / TAU * 16.0, p.z * 1.5));
    let shade = 0.65 + 0.35 * fract(sin(dot(tile, vec2f(12.9898, 78.233))) * 43758.5453);
    let seam = smoothstep(0.0, 0.08, min(fract(a / TAU * 16.0), fract(p.z * 1.5)));
    // the headlight: you light what is in front of you, and it falls away with distance
    let lit = max(dot(n, -rd), 0.0) / (1.0 + 0.03 * t * t);
    col = pal[0] * shade * (0.25 + 0.75 * seam) * lit * 1.4;
    // a ring of light every 8 units, with a pulse running down them as fast as you fly
    let band = abs(fract(p.z / 8.0 + 0.5) - 0.5) * 8.0;
    let ring = smoothstep(0.3, 0.0, band) * (0.65 + 0.35 * sin(p.z * 0.4 - time * (2.0 + speed * 0.3)));
    col += pal[1] * ring * 1.8;
  } else if (hit == 2) {
    let n = normalize(p - centre);
    let rim = pow(1.0 - max(dot(n, -rd), 0.0), 2.0);
    col = pal[2] * (0.9 + 1.5 * rim);
  }
  // fog: far things fade to the tunnel's own dark, so the end of the tunnel is never a cut-off
  col = mix(pal[3], col, exp(-t * 0.055));
  col += pal[2] * min(glow, 2.0) * 0.35;
  // a catch lights the whole tunnel for a moment
  col += pal[2] * T.up.w * 0.25;
  // a soft roll-off rather than a clip, so a bright orb blooms instead of going flat white
  col = col / (1.0 + col * 0.6);
  return vec4f(col, 1.0);
}
