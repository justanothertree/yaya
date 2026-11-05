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
  @location(1) color: vec3f,
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
  o.color = shade(q.vel);
  return o;
}

// A dot's colour, worked out once per vertex rather than per pixel: it depends only on the
// particle, and a dot is a few pixels across.
fn shade(vel: vec2f) -> vec3f {
  let heat = clamp(length(vel) / 1.5, 0.0, 1.0);
  if (P.palette == 1u) {
    // rainbow by heading: the hue is the direction of travel, so every stream in the current
    // shows as one colour and a whirl as the whole wheel
    let a = atan2(vel.y, vel.x) / 6.2831853;
    return (0.55 + 0.45 * cos(6.2831853 * (a + vec3f(0.0, 0.33, 0.67)))) * (0.45 + 0.55 * heat);
  }
  if (P.palette == 2u) {
    // fire: slow is a dark ember, fast burns through orange to near white
    return vec3f(1.0, 0.25 + 0.65 * heat, 0.05 + 0.6 * heat * heat) * (0.35 + 0.65 * heat);
  }
  return mix(vec3f(0.25, 0.4, 1.0), vec3f(1.0, 0.5, 0.22), heat);
}

@fragment
fn dot_fragment(d: Dot) -> @location(0) vec4f {
  let r = dot(d.uv, d.uv);
  if (r > 1.0) {
    discard;
  }
  let fall = (1.0 - r) * (1.0 - r);
  return vec4f(d.color * fall * P.glow, 1.0);
}
