// Shadow box: a 5 × 5 box of stacked blocks, seen from above the front right, traced per pixel. Each
// pixel's ray is walked across the floor's columns (a 2-D grid walk, checking the ray's height in
// each) to find the first block face, else the back wall, the left wall or the floor. Three lamps
// light it square to the walls: one in front throws the blocks' outline onto the back wall, one on
// the right onto the left wall, one overhead onto the floor — each shadow found by walking from the
// lit point toward its lamp through the columns (the same as shadowsOf in shadowbox.ts). The hidden
// build's shadows are drawn dark; the player's own over them in blue, and red where the player's
// throws shadow the hidden one does not.

struct Box {
  size: vec2u,
  show: u32,
  mine: u32,
  time: f32,
  yaw: f32,
  hidden: u32,
}

const N = 5;
const TALL = 4.0;

@group(0) @binding(0) var<uniform> B: Box;
/** the hidden build's heights, then the player's: 25 each */
@group(0) @binding(1) var<storage, read> heights: array<u32, 50>;

fn h_of(which: u32, x: i32, z: i32) -> f32 {
  if (x < 0 || z < 0 || x >= N || z >= N) {
    return 0.0;
  }
  return f32(heights[which * 25u + u32(z * N + x)]);
}

/** a point's shadow from the lamp in front (toward −z), the lamp on the right (+x) and overhead (+y):
 *  walk from the point toward the lamp, column by column, and see whether a stack rises above it */
fn front_shadow(which: u32, p: vec3f) -> bool {
  let x = i32(floor(p.x));
  for (var z = i32(floor(p.z - 0.001)); z >= 0; z--) {
    if (h_of(which, x, z) > p.y + 0.001) {
      return true;
    }
  }
  return false;
}
fn side_shadow(which: u32, p: vec3f) -> bool {
  let z = i32(floor(p.z));
  for (var x = i32(floor(p.x + 0.001)); x < N; x++) {
    if (h_of(which, x, z) > p.y + 0.001) {
      return true;
    }
  }
  return false;
}
fn top_shadow(which: u32, p: vec3f) -> bool {
  return h_of(which, i32(floor(p.x)), i32(floor(p.z))) > p.y + 0.001;
}

struct Hit {
  t: f32,
  n: vec3f,
  kind: u32, // 0 nothing, 1 block, 2 back wall, 3 left wall, 4 floor
}

/** the first block face along the ray: a walk over the floor's columns */
fn trace_blocks(which: u32, o: vec3f, d: vec3f) -> Hit {
  var hit: Hit;
  hit.kind = 0u;
  // where the ray enters and leaves the box's footprint
  let inv = 1.0 / select(d, vec3f(1e-6), abs(d) < vec3f(1e-6));
  let t0 = (vec3f(0.0, 0.0, 0.0) - o) * inv;
  let t1 = (vec3f(f32(N), TALL, f32(N)) - o) * inv;
  let tn = min(t0, t1);
  let tf = max(t0, t1);
  let enter = max(max(tn.x, tn.y), tn.z);
  let leave = min(min(tf.x, tf.y), tf.z);
  if (enter > leave || leave < 0.0) {
    return hit;
  }
  var t = max(enter, 0.0) + 1e-4;
  var p = o + d * t;
  var cx = i32(floor(p.x));
  var cz = i32(floor(p.z));
  let sx = select(-1, 1, d.x > 0.0);
  let sz = select(-1, 1, d.z > 0.0);
  // the side of the box the ray came in through, for the first cell's face
  var n = vec3f(0.0, 1.0, 0.0);
  if (enter == tn.x) {
    n = vec3f(-f32(sx), 0.0, 0.0);
  } else if (enter == tn.z) {
    n = vec3f(0.0, 0.0, -f32(sz));
  }
  for (var k = 0; k < 16; k++) {
    if (cx < 0 || cz < 0 || cx >= N || cz >= N) {
      break;
    }
    let h = h_of(which, cx, cz);
    // where the ray leaves this cell
    let nx = select(f32(cx), f32(cx + 1), d.x > 0.0);
    let nz = select(f32(cz), f32(cz + 1), d.z > 0.0);
    let tx = (nx - o.x) * inv.x;
    let tz = (nz - o.z) * inv.z;
    let out = min(tx, tz);
    let yIn = o.y + d.y * t;
    if (yIn <= h) {
      hit.t = t;
      hit.n = n;
      hit.kind = 1u;
      return hit;
    }
    let yOut = o.y + d.y * out;
    if (yOut <= h) {
      hit.t = (h - o.y) / d.y;
      hit.n = vec3f(0.0, 1.0, 0.0);
      hit.kind = 1u;
      return hit;
    }
    t = out + 1e-4;
    if (tx < tz) {
      cx += sx;
      n = vec3f(-f32(sx), 0.0, 0.0);
    } else {
      cz += sz;
      n = vec3f(0.0, 0.0, -f32(sz));
    }
  }
  return hit;
}

@vertex
fn cover(@builtin(vertex_index) v: u32) -> @builtin(position) vec4f {
  let p = array(vec2f(-1, -3), vec2f(3, 1), vec2f(-1, 1))[v];
  return vec4f(p, 0, 1);
}

@fragment
fn show(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let size = vec2f(B.size);
  let uv = (pos.xy - size * 0.5) / min(size.x, size.y);
  if (B.hidden == 1u) {
    // a curtain: nothing of the build shows through
    let fold = 0.5 + 0.5 * sin(pos.x / min(size.x, size.y) * 60.0);
    return vec4f(vec3f(0.35, 0.05, 0.08) * (0.55 + 0.45 * fold), 1);
  }
  // an orthographic camera above the front right, turned by yaw, looking at the box's middle
  let back = normalize(vec3f(sin(B.yaw), 0.85, -cos(B.yaw)));
  // the right-handed world seen from the front puts +x on the left; mirrored, so x runs left to
  // right on the screen as it does on the building grid, and the left wall is on the left
  let right = -normalize(cross(vec3f(0, 1, 0), back));
  let up = cross(right, back);
  let focus = vec3f(2.4, 1.3, 2.6);
  let scale = 8.6;
  let o = focus + (right * uv.x - up * uv.y) * scale + back * 30.0;
  let d = -back;
  // the planes behind: the back wall (z = 5), the left wall (x = 0), the floor (y = 0)
  var best: Hit;
  best.kind = 0u;
  best.t = 1e9;
  let tb = (f32(N) - o.z) / d.z;
  let pb = o + d * tb;
  if (tb > 0.0 && pb.x >= 0.0 && pb.x <= f32(N) + 0.15 && pb.y >= 0.0 && pb.y <= TALL + 0.6) {
    best.t = tb;
    best.n = vec3f(0, 0, -1);
    best.kind = 2u;
  }
  let tl = (0.0 - o.x) / d.x;
  let pl = o + d * tl;
  if (tl > 0.0 && tl < best.t && pl.z >= 0.0 && pl.z <= f32(N) && pl.y >= 0.0 && pl.y <= TALL + 0.6) {
    best.t = tl;
    best.n = vec3f(1, 0, 0);
    best.kind = 3u;
  }
  let tf = (0.0 - o.y) / d.y;
  let pf = o + d * tf;
  if (tf > 0.0 && tf < best.t && pf.x >= 0.0 && pf.x <= f32(N) && pf.z >= 0.0 && pf.z <= f32(N)) {
    best.t = tf;
    best.n = vec3f(0, 1, 0);
    best.kind = 4u;
  }
  // the player's blocks, in front of all of it
  let blk = trace_blocks(1u, o, d);
  if (blk.kind == 1u && blk.t < best.t) {
    best = blk;
  }
  var col = vec3f(0.08, 0.08, 0.1);
  if (best.kind == 0u) {
    return vec4f(col, 1);
  }
  let p = o + d * best.t;
  let showFront = (B.show & 1u) != 0u;
  let showSide = (B.show & 2u) != 0u;
  let showTop = (B.show & 4u) != 0u;
  let mine = B.mine == 1u;
  if (best.kind == 1u) {
    // a block: clay-coloured, each face lit by the lamp it faces, the grid of blocks drawn in
    let lamp = select(select(0.62, 0.78, best.n.x > 0.5), 1.0, best.n.y > 0.5);
    let lit = select(0.7, 1.0, best.n.z < -0.5);
    var c = vec3f(0.86, 0.6, 0.42) * max(lamp, lit);
    let f = fract(p + 1e-3);
    let edge = min(min(select(1.0, min(f.x, 1.0 - f.x), abs(best.n.x) < 0.5), select(1.0, min(f.y, 1.0 - f.y), abs(best.n.y) < 0.5)), select(1.0, min(f.z, 1.0 - f.z), abs(best.n.z) < 0.5));
    c *= mix(0.7, 1.0, smoothstep(0.0, 0.05, edge));
    // a block standing where the floor's shadow says nothing stands is in the wrong place
    let cell = vec2i(floor(p.xz - best.n.xz * 0.01));
    if (showTop && mine && h_of(0u, cell.x, cell.y) < 0.5) {
      c = mix(c, vec3f(0.9, 0.2, 0.2), 0.5);
    }
    return vec4f(c, 1);
  }
  // a wall or the floor: pale, with the hidden build's shadow dark and the player's over it
  var base = select(vec3f(0.92, 0.9, 0.86), vec3f(0.82, 0.8, 0.76), best.kind == 4u);
  var theirs = false;
  var ours = false;
  var shown = false;
  if (best.kind == 2u) {
    shown = showFront;
    theirs = showFront && front_shadow(0u, p);
    ours = mine && front_shadow(1u, p);
  } else if (best.kind == 3u) {
    shown = showSide;
    theirs = showSide && side_shadow(0u, p);
    ours = mine && side_shadow(1u, p);
  } else {
    shown = showTop;
    theirs = showTop && top_shadow(0u, p);
    ours = false;
  }
  if (!shown) {
    // a wall whose lamp is off: hatched, so it reads as "no clue here"
    let hatch = step(0.5, fract((p.x + p.y + p.z) * 3.0));
    base *= mix(0.8, 0.88, hatch);
  }
  var c = base;
  if (theirs) {
    c = vec3f(0.22, 0.22, 0.26);
  }
  if (ours && theirs) {
    c = mix(c, vec3f(0.15, 0.35, 0.75), 0.55);
  } else if (ours) {
    c = mix(c, vec3f(0.85, 0.2, 0.2), 0.55);
  }
  // the floor's grid, and the wall's grid in block-sized squares
  let g = fract(select(select(p.xz, p.zy, best.kind == 3u), p.xy, best.kind == 2u));
  let line = min(min(g.x, 1.0 - g.x), min(g.y, 1.0 - g.y));
  c *= mix(0.86, 1.0, smoothstep(0.0, 0.03, line));
  return vec4f(c, 1);
}
