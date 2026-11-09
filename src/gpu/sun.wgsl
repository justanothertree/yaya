// The Lab's sun path: a panorama of the sky — north at both edges, south in the middle, the
// horizon a little below centre — shaded for where the sun is: blue by day, through orange and
// violet twilight near the sun as it sets, to a starry night. Over it the sun with its glow and the
// day's path as a dotted arc; in the game, a ring where the guess went and a line to the truth.

struct U {
  // canvas size; time; sun elevation (degrees)
  view: vec4f,
  // sun in pixels; guess in pixels
  marks: vec4f,
  // show the sun (1); show the guess (1); show the path (1); points on the path
  flags: vec4f,
  // panorama: degrees up at the top, degrees down at the bottom; sun azimuth (degrees); unused
  pano: vec4f,
}

@group(0) @binding(0) var<uniform> u: U;
// the day's path, in pixels
@group(0) @binding(1) var<storage, read> path: array<vec2f>;

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
fn sky(in: Cover) -> @location(0) vec4f {
  let size = u.view.xy;
  let t = u.view.z;
  let sun_el = u.view.w;
  let p = in.pos.xy;
  let span = u.pano.x - u.pano.y;
  let horizon = size.y * (u.pano.x / span);
  let el = (horizon - p.y) / size.y * span; // degrees above the horizon at this pixel
  let az = p.x / size.x * 360.0;

  // how much daylight: full above 6°, gone by the end of civil twilight at −6°
  let day = smoothstep(-6.0, 6.0, sun_el);
  let low = 1.0 - smoothstep(0.0, 18.0, sun_el); // the sun low enough to colour the sky
  var daz = abs(az - u.pano.z);
  daz = min(daz, 360.0 - daz);

  var col: vec3f;
  if (el >= 0.0) {
    let up = pow(clamp(el / 90.0, 0.0, 1.0), 0.45);
    let blue = mix(vec3f(0.72, 0.84, 0.96), vec3f(0.2, 0.45, 0.88), up);
    let night = mix(vec3f(0.05, 0.07, 0.16), vec3f(0.01, 0.015, 0.05), up);
    col = mix(night, blue, day);
    // the low sun's colours: orange near it and near the horizon, violet a little higher
    let near = exp(-daz / 55.0) * exp(-el / 14.0);
    let glowing = low * smoothstep(-10.0, -1.0, sun_el);
    col = mix(col, vec3f(1.0, 0.55, 0.25), near * glowing * 0.85);
    col = mix(col, vec3f(0.55, 0.35, 0.6), exp(-daz / 90.0) * exp(-abs(el - 12.0) / 10.0) * glowing * 0.35);
    // stars, once the sky is dark
    if (hash(p * 0.5) > 0.9965) {
      col += vec3f(0.8) * (1.0 - smoothstep(-12.0, -4.0, sun_el)) * (0.6 + 0.4 * sin(t * 2.0 + hash(p) * 40.0));
    }
  } else {
    // the ground: grass by day, nearly black by night, a soft band at the horizon
    let g = mix(vec3f(0.04, 0.05, 0.05), vec3f(0.3, 0.42, 0.22), day * 0.9 + 0.1 * low);
    col = g * (0.75 + 0.25 * exp(el / 6.0));
  }
  // lines: every 15° up, every 45° round, the horizon itself
  let deg = size.y / span;
  let lat_line = abs(el / 15.0 - round(el / 15.0)) * 15.0 * deg;
  if (el > 0.0 && lat_line < 0.7) {
    col = mix(col, vec3f(1.0), 0.12);
  }
  let lon_line = abs(az / 45.0 - round(az / 45.0)) * 45.0 * size.x / 360.0;
  if (el > -2.0 && lon_line < 0.7) {
    col = mix(col, vec3f(1.0), select(0.12, 0.3, i32(round(az / 45.0)) % 2 == 0));
  }
  col = mix(col, vec3f(0.95, 0.95, 0.9), clamp(1.2 - abs(p.y - horizon), 0.0, 1.0) * 0.6);

  // the day's path, dotted
  if (u.flags.z > 0.5) {
    let n = u32(u.flags.w);
    var best = 1e9;
    var along = 0.0;
    for (var i = 0u; i + 1u < n; i++) {
      let a = path[i];
      let b = path[i + 1u];
      if (abs(b.x - a.x) > size.x * 0.5) {
        continue; // it crossed north, from one edge to the other
      }
      let ba = b - a;
      let k = clamp(dot(p - a, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
      let d = length(p - a - ba * k);
      if (d < best) {
        best = d;
        along = f32(i) + k;
      }
    }
    if (fract(along / 2.0) < 0.55) {
      col = mix(col, vec3f(1.0, 0.92, 0.55), clamp(2.0 - best, 0.0, 1.0) * 0.75);
    }
  }
  // the sun: a disc and a glow — or, below the horizon, only an outline: where it is, not a light
  // shining up through the ground
  if (u.flags.x > 0.5) {
    let d = length(p - u.marks.xy);
    let r = max(7.0, size.y * 0.018);
    if (sun_el > -0.833) {
      col += vec3f(1.0, 0.85, 0.5) * exp(-d / (r * 3.0)) * 0.5;
      col = mix(col, vec3f(1.0, 0.97, 0.85), clamp(r - d, 0.0, 1.0));
    } else {
      col = mix(col, vec3f(1.0, 0.9, 0.6), clamp(1.5 - abs(d - r), 0.0, 1.0) * 0.8);
    }
  }
  // the guess: a ring, and a line to the sun once the sun is shown
  if (u.flags.y > 0.5) {
    let g = u.marks.zw;
    let ring = abs(length(p - g) - 11.0);
    col = mix(col, vec3f(0.2, 0.9, 1.0), clamp(2.0 - ring, 0.0, 1.0));
    if (u.flags.x > 0.5) {
      let ba = u.marks.xy - g;
      let k = clamp(dot(p - g, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
      let d = length(p - g - ba * k);
      if (fract(k * length(ba) / 10.0) < 0.5) {
        col = mix(col, vec3f(0.2, 0.9, 1.0), clamp(1.5 - d, 0.0, 1.0) * 0.8);
      }
    }
  }
  return vec4f(col, 1.0);
}
