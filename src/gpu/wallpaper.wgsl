// The Lab's wallpaper: every pixel of the wall asks the drawing in one cell under each operation of
// the group, and is inked by whatever any of them finds. The hits are blended in an order that does
// not matter — coverage is the strongest hit, colour the coverage-weighted mean — so the picture is
// as symmetric as the group, whichever operation happens to be asked first.

struct U {
  // target size; where the plane's origin lands, in pixels
  view: vec4f,
  // pixels per unit of the plane; how many operations; lattice (0 square, 1 hex); show the cells
  more: vec4f,
  // background colour
  paper: vec4f,
}

@group(0) @binding(0) var<uniform> u: U;
// per operation: (a, b, c, d) then (e, f, 0, 0) — on fractional coordinates
@group(0) @binding(1) var<storage, read> ops: array<vec4f>;
@group(0) @binding(2) var cell: texture_2d<f32>;
@group(0) @binding(3) var smp: sampler;

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

fn to_frac(p: vec2f) -> vec2f {
  if (u.more.z < 0.5) {
    return p;
  }
  // the hexagonal setting: a = (1, 0), b = (−½, √3⁄2)
  let s3 = 0.8660254037844386;
  return vec2f(p.x + p.y * 0.5 / s3, p.y / s3);
}

@fragment
fn wall(in: Cover) -> @location(0) vec4f {
  let p = vec2f(in.pos.x - u.view.z, u.view.w - in.pos.y) / u.more.x;
  let f = to_frac(p);
  let n = u32(u.more.y);
  var cover = 0.0;
  var sum = vec3f(0.0);
  var weight = 0.0;
  for (var i = 0u; i < n; i++) {
    let m = ops[i * 2u];
    let t = ops[i * 2u + 1u];
    let q = vec2f(m.x * f.x + m.y * f.y + t.x, m.z * f.x + m.w * f.y + t.y);
    let s = textureSampleLevel(cell, smp, fract(q), 0.0);
    cover = max(cover, s.a);
    sum += s.rgb * s.a;
    weight += s.a;
  }
  var col = u.paper.rgb;
  if (weight > 0.0) {
    col = mix(col, sum / weight, cover);
  }
  // the cells' edges, when asked: where a fractional coordinate is near a whole number
  if (u.more.w > 0.5) {
    let g = abs(f - round(f));
    let d = min(g.x, g.y) * u.more.x;
    col = mix(col, vec3f(0.5, 0.5, 0.6), 0.6 * (1.0 - smoothstep(0.5, 1.5, d)));
  }
  return vec4f(col, 1.0);
}
