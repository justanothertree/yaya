// The draw half: joined after swarm-types.wgsl, which declares Params and Particle.
//
// ⚠️ NOT INSTANCED, and the reason was measured rather than guessed. Drawing each particle as a
// four-vertex instance is the textbook version, and tiny instances are a known weak spot: on the
// software renderer this was checked with, 32K instanced quads took 870ms a frame where the same
// dots as one plain draw of 6 × count vertices took 66ms. So the vertex shader pulls its own
// particle from the buffer by vertex_index / 6 and its corner by vertex_index % 6.

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> parts: array<Particle>;

struct Dot {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
  @location(1) heat: f32,
}

// two triangles per dot
const CORNERS = array<vec2f, 6>(
  vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
  vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
);

@vertex
fn dot_vertex(@builtin(vertex_index) v: u32) -> Dot {
  let q = parts[v / 6u];
  var corners = CORNERS;
  let c = corners[v % 6u];
  var o: Dot;
  o.clip = vec4f((q.pos.x + c.x * P.size) / P.aspect, q.pos.y + c.y * P.size, 0.0, 1.0);
  o.uv = c;
  o.heat = clamp(length(q.vel) / 1.5, 0.0, 1.0);
  return o;
}

@fragment
fn dot_fragment(d: Dot) -> @location(0) vec4f {
  let r = dot(d.uv, d.uv);
  if (r > 1.0) {
    discard;
  }
  let fall = (1.0 - r) * (1.0 - r);
  let cool = vec3f(0.25, 0.4, 1.0);
  let warm = vec3f(1.0, 0.5, 0.22);
  return vec4f(mix(cool, warm, d.heat) * fall * P.glow, 1.0);
}
