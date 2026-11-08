// The Lab's graph matcher. One fullscreen pass: the plane's grid and axes, the target curve dashed
// and the one typed solid, each drawn as a polyline through 1024 samples by the distance from the
// pixel to its nearest segments. ⚠️ An undefined point arrives as 1e30, not NaN — a shader may
// assume there are no NaNs — and a segment that would jump more than the plane's height is a gap,
// so 1/x is not joined across its asymptote.

struct U {
  // canvas size; 1 once matched; time
  view: vec4f,
  // the plane: x from, x to, y from, y to
  plane: vec4f,
}

@group(0) @binding(0) var<uniform> u: U;
// SAMPLES target values, then SAMPLES of yours
@group(0) @binding(1) var<storage, read> ys: array<f32>;

const N = 1024u;
const GAP = 1e29;

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

/** the plane fitted into the canvas, keeping its squares square */
fn fit() -> vec3f {
  let w = u.plane.y - u.plane.x;
  let h = u.plane.w - u.plane.z;
  let s = min(u.view.x / w, u.view.y / h);
  return vec3f(s, (u.view.x - w * s) * 0.5, (u.view.y - h * s) * 0.5);
}
fn to_px(x: f32, y: f32, f: vec3f) -> vec2f {
  return vec2f(f.y + (x - u.plane.x) * f.x, f.z + (u.plane.w - y) * f.x);
}

/** pixels from this pixel to curve `which` (0 target, 1 yours), and where along it */
fn curve(p: vec2f, which: u32, f: vec3f) -> vec2f {
  let w = u.plane.y - u.plane.x;
  let x = u.plane.x + (p.x - f.y) / f.x;
  let i = i32(floor((x - u.plane.x) / w * f32(N - 1u)));
  var best = 1e9;
  var at = 0.0;
  let tall = (u.plane.w - u.plane.z) * f.x;
  for (var k = i - 4; k <= i + 4; k++) {
    if (k < 0 || k >= i32(N) - 1) {
      continue;
    }
    let y0 = ys[which * N + u32(k)];
    let y1 = ys[which * N + u32(k + 1)];
    if (abs(y0) > GAP || abs(y1) > GAP) {
      continue;
    }
    let x0 = u.plane.x + w * f32(k) / f32(N - 1u);
    let x1 = u.plane.x + w * f32(k + 1) / f32(N - 1u);
    let a = to_px(x0, y0, f);
    let b = to_px(x1, y1, f);
    if (abs(b.y - a.y) > tall) {
      continue; // an asymptote, not a line
    }
    let ba = b - a;
    let t = clamp(dot(p - a, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
    let d = length(p - a - ba * t);
    if (d < best) {
      best = d;
      at = f32(k) + t;
    }
  }
  return vec2f(best, at);
}

@fragment
fn plot(in: Cover) -> @location(0) vec4f {
  let f = fit();
  let p = in.pos.xy;
  let x = u.plane.x + (p.x - f.y) / f.x;
  let y = u.plane.w - (p.y - f.z) / f.x;
  var col = vec3f(0.98, 0.98, 0.96);
  if (x < u.plane.x || x > u.plane.y || y < u.plane.z || y > u.plane.w) {
    return vec4f(0.92, 0.92, 0.9, 1.0);
  }
  // squares, then the two axes
  let gx = abs(x - round(x)) * f.x;
  let gy = abs(y - round(y)) * f.x;
  col = mix(col, vec3f(0.85, 0.86, 0.88), clamp(1.0 - min(gx, gy), 0.0, 1.0));
  let ax = min(abs(x) * f.x, abs(y) * f.x);
  col = mix(col, vec3f(0.35, 0.37, 0.42), clamp(1.6 - ax, 0.0, 1.0));

  // the target: a blue dashed line, wide enough to see yours inside it
  let t = curve(p, 0u, f);
  let dash = fract(t.y / 7.0) < 0.6;
  if (dash) {
    col = mix(col, vec3f(0.35, 0.55, 0.95), clamp(4.5 - t.x, 0.0, 1.0) * 0.75);
  }
  // yours: solid, orange while it is not there, green when it is
  let m = curve(p, 1u, f);
  let tone = select(vec3f(0.92, 0.42, 0.12), vec3f(0.12, 0.7, 0.35), u.view.z > 0.5);
  col = mix(col, tone, clamp(2.0 - m.x, 0.0, 1.0));
  col = mix(col, tone, exp(-m.x / 3.0) * 0.12);
  return vec4f(col, 1.0);
}
