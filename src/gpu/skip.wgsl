// The Lab's stone-skipping game, seen from the side: sky and far hills, a lake whose near edge is the
// water line, a ring spreading on the surface wherever the stone touched (squashed, because the
// surface is seen at a low angle) with a splash for the first moments, the bank, a bridge seen end-on,
// a buoy, the stone at its tilt, and before a throw the stone wobbling in the hand and the arc it would
// fly. One fullscreen pass; metres throughout, the water at y = 0.

struct U {
  // canvas size, metres at the left edge, pixels per metre
  view: vec4f,
  // the stone: x, y, tilt (degrees), shown (0/1)
  stone: vec4f,
  // the aim: speed, angle (degrees), shown (0/1), time (s)
  aim: vec4f,
  // the course: shore x, bridge at, bridge width, bridge underside (0: no bridge)
  course: vec4f,
  // buoy x (0: none), touches, the water line's height on the canvas (0..1 from the bottom), hand tilt
  more: vec4f,
}

@group(0) @binding(0) var<uniform> u: U;
// per touch: x, the time it happened
@group(0) @binding(1) var<storage, read> touches: array<vec2f>;

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

const HAND = 1.0;
const G = 9.81;
const STONE = vec2f(0.16, 0.045); // half-sizes, drawn about twice life size so a phone can see it

fn hash1(x: f32) -> f32 {
  return fract(sin(x * 127.1) * 43758.5453);
}

fn noise1(x: f32) -> f32 {
  let i = floor(x);
  let f = fract(x);
  let s = f * f * (3.0 - 2.0 * f);
  return mix(hash1(i), hash1(i + 1.0), s);
}

// coverage of a rotated ellipse, soft over about a pixel
fn ellipse(p: vec2f, c: vec2f, half: vec2f, deg: f32, px: f32) -> f32 {
  let a = radians(deg);
  let d = p - c;
  let q = vec2f(d.x * cos(a) + d.y * sin(a), -d.x * sin(a) + d.y * cos(a)) / half;
  let r = length(q);
  return 1.0 - smoothstep(1.0 - px / min(half.x, half.y), 1.0, r);
}

fn stone(col: vec3f, p: vec2f, c: vec2f, tilt: f32, px: f32) -> vec3f {
  let k = ellipse(p, c, STONE, tilt, px);
  // lit from above: a pale rim on the upper face
  let a = radians(tilt);
  let up = dot(p - c, vec2f(-sin(a), cos(a))) / STONE.y;
  let shade = mix(vec3f(0.26, 0.27, 0.3), vec3f(0.62, 0.62, 0.6), smoothstep(-0.2, 0.9, up));
  return mix(col, shade, k);
}

@fragment
fn scene(in: Cover) -> @location(0) vec4f {
  let s = u.view.w;
  let px = 1.0 / s;
  let line = u.view.y * (1.0 - u.more.z);
  let p = vec2f(u.view.z + in.pos.x / s, (line - in.pos.y) / s);
  let t = u.aim.w;

  var col: vec3f;
  if (p.y >= 0.0) {
    // sky, warm low down, and hills far off moving at a third of the pace
    let h = clamp(p.y / 6.0, 0.0, 1.0);
    col = mix(vec3f(0.96, 0.84, 0.7), vec3f(0.42, 0.62, 0.86), sqrt(h));
    let far = u.view.z * 0.3 + in.pos.x / s;
    let hill = 0.9 + 0.7 * noise1(far * 0.12) + 0.35 * noise1(far * 0.5);
    col = mix(col, vec3f(0.42, 0.55, 0.5), smoothstep(px, 0.0, p.y - hill) * 0.85);
  } else {
    // the lake: lighter at the surface, deeper blue below, glints drifting along it
    let d = clamp(-p.y / 3.0, 0.0, 1.0);
    col = mix(vec3f(0.33, 0.55, 0.66), vec3f(0.06, 0.18, 0.3), sqrt(d));
    // glints in horizontal streaks, the way light lies on a lake seen low
    let glint = noise1(p.x * 3.0 + t * 0.4) * noise1(p.y * 30.0 + noise1(p.x * 0.7) * 4.0);
    col += vec3f(0.9) * smoothstep(0.72, 0.95, glint) * (1.0 - d) * 0.35;
    // ripples: the surface is the band just under the water line, seen almost edge-on
    let n = u32(u.more.y);
    for (var i = 0u; i < n; i++) {
      let tc = touches[i];
      let age = t - tc.y;
      if (age < 0.0 || age > 6.0) { continue; }
      let r = 0.25 + 0.55 * age;
      let e = length(vec2f(p.x - tc.x, (p.y + 0.18) / 0.2));
      let ring = exp(-pow((e - r) / (0.05 + 0.02 * age), 2.0));
      col += vec3f(0.85, 0.93, 1.0) * ring * exp(-age / 1.8) * 0.55;
    }
  }

  // splashes: droplets thrown up for half a second after each touch
  let n = u32(u.more.y);
  for (var i = 0u; i < n; i++) {
    let tc = touches[i];
    let age = t - tc.y;
    if (age < 0.0 || age > 0.6) { continue; }
    for (var j = 0; j < 5; j++) {
      let fj = f32(j);
      let vx = (hash1(fj + tc.x * 3.1) - 0.5) * 1.6;
      let vy = 1.2 + 1.6 * hash1(fj * 7.3 + tc.x);
      let d = vec2f(tc.x + vx * age, vy * age - 0.5 * G * age * age);
      if (d.y < 0.0) { continue; }
      let k = 1.0 - smoothstep(0.02, 0.02 + px * 1.5, length(p - d));
      col = mix(col, vec3f(0.9, 0.96, 1.0), k * (1.0 - age / 0.6));
    }
  }

  // the near bank under the thrower, and the far shore
  if (p.x < 0.4 && p.y < 0.5 - max(0.0, p.x) * 1.4) {
    col = mix(col, vec3f(0.45, 0.38, 0.3), 1.0);
  }
  let shore = u.course.x;
  let bank = min(0.7, 0.35 * (p.x - shore));
  if (p.x > shore && p.y < bank) {
    let grass = smoothstep(bank - 0.12, bank - 0.04, p.y);
    col = mix(vec3f(0.78, 0.68, 0.48), vec3f(0.36, 0.56, 0.3), grass);
  }

  // a bridge, seen end-on: the deck, and a pier behind it in shadow
  if (u.course.w > 0.0) {
    let a = u.course.y;
    let w = u.course.z;
    let under = u.course.w;
    if (p.x > a + w * 0.35 && p.x < a + w * 0.65 && p.y < under && p.y > -1.0) {
      col = mix(col, vec3f(0.3, 0.27, 0.27), 0.55);
    }
    if (p.x > a && p.x < a + w && p.y > under && p.y < under + 0.35) {
      col = vec3f(0.5, 0.36, 0.26) * (0.8 + 0.2 * step(under + 0.3, p.y));
    }
  }

  // a buoy, bobbing
  if (u.more.x > 0.0) {
    let bob = 0.04 * sin(t * 2.1);
    let c = vec2f(u.more.x, 0.12 + bob);
    let k = ellipse(p, c, vec2f(0.16, 0.2), 0.0, px);
    let stripe = step(0.0, sin((p.y - bob) * 40.0));
    col = mix(col, mix(vec3f(0.85, 0.2, 0.15), vec3f(0.95), stripe), k);
  }

  // the aim: the arc the throw would fly, as dots
  if (u.aim.z > 0.5) {
    let a = radians(u.aim.y);
    let v = vec2f(cos(a), sin(a)) * u.aim.x;
    for (var j = 1; j < 18; j++) {
      let tt = f32(j) * 0.05;
      let d = vec2f(v.x * tt, HAND + v.y * tt - 0.5 * G * tt * tt);
      if (d.y < 0.0) { break; }
      let k = 1.0 - smoothstep(0.03, 0.03 + px * 1.5, length(p - d));
      col = mix(col, vec3f(1.0, 0.98, 0.9), k * (1.0 - f32(j) / 20.0));
    }
    col = stone(col, p, vec2f(0.0, HAND), u.more.w, px);
  }

  if (u.stone.w > 0.5) {
    col = stone(col, p, u.stone.xy, u.stone.z, px);
  }
  return vec4f(col, 1.0);
}
