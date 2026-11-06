// Fold: a sheet of two-coloured paper folded flat, drawn layer by layer. Each layer is a convex
// polygon where it lies now and an affine map back to the flat sheet; at each pixel the topmost
// layer that covers it is found, the point is mapped back onto the sheet, and the sheet is drawn
// there — its front colour or its cream back, its fibres, and the creases already made in it. Under
// the paper, the target's silhouette is drawn as a ghost with a dashed outline; the paper casts a
// soft shadow on the table, and every layer's edge shows as a fine line, so a stack reads as one.

struct Paper {
  size: vec2u,
  layers: u32,
  creases: u32,
  ghost: u32,
  colour: u32,
  view: vec2f,
  span: f32,
}

const MAX_VERTS = 12u;
const LAYER = 8u;

@group(0) @binding(0) var<uniform> P: Paper;
/** the sheet's layers, bottom to top, 8 vec4 each: 6 of corners, then the map and count and side */
@group(0) @binding(1) var<storage, read> layers: array<vec4f>;
/** the target's layers, the same way */
@group(0) @binding(2) var<storage, read> ghost: array<vec4f>;
/** creases on the flat sheet, as segments */
@group(0) @binding(3) var<storage, read> creases: array<vec4f>;

fn corner(buf: u32, k: u32, i: u32) -> vec2f {
  let v = select(ghost[k * LAYER + i / 2u], layers[k * LAYER + i / 2u], buf == 0u);
  return select(v.zw, v.xy, (i & 1u) == 0u);
}
fn info(buf: u32, k: u32, row: u32) -> vec4f {
  return select(ghost[k * LAYER + 6u + row], layers[k * LAYER + 6u + row], buf == 0u);
}

/** signed distance to a convex counter-clockwise polygon: the largest outside distance of its edges */
fn poly_d(buf: u32, k: u32, p: vec2f) -> f32 {
  let n = u32(info(buf, k, 0u).w);
  var d = -1e9;
  for (var i = 0u; i < min(n, MAX_VERTS); i++) {
    let a = corner(buf, k, i);
    let b = corner(buf, k, (i + 1u) % n);
    let e = normalize(b - a);
    // outward normal of a counter-clockwise edge is to its right
    d = max(d, dot(p - a, vec2f(e.y, -e.x)));
  }
  return d;
}

fn seg(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let ab = b - a;
  let t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-9), 0.0, 1.0);
  return distance(p, a + ab * t);
}

@vertex
fn cover(@builtin(vertex_index) v: u32) -> @builtin(position) vec4f {
  let p = array(vec2f(-1, -3), vec2f(3, 1), vec2f(-1, 1))[v];
  return vec4f(p, 0, 1);
}

/** a pixel to the table: centred on P.view, P.span units across the shorter side, y up (toTable) */
fn to_table(pos: vec2f) -> vec3f {
  let size = vec2f(P.size);
  let k = P.span / min(size.x, size.y);
  return vec3f(P.view.x + (pos.x - size.x * 0.5) * k, P.view.y - (pos.y - size.y * 0.5) * k, k);
}

fn front(c: u32) -> vec3f {
  let cs = array(
    vec3f(0.94, 0.45, 0.38), vec3f(0.3, 0.33, 0.68), vec3f(0.2, 0.62, 0.48), vec3f(0.96, 0.7, 0.2),
    vec3f(0.55, 0.3, 0.55), vec3f(0.15, 0.55, 0.6), vec3f(0.88, 0.3, 0.22), vec3f(0.4, 0.45, 0.52),
  );
  return cs[min(c, 7u)];
}

@fragment
fn show(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let t3 = to_table(pos.xy);
  let p = t3.xy;
  let px = t3.z;
  // the table: a cutting mat, a fine grid in twelfths and a stronger one in quarters
  var col = vec3f(0.16, 0.3, 0.27);
  let g12 = abs(fract(p * 12.0 + 0.5) - 0.5) / 12.0;
  let g4 = abs(fract(p * 4.0 + 0.5) - 0.5) / 4.0;
  col = mix(col, vec3f(0.24, 0.42, 0.38), smoothstep(px, 0.0, min(g12.x, g12.y)) * 0.5);
  col = mix(col, vec3f(0.32, 0.52, 0.47), smoothstep(px * 1.2, 0.0, min(g4.x, g4.y)) * 0.7);
  // the target: a pale ghost with a dashed outline
  var gd = 1e9;
  for (var k = 0u; k < P.ghost; k++) {
    gd = min(gd, poly_d(1u, k, p));
  }
  if (gd < 0.0) {
    col = mix(col, vec3f(0.8, 0.9, 0.86), 0.25);
  }
  let dash = step(0.5, fract((p.x + p.y) * 18.0));
  col = mix(col, vec3f(0.95, 1.0, 0.95), smoothstep(px * 1.5, 0.0, abs(gd)) * dash * 0.9);
  // the paper's shadow on the table, offset down and right
  var sh = 1e9;
  var top = -1;
  var count = 0u;
  var topD = 0.0;
  for (var k = 0u; k < P.layers; k++) {
    sh = min(sh, poly_d(0u, k, p + vec2f(-0.012, 0.016)));
    let d = poly_d(0u, k, p);
    if (d <= 0.0) {
      top = i32(k);
      topD = d;
      count++;
    }
  }
  col *= 1.0 - 0.35 * smoothstep(0.02, -0.01, sh);
  if (top < 0) {
    return vec4f(col, 1);
  }
  let k = u32(top);
  let m0 = info(0u, k, 0u);
  let m1 = info(0u, k, 1u);
  let uv = vec2f(m0.x * p.x + m0.y * p.y + m0.z, m1.x * p.x + m1.y * p.y + m1.z);
  // the sheet at that point: its front colour, or the cream back, with fibres
  var paper = select(vec3f(0.96, 0.93, 0.86), front(P.colour), m1.w > 0.5);
  let fibre = fract(sin(dot(floor(uv * 180.0), vec2f(12.9898, 78.233))) * 43758.5453);
  paper *= 0.97 + 0.04 * fibre;
  // thicker paper is a touch darker: light comes through fewer layers
  paper *= 1.0 - 0.03 * f32(min(count, 8u) - 1u);
  // the creases already in the sheet: a fold leaves a line, a little lighter on one side
  var cd = 1e9;
  for (var i = 0u; i < P.creases; i++) {
    let c = creases[i];
    cd = min(cd, seg(uv, c.xy, c.zw));
  }
  paper = mix(paper, paper * 0.78, smoothstep(px * 1.5, 0.0, cd));
  // the top layer's own edge, so a stack reads as layers
  paper = mix(paper, paper * 0.7, smoothstep(px * 1.6, 0.0, abs(topD)));
  return vec4f(paper, 1);
}
