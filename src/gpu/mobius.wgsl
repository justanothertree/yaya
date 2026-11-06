// Möbius golf: the cover of the course. Every pixel is a point of the plane tiled with copies of the
// square course — flipped across an edge glued with a twist, absent beyond an edge that is a wall —
// folded back into the course (`fold`, the same as mobius.ts) and drawn there: the mown green, the
// edge marks (arrows the way topology books draw gluings: one arrow on the left/right pair, two on
// the top/bottom, pointing opposite ways across a twist), the walls, the cup and its flag, the ball,
// the aim and the ball's path. A ball rolling out through an edge is seen to roll straight on into
// the next copy — which is the point of drawing it.

struct Course {
  size: vec2u,
  glue: vec2u,
  ball: vec4f,
  cup: vec2f,
  aim: vec2f,
  view: vec2f,
  walls: u32,
  path: u32,
  time: f32,
  flipped: u32,
}

const S = 10.0;
const BALL_R = 0.18;
const HOLE_R = 0.32;
const WALL_R = 0.12;

@group(0) @binding(0) var<uniform> C: Course;
@group(0) @binding(1) var<storage, read> walls: array<vec4f>;
@group(0) @binding(2) var<storage, read> path: array<vec2f>;

@vertex
fn cover(@builtin(vertex_index) v: u32) -> @builtin(position) vec4f {
  let p = array(vec2f(-1, -3), vec2f(3, 1), vec2f(-1, 1))[v];
  return vec4f(p, 0, 1);
}

/** a pixel to the cover: the camera at C.view, the shorter side C.ball.w metres, y up (toCover) */
fn to_cover(pos: vec2f) -> vec2f {
  let size = vec2f(C.size);
  let k = C.ball.w / min(size.x, size.y);
  return vec2f(C.view.x + (pos.x - size.x * 0.5) * k, C.view.y - (pos.y - size.y * 0.5) * k);
}

struct Folded {
  at: vec2f,
  tile: vec2i,
  flipped: u32,
  ok: bool,
}

/** a point of the cover folded into the course: `fold` in mobius.ts, line for line */
fn fold(p: vec2f) -> Folded {
  let i = i32(floor(p.x / S));
  let j = i32(floor(p.y / S));
  var out: Folded;
  out.tile = vec2i(i, j);
  out.ok = !((C.glue.x == 0u && i != 0) || (C.glue.y == 0u && j != 0));
  var x = p.x - f32(i) * S;
  var y = p.y - f32(j) * S;
  var flipped = 0u;
  if (C.glue.x == 2u && (i & 1) != 0) {
    y = S - y;
    flipped ^= 1u;
  }
  if (C.glue.y == 2u && (j & 1) != 0) {
    x = S - x;
    flipped ^= 1u;
  }
  out.at = vec2f(x, y);
  out.flipped = flipped;
  return out;
}

fn seg(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let ab = b - a;
  let t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
  return distance(p, a + ab * t);
}

/** a chevron at `c` pointing along `dir`, as a distance */
fn chevron(p: vec2f, c: vec2f, dir: vec2f) -> f32 {
  let side = vec2f(-dir.y, dir.x);
  let tip = c + dir * 0.18;
  return min(seg(p, tip, c - dir * 0.12 + side * 0.2), seg(p, tip, c - dir * 0.12 - side * 0.2));
}

@fragment
fn show(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let size = vec2f(C.size);
  let px = C.ball.w / min(size.x, size.y);
  let p = to_cover(pos.xy);
  let f = fold(p);
  if (!f.ok) {
    // beyond a wall edge there is nothing: a dark sky with a few slow stars
    let cell = floor(p * 1.5);
    let h = fract(sin(dot(cell, vec2f(41.3, 289.1))) * 43758.5);
    let dot_ = length(fract(p * 1.5) - 0.5);
    let star = step(0.97, h) * smoothstep(0.09, 0.0, dot_) * (0.6 + 0.4 * sin(C.time + h * 40.0));
    return vec4f(vec3f(0.04, 0.05, 0.08) + star * 0.6, 1);
  }
  let q = f.at;
  let home = f.tile.x == 0 && f.tile.y == 0;
  // the green, mown in stripes that run across the course — so a mirrored copy shows it
  let stripe = step(0.5, fract((q.x + q.y * 0.35) / 1.25));
  var col = mix(vec3f(0.22, 0.52, 0.24), vec3f(0.26, 0.58, 0.27), stripe);
  // the cup and a flag that leans one way, so a mirrored copy's flag leans the other
  let dc = distance(q, C.cup);
  col = mix(col, vec3f(0.05, 0.07, 0.05), smoothstep(px, -px, dc - HOLE_R));
  let pole = seg(q, C.cup, C.cup + vec2f(0.0, 1.3));
  col = mix(col, vec3f(0.92), smoothstep(px * 1.5, 0.0, pole - 0.03));
  let flag = q - (C.cup + vec2f(0.0, 1.05));
  if (flag.x > 0.0 && flag.x < 0.6 && abs(flag.y) < 0.22 * (1.0 - flag.x / 0.6)) {
    col = vec3f(0.92, 0.2, 0.2);
  }
  // the walls
  var dw = 1e9;
  for (var k = 0u; k < C.walls; k++) {
    let w = walls[k];
    dw = min(dw, seg(q, w.xy, w.zw));
  }
  col = mix(col, vec3f(0.42, 0.28, 0.16), smoothstep(px, -px, dw - WALL_R));
  col = mix(col, vec3f(0.6, 0.42, 0.25), smoothstep(px, -px, dw - WALL_R * 0.4) * 0.5);
  // the path: the last shot's trail, or (while aiming) a dotted guide
  var dp = 1e9;
  var along = 0.0;
  var run = 0.0;
  for (var k = 1u; k < C.path; k++) {
    let a = path[k - 1u];
    let b = path[k];
    let l = distance(a, b);
    if (l < S * 0.5) {
      let d = seg(q, a, b);
      if (d < dp) {
        dp = d;
        along = run + dot(q - a, b - a) / max(l, 1e-6);
      }
    }
    run += min(l, 1.0);
  }
  let aiming = dot(C.aim, C.aim) > 0.0;
  let dash = select(1.0, step(0.5, fract(along * 2.5)), aiming);
  col = mix(col, vec3f(1.0, 1.0, 0.9), smoothstep(px * 1.5, 0.0, dp - 0.03) * 0.7 * dash);
  // the ball, with two spots set round it at the spin angle, the second ahead one way — so a ball
  // that has been through a twist is visibly its own mirror image
  let b = C.ball.xy;
  let db = distance(q, b);
  if (db < BALL_R + px) {
    var c = vec3f(0.97);
    let side = select(1.0, -1.0, C.flipped == 1u);
    let a1 = C.ball.z;
    let a2 = C.ball.z + side * 1.1;
    let s1 = distance(q, b + vec2f(cos(a1), sin(a1)) * BALL_R * 0.55);
    let s2 = distance(q, b + vec2f(cos(a2), sin(a2)) * BALL_R * 0.55);
    c = mix(c, vec3f(0.85, 0.15, 0.15), smoothstep(px, 0.0, s1 - BALL_R * 0.28));
    c = mix(c, vec3f(0.15, 0.3, 0.85), smoothstep(px, 0.0, s2 - BALL_R * 0.2));
    col = mix(col, c, smoothstep(px, -px, db - BALL_R));
  }
  // the aim: an arrow out of the ball, as long as the shot is strong
  if (aiming) {
    let tip = b + C.aim * 2.5;
    let da = seg(q, b + normalize(C.aim) * (BALL_R + 0.05), tip);
    col = mix(col, vec3f(1.0, 0.85, 0.3), smoothstep(px * 1.5, 0.0, da - 0.05));
    col = mix(col, vec3f(1.0, 0.85, 0.3), smoothstep(px * 1.5, 0.0, chevron(q, tip, normalize(C.aim)) - 0.05));
  }
  // the edges: a wall edge is a bank; a glued edge is marked with arrows that say which way it is glued
  let edge = min(min(q.x, S - q.x), min(q.y, S - q.y));
  let gx = C.glue.x;
  let gy = C.glue.y;
  if (q.x < 0.08 || q.x > S - 0.08) {
    col = select(mix(col, vec3f(0.5, 0.75, 1.0), 0.6), vec3f(0.35, 0.24, 0.14), gx == 0u);
  }
  if (q.y < 0.08 || q.y > S - 0.08) {
    col = select(mix(col, vec3f(1.0, 0.7, 0.85), 0.6), vec3f(0.35, 0.24, 0.14), gy == 0u);
  }
  if (gx != 0u) {
    // one arrow on each of the left and right edges; across a twist they point opposite ways
    let up = select(1.0, -1.0, gx == 2u && q.x > S * 0.5);
    let ex = select(0.35, S - 0.35, q.x > S * 0.5);
    let d = chevron(q, vec2f(ex, S * 0.5), vec2f(0.0, up));
    col = mix(col, vec3f(0.6, 0.85, 1.0), smoothstep(px * 1.5, 0.0, d - 0.045));
  }
  if (gy != 0u) {
    let right = select(1.0, -1.0, gy == 2u && q.y > S * 0.5);
    let ey = select(0.35, S - 0.35, q.y > S * 0.5);
    let d = min(
      chevron(q, vec2f(S * 0.5 - 0.22, ey), vec2f(right, 0.0)),
      chevron(q, vec2f(S * 0.5 + 0.22, ey), vec2f(right, 0.0)),
    );
    col = mix(col, vec3f(1.0, 0.75, 0.9), smoothstep(px * 1.5, 0.0, d - 0.045));
  }
  // the copies: the course itself bright and framed, the others dimmer the further off they are,
  // and a mirrored one faintly cooler so it can be told from a copy the right way round
  if (!home) {
    let far = f32(abs(f.tile.x) + abs(f.tile.y));
    col *= 0.78 - 0.1 * min(far - 1.0, 3.0);
    if (f.flipped == 1u) {
      col = mix(col, col * vec3f(0.8, 0.9, 1.15), 0.6);
    }
  } else if (edge < 0.05 + px * 2.0) {
    col = mix(col, vec3f(1.0), 0.35);
  }
  return vec4f(col, 1);
}
