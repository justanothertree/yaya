// The draw half of reaction–diffusion: joined after rd-types.wgsl. Each pixel reads B where it
// falls and is coloured by it — and lit, as if B were a height, so the patterns read as something
// grown rather than something printed.

@group(0) @binding(0) var<uniform> R: RD;
@group(0) @binding(1) var<storage, read> grid: array<vec2f>;

@vertex
fn cover(@builtin(vertex_index) v: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((v << 1u) & 2u), f32(v & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}

// B at a point in cells, smoothly between cells so the surface is not a staircase
fn b_at(g: vec2f) -> f32 {
  let c = vec2i(i32(R.cols), i32(R.rows));
  let f = g - 0.5;
  let i = vec2i(floor(f));
  let t = fract(f);
  let w = vec2i((i.x + c.x) % c.x, (i.y + c.y) % c.y);
  let w1 = vec2i((i.x + 1 + c.x) % c.x, (i.y + 1 + c.y) % c.y);
  let b00 = grid[u32(w.y) * R.cols + u32(w.x)].y;
  let b10 = grid[u32(w.y) * R.cols + u32(w1.x)].y;
  let b01 = grid[u32(w1.y) * R.cols + u32(w.x)].y;
  let b11 = grid[u32(w1.y) * R.cols + u32(w1.x)].y;
  return mix(mix(b00, b10, t.x), mix(b01, b11, t.x), t.y);
}

struct Ramp {
  ground: vec3f,
  low: vec3f,
  high: vec3f,
}

fn ramp(i: u32) -> Ramp {
  switch (i) {
    case 1u: {
      return Ramp(vec3f(0.94, 0.92, 0.86), vec3f(0.35, 0.33, 0.32), vec3f(0.05, 0.05, 0.07)); // ink
    }
    case 2u: {
      return Ramp(vec3f(0.01, 0.01, 0.04), vec3f(0.1, 0.5, 0.9), vec3f(0.95, 0.3, 0.9)); // neon
    }
    case 3u: {
      return Ramp(vec3f(0.12, 0.09, 0.05), vec3f(0.25, 0.45, 0.15), vec3f(0.75, 0.85, 0.4)); // moss
    }
    default: {
      return Ramp(vec3f(0.02, 0.18, 0.24), vec3f(0.85, 0.35, 0.3), vec3f(1.0, 0.82, 0.62)); // coral
    }
  }
}

@fragment
fn shade(@builtin(position) at: vec4f) -> @location(0) vec4f {
  let dims = vec2f(f32(R.cols), f32(R.rows));
  let g = at.xy / R.view * dims;
  let b = b_at(g);
  // light from the top left, off the slope of B — a cheap emboss that makes it look grown
  let e = 0.75;
  let slope = vec2f(b_at(g + vec2f(e, 0.0)) - b_at(g - vec2f(e, 0.0)), b_at(g + vec2f(0.0, e)) - b_at(g - vec2f(0.0, e)));
  let n = normalize(vec3f(-slope * 6.0 * R.light, 1.0));
  let lit = clamp(dot(n, normalize(vec3f(-0.5, -0.6, 0.8))), 0.0, 1.0);
  let r = ramp(R.palette);
  let t = smoothstep(0.08, 0.45, b);
  var col = mix(r.ground, mix(r.low, r.high, smoothstep(0.25, 0.6, b)), t);
  col *= 0.55 + 0.6 * lit;
  return vec4f(col, 1.0);
}
