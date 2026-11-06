// Topple: a table of dominoes seen from above and in front. Three passes. `ground` paints the table
// per pixel — wood, the walls, the bells (gold, glowing once rung), the push arrow and the line being
// drawn. `shade` lays a soft shadow under every domino, stretching out as it falls. `box` draws every
// domino as an instanced box: the vertex shader turns each about its base edge by the angle its own
// start time says it has reached — π/2·(t/FALL)², the same curve `tipTime` inverts — and stops it at
// its resting angle. Its face colour shows as it tips: the picture appears as the run falls.

struct Table {
  size: vec2u,
  count: u32,
  bells: u32,
  time: f32,
  walls: u32,
  rung: u32,
  preview: u32,
}

const W = 24.0;
const D = 15.0;
const TALL = 1.0;
const WIDE = 0.5;
const THICK = 0.16;
const FALL = 0.22;
const PITCH = 0.95;

@group(0) @binding(0) var<uniform> T: Table;
/** two vec4 a domino: (x, z, axis angle, colour), (start, direction, rest angle, 0) */
@group(0) @binding(1) var<storage, read> dominoes: array<vec4f>;
/** [0] the push, [1..12] bells, [13..20] walls */
@group(0) @binding(2) var<storage, read> marks: array<vec4f>;
@group(0) @binding(3) var<storage, read> preview: array<vec2f>;

fn scale() -> f32 {
  let size = vec2f(T.size);
  return min(size.x / (W + 1.0), size.y / ((D + 1.0) * sin(PITCH) + TALL * cos(PITCH)));
}

/** a point of the table to clip space: orthographic, tilted by PITCH (floorAt, the other way) */
fn project(p: vec3f) -> vec4f {
  let size = vec2f(T.size);
  let s = scale();
  let sx = (p.x - W * 0.5) * s;
  let sy = ((p.z - D * 0.5) * sin(PITCH) + p.y * cos(PITCH)) * s;
  // depth: further away (larger z, lower y) is deeper
  let depth = ((p.z - D * 0.5) * cos(PITCH) - p.y * sin(PITCH) + 20.0) / 40.0;
  return vec4f(sx / (size.x * 0.5), sy / (size.y * 0.5), clamp(depth, 0.0, 1.0), 1.0);
}

fn palette(c: u32) -> vec3f {
  let cs = array(
    vec3f(0.85, 0.2, 0.2), vec3f(0.95, 0.6, 0.15), vec3f(0.95, 0.85, 0.25), vec3f(0.3, 0.7, 0.35),
    vec3f(0.2, 0.55, 0.85), vec3f(0.45, 0.3, 0.75), vec3f(0.12, 0.12, 0.14), vec3f(0.96, 0.96, 0.94),
  );
  return cs[min(c, 7u)];
}

/** how far over a domino is at time t: π/2·(Δt/FALL)², up to where it rests */
fn tilt(k: u32) -> f32 {
  let f = dominoes[k * 2u + 1u];
  if (f.x < 0.0 || T.time < f.x) {
    return 0.0;
  }
  let u = (T.time - f.x) / FALL;
  return min(1.5707963 * u * u, f.z);
}

// ---------------------------------------------------------------- the floor

@vertex
fn cover(@builtin(vertex_index) v: u32) -> @builtin(position) vec4f {
  let p = array(vec2f(-1, -3), vec2f(3, 1), vec2f(-1, 1))[v];
  return vec4f(p, 0.999, 1);
}

fn seg(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let ab = b - a;
  let t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-9), 0.0, 1.0);
  return distance(p, a + ab * t);
}

@fragment
fn ground(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let size = vec2f(T.size);
  let s = scale();
  // the screen back onto the floor (y = 0): floorAt in topple.ts
  let p = vec2f(W * 0.5 + (pos.x - size.x * 0.5) / s, D * 0.5 + (size.y * 0.5 - pos.y) / s / sin(PITCH));
  let px = 1.0 / s;
  var col = vec3f(0.12, 0.1, 0.09);
  if (p.x < 0.0 || p.y < 0.0 || p.x > W || p.y > D) {
    return vec4f(col, 1);
  }
  // wood: planks along x, grain along them
  let plank = floor(p.y / 1.5);
  let grain = 0.5 + 0.5 * sin(p.x * 2.3 + sin(p.y * 7.0 + plank * 3.1) * 1.4 + plank * 11.0);
  col = mix(vec3f(0.55, 0.38, 0.24), vec3f(0.62, 0.44, 0.28), grain) * (0.92 + 0.08 * fract(sin(plank * 12.9) * 437.5));
  col *= mix(0.82, 1.0, smoothstep(0.0, px * 2.0, abs(fract(p.y / 1.5 + 0.5) - 0.5) * 1.5));
  // the walls
  for (var k = 0u; k < T.walls; k++) {
    let w = marks[13u + k];
    if (p.x > w.x && p.x < w.z && p.y > w.y && p.y < w.w) {
      col = vec3f(0.25, 0.25, 0.28);
    }
  }
  // the bells: a gold ring, filled and glowing once rung
  for (var k = 0u; k < T.bells; k++) {
    let b = marks[1u + k].xy;
    let d = distance(p, b);
    let rung = ((T.rung >> k) & 1u) == 1u;
    col = mix(col, vec3f(0.95, 0.75, 0.25), smoothstep(px * 1.5, 0.0, abs(d - 0.32) - 0.05));
    if (rung) {
      col = mix(col, vec3f(1.0, 0.85, 0.4), smoothstep(0.32, 0.0, d));
      col += vec3f(0.5, 0.35, 0.05) * exp(-d * 2.5) * 0.6;
    }
  }
  // the push: an arrow on the floor where the first domino must stand
  let st = marks[0];
  if (st.w > 0.5) {
    let dir = vec2f(cos(st.z), sin(st.z));
    let side = vec2f(-dir.y, dir.x);
    let a = st.xy - dir * 1.2;
    let tip = st.xy - dir * 0.35;
    var d = seg(p, a, tip);
    d = min(d, seg(p, tip, tip - dir * 0.3 + side * 0.25));
    d = min(d, seg(p, tip, tip - dir * 0.3 - side * 0.25));
    col = mix(col, vec3f(0.95, 0.95, 0.9), smoothstep(px * 1.5, 0.0, d - 0.04));
    col = mix(col, vec3f(1.0, 1.0, 0.9), smoothstep(px * 1.5, 0.0, abs(distance(p, st.xy) - 0.6) - 0.02) * 0.6);
  }
  // the line being drawn
  for (var k = 1u; k < T.preview; k++) {
    let d = seg(p, preview[k - 1u], preview[k]);
    col = mix(col, vec3f(1.0, 1.0, 1.0), smoothstep(px * 1.5, 0.0, d - 0.03) * 0.8);
  }
  return vec4f(col, 1);
}

// ---------------------------------------------------------------- the shadows

struct Shadow {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn shade_vs(@builtin(vertex_index) v: u32, @builtin(instance_index) k: u32) -> Shadow {
  let d = dominoes[k * 2u];
  let f = dominoes[k * 2u + 1u];
  let corner = array(vec2f(-1, -1), vec2f(1, -1), vec2f(1, 1), vec2f(-1, -1), vec2f(1, 1), vec2f(-1, 1))[v];
  let ax = vec2f(cos(d.z), sin(d.z));
  let across = vec2f(-ax.y, ax.x);
  // a standing domino's shadow is a slim smudge; a fallen one's is its whole length, ahead of it
  let reach = sin(tilt(k)) * TALL;
  let along = (corner.y * 0.5 + 0.5) * (reach + THICK) - THICK * 0.5 + 0.08;
  let c = d.xy + ax * f.y * along + across * corner.x * (WIDE * 0.5 + 0.08) + vec2f(0.08, 0.1);
  var out: Shadow;
  out.pos = project(vec3f(c.x, 0.0, c.y));
  out.pos.z = 0.998;
  out.uv = corner;
  return out;
}

@fragment
fn shade_fs(i: Shadow) -> @location(0) vec4f {
  let e = max(abs(i.uv.x), abs(i.uv.y));
  return vec4f(0.0, 0.0, 0.0, 0.35 * smoothstep(1.0, 0.6, e));
}

// ---------------------------------------------------------------- the dominoes

struct Boxv {
  @builtin(position) pos: vec4f,
  @location(0) n: vec3f,
  @location(1) face: f32,
  @location(2) @interpolate(flat) k: u32,
  @location(3) local: vec2f,
}

@vertex
fn box_vs(@builtin(vertex_index) v: u32, @builtin(instance_index) k: u32) -> Boxv {
  // six faces of two triangles each, in a unit box: x across, y up, z along the axis
  let face = v / 6u;
  let tri = array(vec2f(-1, -1), vec2f(1, -1), vec2f(1, 1), vec2f(-1, -1), vec2f(1, 1), vec2f(-1, 1))[v % 6u];
  var q = vec3f(0);
  var n = vec3f(0);
  switch face {
    case 0u: { q = vec3f(tri.x, tri.y, 1.0); n = vec3f(0, 0, 1); }
    case 1u: { q = vec3f(-tri.x, tri.y, -1.0); n = vec3f(0, 0, -1); }
    case 2u: { q = vec3f(1.0, tri.y, -tri.x); n = vec3f(1, 0, 0); }
    case 3u: { q = vec3f(-1.0, tri.y, tri.x); n = vec3f(-1, 0, 0); }
    case 4u: { q = vec3f(tri.x, 1.0, -tri.y); n = vec3f(0, 1, 0); }
    default: { q = vec3f(tri.x, -1.0, tri.y); n = vec3f(0, -1, 0); }
  }
  let d = dominoes[k * 2u];
  let f = dominoes[k * 2u + 1u];
  // the box in the domino's own frame: across, up from the floor, along its axis (forward = +)
  let dir = select(-1.0, 1.0, f.y >= 0.0);
  var across = q.x * WIDE * 0.5;
  var up = (q.y * 0.5 + 0.5) * TALL;
  var along = q.z * THICK * 0.5 * dir;
  var nn = vec3f(n.x, n.y, n.z * dir);
  // tipped forward about its leading base edge
  let th = tilt(k);
  let ra = along - THICK * 0.5;
  let a2 = ra * cos(th) + up * sin(th) + THICK * 0.5;
  let u2 = -ra * sin(th) + up * cos(th);
  let na = nn.z * cos(th) + nn.y * sin(th);
  let nu = -nn.z * sin(th) + nn.y * cos(th);
  // into the table: along the axis (times the fall direction), across it, and up
  let ax = vec2f(cos(d.z), sin(d.z)) * dir;
  let side = vec2f(-ax.y, ax.x);
  let xz = d.xy + ax * a2 + side * across;
  var out: Boxv;
  out.pos = project(vec3f(xz.x, u2, xz.y));
  let nxz = ax * na + side * nn.x;
  out.n = vec3f(nxz.x, nu, nxz.y);
  out.face = select(0.0, 1.0, face <= 1u);
  out.k = k;
  out.local = vec2f(q.x, q.y);
  return out;
}

@fragment
fn box_fs(i: Boxv) -> @location(0) vec4f {
  let light = normalize(vec3f(-0.4, 0.85, -0.35));
  let lit = 0.45 + 0.55 * max(dot(normalize(i.n), light), 0.0);
  let ivory = vec3f(0.93, 0.9, 0.82);
  let f = dominoes[i.k * 2u + 1u];
  let th = tilt(i.k);
  // the face shows its colour as the domino tips, so the picture appears as the run falls
  var c = ivory;
  if (i.face > 0.5) {
    c = mix(ivory, palette(u32(dominoes[i.k * 2u].w)), clamp(sin(th) * 1.15, 0.0, 1.0));
    // a domino's line across the middle of its face
    c *= mix(0.8, 1.0, smoothstep(0.0, 0.06, abs(i.local.y)));
  }
  // a fallen one sits a touch darker where it lies on the floor's shade
  c *= select(1.0, 0.97, f.x >= 0.0 && th >= f.z);
  return vec4f(c * lit, 1);
}
