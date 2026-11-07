// Print shop: a reduction linocut. `carve` lowers the lino block under one segment of a cut — only
// the texels in the segment's box are dispatched — by `carveHeight` in printshop.ts, line for line.
// `press` pulls a print: every texel of the paper takes ink from the MIRRORED texel of the block where
// it stands proud, broken by the paper's grain (`inkOn`), laid over what the paper already holds
// (`layer`). `show` draws the block — lit by the slope of its own surface, fresh cuts paler, a film of
// the last ink on what still stands — beside (or above) the print.

struct Shop {
  size: vec2u,
  block: vec2u,
  seg: vec4f,
  gouge: u32,
  pressure: f32,
  seed: u32,
  points: u32,
  ink: vec4f,
  last: vec4f,
}

const SURFACE = 0.6;
const V_R = 2.2;
const U_R = 5.0;
const SCOOP_R = 13.0;

@group(0) @binding(0) var<uniform> S: Shop;
@group(0) @binding(1) var<storage, read_write> height: array<f32>;
@group(0) @binding(2) var<storage, read_write> paper: array<vec4f>;
@group(0) @binding(3) var<storage, read> pts: array<vec2f>;

fn radius() -> f32 {
  return select(select(SCOOP_R, U_R, S.gouge == 1u), V_R, S.gouge == 0u);
}

/** one segment of a cut at a texel: `carveHeight` in printshop.ts */
fn cut(h: f32, p: vec2f, a: vec2f, b: vec2f, r: f32) -> f32 {
  let ab = b - a;
  let l = dot(ab, ab);
  let t = select(clamp(dot(p - a, ab) / l, 0.0, 1.0), 0.0, l == 0.0);
  let d = distance(p, a + ab * t);
  if (d >= r) {
    return h;
  }
  let x = d / r;
  var wall = x;
  if (S.gouge == 1u) {
    wall = 1.0 - sqrt(max(0.0, 1.0 - x * x));
  } else if (S.gouge == 2u) {
    wall = max(0.0, (x - 0.8) / 0.2);
  }
  return min(h, wall);
}

/** a whole cut, dispatched over its box (`cutBox`): the lowest any segment takes a texel to */
@compute @workgroup_size(8, 8)
fn carve(@builtin(global_invocation_id) id: vec3u) {
  let c = vec2u(S.seg.xy) + id.xy;
  if (f32(c.x) > S.seg.z || f32(c.y) > S.seg.w || c.x >= S.block.x || c.y >= S.block.y) {
    return;
  }
  let p = vec2f(c) + 0.5;
  let r = radius();
  let i = c.y * S.block.x + c.x;
  var h = height[i];
  let n = max(S.points, 1u);
  for (var k = 0u; k < n; k++) {
    h = min(h, cut(h, p, pts[k], pts[min(k + 1u, n - 1u)], r));
  }
  height[i] = h;
}

/** the paper's grain: an integer hash, the same bits as `grain` in printshop.ts */
fn grain(x: u32, y: u32, seed: u32) -> f32 {
  var n = x * 374761393u + y * 668265263u + seed * 1442695041u;
  n = (n ^ (n >> 13u)) * 1274126177u;
  n = n ^ (n >> 16u);
  return f32(n) / 4294967296.0;
}

@compute @workgroup_size(8, 8)
fn press(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= S.block.x || id.y >= S.block.y) {
    return;
  }
  // the block turned over: the paper's left is the block's right
  let bx = S.block.x - 1u - id.x;
  let h = height[id.y * S.block.x + bx];
  let stand = clamp((h - SURFACE) / 0.15, 0.0, 1.0);
  let g = grain(id.x, id.y, S.seed);
  let take = clamp((S.pressure * 1.25 - g * 0.6) * 2.0, 0.0, 1.0);
  let a = stand * take * 0.92;
  let i = id.y * S.block.x + id.x;
  let was = paper[i].rgb;
  paper[i] = vec4f(was * (1.0 - a) + was * S.ink.rgb * a, 1.0);
}

// ---------------------------------------------------------------- drawing

@vertex
fn cover(@builtin(vertex_index) v: u32) -> @builtin(position) vec4f {
  let p = array(vec2f(-1, -3), vec2f(3, 1), vec2f(-1, 1))[v];
  return vec4f(p, 0, 1);
}

struct Place {
  tall: bool,
  s: f32,
  block: vec2f,
  print: vec2f,
}

/** where the block and the print sit: `layout` in printshop.ts */
fn place() -> Place {
  let w = f32(S.size.x);
  let h = f32(S.size.y);
  var out: Place;
  out.tall = h > w * 1.05;
  let cellW = select(w * 0.5, w, out.tall);
  let cellH = select(h, h * 0.5, out.tall);
  let bw = f32(S.block.x);
  let bh = f32(S.block.y);
  out.s = min(cellW * 0.92 / bw, cellH * 0.92 / bh);
  let c0 = select(vec2f(cellW * 0.5, h * 0.5), vec2f(w * 0.5, cellH * 0.5), out.tall);
  let c1 = select(vec2f(cellW * 1.5, h * 0.5), vec2f(w * 0.5, cellH * 1.5), out.tall);
  out.block = c0 - vec2f(bw, bh) * out.s * 0.5;
  out.print = c1 - vec2f(bw, bh) * out.s * 0.5;
  return out;
}

fn texel(c: vec2i) -> u32 {
  let k = clamp(c, vec2i(0), vec2i(S.block) - 1);
  return u32(k.y) * S.block.x + u32(k.x);
}

/** the block's height between texel centres: shown at any scale, a cut does not step or bead */
fn h_at(q: vec2f) -> f32 {
  let p = q - 0.5;
  let c = vec2i(floor(p));
  let f = p - floor(p);
  let top = mix(height[texel(c)], height[texel(c + vec2i(1, 0))], f.x);
  let bottom = mix(height[texel(c + vec2i(0, 1))], height[texel(c + vec2i(1, 1))], f.x);
  return mix(top, bottom, f.y);
}

/** the paper's colour between texel centres, the same way */
fn paper_at(q: vec2f) -> vec3f {
  let p = q - 0.5;
  let c = vec2i(floor(p));
  let f = p - floor(p);
  let top = mix(paper[texel(c)].rgb, paper[texel(c + vec2i(1, 0))].rgb, f.x);
  let bottom = mix(paper[texel(c + vec2i(0, 1))].rgb, paper[texel(c + vec2i(1, 1))].rgb, f.x);
  return mix(top, bottom, f.y);
}

@fragment
fn show(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let pl = place();
  var col = vec3f(0.2, 0.18, 0.17);
  let bsize = vec2f(S.block);
  // the block: lino on a wooden backing, lit from the upper left by the slope of its own surface
  let qb = (pos.xy - pl.block) / pl.s;
  if (qb.x >= 0.0 && qb.y >= 0.0 && qb.x < bsize.x && qb.y < bsize.y) {
    let h = h_at(qb);
    let dx = h_at(qb + vec2f(1, 0)) - h_at(qb - vec2f(1, 0));
    let dy = h_at(qb + vec2f(0, 1)) - h_at(qb - vec2f(0, 1));
    let n = normalize(vec3f(-dx * 2.0, -dy * 2.0, 1.0));
    let lit = 0.6 + 0.4 * max(dot(n, normalize(vec3f(-0.5, -0.6, 0.65))), 0.0);
    // the surface is the lino's own warm grey; a cut shows the paler body underneath
    var c = mix(vec3f(0.8, 0.72, 0.6), vec3f(0.5, 0.42, 0.36), smoothstep(0.2, SURFACE, h));
    // what still stands carries a film of the last ink pulled
    if (S.last.a > 0.0) {
      c = mix(c, c * S.last.rgb * 1.2, smoothstep(SURFACE, SURFACE + 0.15, h) * 0.7);
    }
    col = c * lit;
  }
  // the print: the paper and every ink laid on it, on a soft shadow
  let qp = (pos.xy - pl.print) / pl.s;
  if (qp.x >= 0.0 && qp.y >= 0.0 && qp.x < bsize.x && qp.y < bsize.y) {
    col = paper_at(qp);
  } else {
    // a soft shadow under the sheet, down and to the right
    let off = qp - vec2f(3.0, 4.0);
    if (off.x >= 0.0 && off.y >= 0.0 && off.x < bsize.x && off.y < bsize.y) {
      col *= 0.7;
    }
  }
  return vec4f(col, 1);
}
