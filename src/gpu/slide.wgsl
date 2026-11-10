// The Lab's ice puzzle, in one fullscreen pass: every pixel finds its cell and draws the tile —
// ice with a sheen, raised walls, snow, the goal's ring (lit once every coin is taken), any coin
// still waiting — then the trail of the last push and the puck itself, which slides between cells.

struct U {
  // canvas size; the board's corner, in pixels
  view: vec4f,
  // pixels per cell, width, height, time
  grid: vec4f,
  // the puck's centre and where the last push started, in cells
  puck: vec4f,
  // trail strength, the win flash, every coin taken (1), unused
  more: vec4f,
}

@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> tiles: array<f32>;

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

fn hash(p: vec2f) -> f32 {
  let q = vec2u(vec2i(floor(p)) + vec2i(4096));
  var h = q.x * 747796405u + q.y * 2891336453u;
  h = ((h >> ((h >> 28u) + 4u)) ^ h) * 277803737u;
  return f32((h >> 22u) ^ h) / 4294967295.0;
}

@fragment
fn board(in: Cover) -> @location(0) vec4f {
  let s = u.grid.x;
  let w = u.grid.y;
  let h = u.grid.z;
  let t = u.grid.w;
  let g = (in.pos.xy - u.view.zw) / s;
  if (g.x < 0.0 || g.y < 0.0 || g.x >= w || g.y >= h) {
    return vec4f(0.03, 0.04, 0.07, 1.0);
  }
  let c = floor(g);
  let f = g - c;
  let code = tiles[u32(c.y * w + c.x)];
  let tile = code % 4.0;
  let coin = code >= 4.0;
  let all_coins = u.more.z > 0.5;

  // ice: pale blue with a slow diagonal sheen and the odd glint
  var col = vec3f(0.74, 0.86, 0.96) + 0.035 * sin((g.x + g.y) * 2.2 + t * 0.4);
  if (hash(g * 6.0) > 0.992) {
    col += vec3f(0.25) * (0.5 + 0.5 * sin(t * 3.0 + hash(c) * 30.0));
  }
  let e = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)) * s;
  col = mix(col, vec3f(0.62, 0.76, 0.9), clamp(1.0 - e, 0.0, 1.0) * 0.5);
  if (tile == 1.0) {
    // a wall: a raised block, lit from the upper left
    col = vec3f(0.22, 0.25, 0.32);
    if (f.x < 0.12 || f.y < 0.12) {
      col = vec3f(0.34, 0.38, 0.47);
    }
    if (f.x > 0.88 || f.y > 0.88) {
      col = vec3f(0.14, 0.16, 0.21);
    }
  } else if (tile == 2.0) {
    // snow: soft white, a little lumpy
    let n = hash(g * 9.0) * 0.06 + hash(g * 3.0) * 0.05;
    col = vec3f(0.95, 0.96, 0.98) - n;
  } else if (tile == 3.0) {
    // the goal: a dark hole in a ring, the ring lit green once every coin is taken
    let d = length(f - 0.5);
    let ring = clamp(1.0 - abs(d - 0.34) * s * 0.35, 0.0, 1.0);
    let lit = select(vec3f(0.5, 0.55, 0.62), vec3f(0.25, 0.85, 0.45), all_coins);
    col = mix(col, vec3f(0.12, 0.2, 0.32), clamp((0.26 - d) * s, 0.0, 1.0));
    col = mix(col, lit * (0.85 + 0.15 * sin(t * 4.0)), ring);
  }
  if (coin) {
    let d = length(f - 0.5) - 0.2;
    let a = clamp(0.5 - d * s, 0.0, 1.0);
    let shine = clamp(1.0 - length(f - vec2f(0.44, 0.42)) * 9.0, 0.0, 1.0);
    col = mix(col, vec3f(0.98, 0.78, 0.2) + shine * 0.25, a);
  }

  // the last push's trail: a fading streak from where it began to the puck
  let a = u.puck.zw + 0.5;
  let b = u.puck.xy + 0.5;
  let ba = b - a;
  let tt = clamp(dot(g - a, ba) / max(dot(ba, ba), 1e-5), 0.0, 1.0);
  let dt = length(g - a - ba * tt);
  col = mix(col, vec3f(1.0, 1.0, 1.0), u.more.x * tt * clamp((0.22 - dt) * s * 0.5, 0.0, 1.0) * 0.6);

  // the puck: a shadow, then a red disc with a highlight
  let pd = length(g - b);
  col = mix(col, vec3f(0.3, 0.4, 0.55), clamp((0.42 - length(g - b - vec2f(0.06, 0.08))) * s * 0.4, 0.0, 1.0) * 0.5);
  let pa = clamp((0.36 - pd) * s, 0.0, 1.0);
  let hl = clamp(1.0 - length(g - b + vec2f(0.12, 0.12)) * 7.0, 0.0, 1.0);
  col = mix(col, vec3f(0.88, 0.25, 0.22) + hl * 0.4, pa);

  // the win: a brief bright wash
  col = mix(col, vec3f(1.0, 0.98, 0.85), u.more.y * 0.35);
  return vec4f(col, 1.0);
}
