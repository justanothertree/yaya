// The Lab's soaring game, side-on: sky, a cumulus over every thermal at cloudbase (on a day with
// clouds), the ground, the finish, the glider and the trail it has flown. Heights are drawn far
// taller than distances — a true 1-in-31 glide would be a flat line — and the page says so.

struct U {
  // canvas size; metres of course at the left edge; pixels per metre along the course
  view: vec4f,
  // pixels per metre of height; cloudbase; the finish; time
  more: vec4f,
  // the glider: x, h, circling (0/1), number of thermals
  glider: vec4f,
  // clouds shown (0/1), trail points, unused, unused
  how: vec4f,
}

@group(0) @binding(0) var<uniform> u: U;
// thermals first (x, r, lift, 0) × 16, then the trail as pairs (x0, h0, x1, h1)
@group(0) @binding(1) var<storage, read> data: array<vec4f>;

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

const GROUND = 0.1; // the ground line, as a fraction of the height up from the bottom

fn hash1(x: f32) -> f32 {
  return fract(sin(x * 127.1) * 43758.5453);
}

fn noise2(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let s = f * f * (3.0 - 2.0 * f);
  let a = hash1(i.x + i.y * 57.0);
  let b = hash1(i.x + 1.0 + i.y * 57.0);
  let c = hash1(i.x + (i.y + 1.0) * 57.0);
  let d = hash1(i.x + 1.0 + (i.y + 1.0) * 57.0);
  return mix(mix(a, b, s.x), mix(c, d, s.x), s.y);
}

// the canvas point of a course point (x m along, h m up)
fn screen(x: f32, h: f32) -> vec2f {
  return vec2f((x - u.view.z) * u.view.w, u.view.y * (1.0 - GROUND) - h * u.more.x);
}

fn seg(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let ab = b - a;
  let t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
  return length(p - a - ab * t);
}

@fragment
fn scene(in: Cover) -> @location(0) vec4f {
  let px = in.pos.xy;
  let groundY = u.view.y * (1.0 - GROUND);
  let x = u.view.z + px.x / u.view.w; // course metres under this pixel
  let h = (groundY - px.y) / u.more.x; // height of this pixel
  let t = u.more.w;

  // sky: deep blue up high, hazy near the ground
  var col = mix(vec3f(0.78, 0.86, 0.93), vec3f(0.3, 0.52, 0.82), clamp(h / (u.more.y * 1.4), 0.0, 1.0));

  // cumulus over each thermal, its base flat at cloudbase and its top heaped by noise
  if (u.how.x > 0.5) {
    let n = u32(u.glider.w);
    for (var i = 0u; i < n; i++) {
      let th = data[i];
      let w = th.y * (1.6 + 0.3 * th.z);
      let dx = (x - th.x) / w;
      if (abs(dx) > 1.3) { continue; }
      let top = u.more.y + (140.0 + 90.0 * th.z) * (1.0 - dx * dx) + 50.0 * noise2(vec2f(x / 120.0, t * 0.02 + f32(i)));
      if (h > u.more.y && h < top && abs(dx) < 1.0) {
        let shade = clamp((h - u.more.y) / (top - u.more.y), 0.0, 1.0);
        col = mix(col, mix(vec3f(0.78, 0.8, 0.84), vec3f(1.0), shade), 0.92);
      }
    }
  }

  // the ground: fields in strips, darker with distance down the screen
  if (px.y > groundY) {
    let strip = step(0.5, fract(x / 900.0));
    col = mix(vec3f(0.42, 0.58, 0.32), vec3f(0.5, 0.64, 0.36), strip) * (1.0 - 0.3 * (px.y - groundY) / (u.view.y * GROUND));
  }

  // the finish: a chequered pole and a line across the sky
  let fx = screen(u.more.z, 0.0).x;
  if (abs(px.x - fx) < 3.0 && px.y < groundY + 2.0) {
    let chk = step(0.5, fract(px.y / 14.0));
    col = mix(vec3f(0.1), vec3f(0.98), chk);
  }

  // the trail, faint
  let tn = u32(u.how.y);
  for (var i = 0u; i < tn; i++) {
    let s = data[16u + i];
    let a = screen(s.x, s.y);
    let b = screen(s.z, s.w);
    // most pixels are nowhere near a given piece of trail: skip it on its span alone
    if (px.x < min(a.x, b.x) - 3.0 || px.x > max(a.x, b.x) + 3.0) { continue; }
    let d = seg(px, a, b);
    col = mix(col, vec3f(1.0, 0.98, 0.9), (1.0 - smoothstep(0.6, 1.6, d)) * 0.55);
  }

  // the glider: a fuselage and tail, side-on; circling, the wing shows as a short stroke that
  // swings as it turns
  let g = screen(u.glider.x, u.glider.y);
  let q = px - g;
  var d = seg(q, vec2f(-14.0, 0.0), vec2f(12.0, 0.0));
  d = min(d, seg(q, vec2f(-14.0, 0.0), vec2f(-17.0, -8.0)));
  if (u.glider.z > 0.5) {
    let swing = sin(t * 4.0) * 12.0;
    d = min(d, seg(q, vec2f(0.0, -swing * 0.25), vec2f(swing, swing * 0.15)));
  } else {
    d = min(d, seg(q, vec2f(-3.0, -1.5), vec2f(5.0, -1.5)));
  }
  col = mix(col, vec3f(0.98, 0.98, 1.0), 1.0 - smoothstep(1.2, 2.2, d));
  col = mix(col, vec3f(0.1, 0.12, 0.18), 1.0 - smoothstep(2.2, 3.2, d) - (1.0 - smoothstep(1.2, 2.2, d)));
  return vec4f(col, 1.0);
}
