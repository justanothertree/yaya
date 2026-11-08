// The Lab's palette tool: one pass draws the picture fitted to the stage, either as it is or redrawn
// in nothing but the palette's colours — flat, or dithered — with the original kept to the left of
// a split you can slide, and one colour's share of the picture shown on its own when asked.
//
// ⚠️ NEAREST MEANS NEAREST IN OKLAB, with the matrices palette.ts uses: the palette was found in
// OKLab, so a pixel is given the colour it is perceptually closest to, which is the one the
// clustering counted it towards. Asked in sRGB instead, the posterised picture and the shares under
// the swatches would disagree about the same pixel.

struct U {
  // stage pixels per picture pixel, unused, and where the picture's top-left lands
  view: vec4f,
  // picture width, height; how many colours; which is highlighted (−1 none)
  pic: vec4f,
  // mode (0 picture, 1 flat, 2 dithered); the split, 0..1 across the picture; unused ×2
  how: vec4f,
}

const MAX = 10u;

@group(0) @binding(0) var<uniform> u: U;
// per colour: (L, a, b, highlighted) then (r, g, b, 1)
@group(0) @binding(1) var<storage, read> pal: array<vec4f, 20>;
@group(0) @binding(2) var pic: texture_2d<f32>;
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

fn to_linear(c: vec3f) -> vec3f {
  return select(pow((c + 0.055) / 1.055, vec3f(2.4)), c / 12.92, c <= vec3f(0.04045));
}

fn oklab(c: vec3f) -> vec3f {
  let r = to_linear(c);
  let l = pow(max(0.4122214708 * r.x + 0.5363325363 * r.y + 0.0514459929 * r.z, 0.0), 1.0 / 3.0);
  let m = pow(max(0.2119034982 * r.x + 0.6806995451 * r.y + 0.1073969566 * r.z, 0.0), 1.0 / 3.0);
  let s = pow(max(0.0883024619 * r.x + 0.2817188376 * r.y + 0.6299787005 * r.z, 0.0), 1.0 / 3.0);
  return vec3f(
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  );
}

// the classic 8 × 8 ordered-dither threshold, −0.5..0.5: three levels of the 2 × 2 pattern
// [0 2; 3 1], the finest bits weighted most so neighbouring pixels differ most
fn bayer(p: vec2u) -> f32 {
  var v = 0u;
  for (var i = 0u; i < 3u; i++) {
    let x = (p.x >> i) & 1u;
    let y = (p.y >> i) & 1u;
    v += (2u * (x ^ y) + y) << (2u * (2u - i));
  }
  return (f32(v) + 0.5) / 64.0 - 0.5;
}

@fragment
fn view(in: Cover) -> @location(0) vec4f {
  let px = in.pos.xy;
  let size = u.pic.xy;
  let p = (px - u.view.zw) / u.view.x; // the point of the picture, in its own pixels
  if (p.x < 0.0 || p.y < 0.0 || p.x >= size.x || p.y >= size.y) {
    return vec4f(0.02, 0.02, 0.05, 1.0);
  }
  let uv = p / size;
  let photo = textureSampleLevel(pic, smp, uv, 0.0).rgb;
  let n = min(u32(u.pic.z), MAX);
  let lab = oklab(photo);
  // the nearest colour and the next nearest: the second is what a dithered pixel may borrow
  var best = 0u;
  var next = 0u;
  var bd = 1e9;
  var nd = 1e9;
  for (var i = 0u; i < n; i++) {
    let d = distance(pal[i * 2u].xyz, lab);
    if (d < bd) {
      nd = bd;
      next = best;
      bd = d;
      best = i;
    } else if (d < nd) {
      nd = d;
      next = i;
    }
  }
  var out = photo;
  let after = uv.x >= u.how.y;
  if (after && u.how.x > 0.5 && n > 0u) {
    var k = best;
    if (u.how.x > 1.5 && n > 1u) {
      // how far along the way from the nearest colour to the next this pixel lies, against a
      // threshold that varies pixel to pixel: the two colours mix in the right proportion
      let a = pal[best * 2u].xyz;
      let b = pal[next * 2u].xyz;
      let ab = b - a;
      let f = clamp(dot(lab - a, ab) / max(dot(ab, ab), 1e-9), 0.0, 1.0);
      if (f > bayer(vec2u(p)) + 0.5) {
        k = next;
      }
    }
    out = pal[k * 2u + 1u].rgb;
  }
  // one colour on its own: everything nearer another is greyed back
  let h = i32(u.pic.w);
  if (h >= 0 && i32(best) != h) {
    let grey = dot(out, vec3f(0.2126, 0.7152, 0.0722));
    out = mix(vec3f(grey), vec3f(0.05), 0.55);
  }
  // the split: a hairline with a dark edge, so it shows on light and dark pictures alike
  let sx = u.how.y * size.x * u.view.x + u.view.z;
  let d = abs(px.x - sx);
  if (u.how.x > 0.5 && u.how.y > 0.0 && u.how.y < 1.0) {
    if (d < 1.0) {
      out = vec3f(1.0);
    } else if (d < 2.5) {
      out = mix(out, vec3f(0.0), 0.6);
    }
  }
  return vec4f(out, 1.0);
}
