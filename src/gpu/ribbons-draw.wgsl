// Joined after ribbons-types.wgsl: the ribbons, built from their trails.

@group(0) @binding(1) var<storage, read> trail: array<vec4f>;
@group(0) @binding(2) var<storage, read> colours: array<vec4f>;

struct Px {
  @builtin(position) clip: vec4f,
  @location(0) colour: vec3f,
  @location(1) across: f32, // -1 at one edge, 1 at the other
  @location(2) fade: f32,
}

fn point(r: u32, age: u32) -> vec4f {
  let a = min(age, U.length - 1u);
  return trail[r * U.length + (U.head + U.length - a) % U.length];
}

@vertex
fn strip(@builtin(vertex_index) v: u32) -> Px {
  let segs = U.length - 1u;
  let r = v / (segs * 6u);
  let seg = (v / 6u) % segs;
  // two triangles per segment: (age, -) (age+1, -) (age, +) / (age+1, -) (age+1, +) (age, +)
  let corner = array<vec2u, 6>(vec2u(0u, 0u), vec2u(1u, 0u), vec2u(0u, 1u), vec2u(1u, 0u), vec2u(1u, 1u), vec2u(0u, 1u));
  let c = corner[v % 6u];
  let age = seg + c.x;
  let side = f32(c.y) * 2.0 - 1.0;

  let here = point(r, age);
  let p = here.xyz;
  let newer = point(r, max(age, 1u) - 1u).xyz;
  let older = point(r, age + 1u).xyz;
  var tangent = newer - older;
  if (dot(tangent, tangent) < 1e-10) {
    tangent = vec3f(0.0, 1.0, 0.0);
  }
  tangent = normalize(tangent);
  // across the ribbon: square to its path and to the line of sight, then twisted about the path
  let facing = normalize(cross(tangent, p - U.eye.xyz) + vec3f(1e-6, 0.0, 0.0));
  let normal = cross(tangent, facing);
  let twist = f32(age) * 0.06 + f32(r) * 1.7 + U.up.w * 0.8;
  let dir = facing * cos(twist) + normal * sin(twist);
  let young = 1.0 - f32(age) / f32(U.length);
  let w = U.width * pow(young, 0.6) * (1.0 + U.pulse * 0.8 + U.kick * 0.6) * (0.7 + min(here.w, 4.0) * 0.15);
  let q = p + dir * side * w;

  let rel = q - U.eye.xyz;
  let z = dot(rel, U.fwd.xyz);
  var o: Px;
  o.clip = vec4f(dot(rel, U.right.xyz) * U.fwd.w / U.right.w, dot(rel, U.up.xyz) * U.fwd.w, z * 0.5, z);
  // turned edge-on it shows less of itself: brightness follows how squarely it faces you
  let square = abs(dot(cross(tangent, dir), normalize(rel)));
  o.colour = mix(colours[r].rgb, vec3f(1.0), pow(young, 6.0) * 0.6) * (0.35 + 0.65 * square);
  o.across = side;
  o.fade = young;
  return o;
}

@fragment
fn glow(px: Px) -> @location(0) vec4f {
  // soft edges, and the tail fading out, added together where ribbons cross
  let edge = 1.0 - px.across * px.across;
  let a = edge * px.fade * (0.55 + U.kick * 0.4);
  return vec4f(px.colour * a, a);
}
