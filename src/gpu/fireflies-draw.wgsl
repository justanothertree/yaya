// The meadow at night and every firefly as a glow, bright for a moment after its clock passes the
// top. Additive, so where many flash together the dark lights up. Joined after fireflies-types.wgsl.

@group(0) @binding(1) var<storage, read> flies: array<vec4f>;

struct Back {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn cover(@builtin(vertex_index) v: u32) -> Back {
  let p = vec2f(f32((v << 1u) & 2u), f32(v & 2u));
  var o: Back;
  o.clip = vec4f(p * 2.0 - 1.0, 0.0, 1.0);
  o.uv = vec2f(p.x, 1.0 - p.y);
  return o;
}

@fragment
fn night(px: Back) -> @location(0) vec4f {
  // sky to meadow, and a ragged line of grass along the bottom
  var c = mix(vec3f(0.02, 0.03, 0.07), vec3f(0.01, 0.03, 0.03), px.uv.y);
  let x = px.uv.x * 90.0;
  let grass = 0.88 - 0.05 * abs(sin(x * 1.7)) - 0.04 * abs(sin(x * 0.63 + 1.0));
  if (px.uv.y > grass) {
    c = vec3f(0.005, 0.015, 0.01);
  }
  // where a finger tapped, a soft lantern for a moment, so a tap is seen even before it is followed
  let aspect = f32(F.size.x) / f32(F.size.y);
  let d = (px.uv - F.tap.xy) * vec2f(aspect, 1.0);
  c += vec3f(0.55, 0.75, 0.25) * F.tap.z * 0.35 * exp(-dot(d, d) * 90.0);
  return vec4f(c, 1.0);
}

// mirrors `glow` in fireflies.ts: a quick flash just past the top of the clock
fn glow(theta: f32) -> f32 {
  let t = theta / TAU;
  return exp(-pow(t / 0.06, 2.0)) + 0.25 * exp(-pow((t - 0.06) / 0.08, 2.0));
}

struct Px {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
  @location(1) light: f32,
}

@vertex
fn fly(@builtin(vertex_index) v: u32) -> Px {
  let i = v / 6u;
  let corner = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));
  let c = corner[v % 6u];
  let f = flies[i];
  let light = glow(f.z);
  // a glow a few pixels across, a little bigger when it flashes
  let r = (3.0 + 7.0 * light) * f32(F.size.y) / 700.0;
  let p = f.xy * vec2f(F.size) + c * r;
  var o: Px;
  o.clip = vec4f(p.x / f32(F.size.x) * 2.0 - 1.0, 1.0 - p.y / f32(F.size.y) * 2.0, 0.0, 1.0);
  o.uv = c;
  o.light = light;
  return o;
}

@fragment
fn spark(px: Px) -> @location(0) vec4f {
  let d = dot(px.uv, px.uv);
  let core = exp(-d * 6.0);
  let a = (0.04 + px.light) * core;
  return vec4f(vec3f(0.75, 1.0, 0.35) * a, a);
}
