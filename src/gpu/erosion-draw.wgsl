// The land drawn as a lit mesh — one vertex per cell, read straight from the simulation's buffer —
// and the water as a second, see-through surface over it. Joined after erosion-types.wgsl.

@group(0) @binding(1) var<storage, read> a: array<vec4f>;
@group(0) @binding(2) var<storage, read> vel: array<vec2f>;

struct Vx {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
  @location(1) normal: vec3f,
  @location(2) cell: vec4f, // b, d, s, b0
  @location(3) speed: f32,
}

// the corner of the grid that vertex v of the mesh stands on
fn corner(v: u32) -> vec2i {
  let quad = v / 6u;
  let k = v % 6u;
  let q = vec2i(i32(quad % (L.n - 1u)), i32(quad / (L.n - 1u)));
  let off = array<vec2i, 6>(vec2i(0, 0), vec2i(1, 0), vec2i(0, 1), vec2i(1, 0), vec2i(1, 1), vec2i(0, 1));
  return q + off[k];
}

fn surface(c: vec2i, water: bool) -> f32 {
  let v = a[ix(c.x, c.y)];
  return select(v.x, v.x + v.y, water);
}

fn vertex(v: u32, water: bool) -> Vx {
  let c = corner(v);
  let i = ix(c.x, c.y);
  let half = f32(L.n) * 0.5;
  let h = surface(c, water);
  let p = vec3f(f32(c.x) + 0.5 - half, h, f32(c.y) + 0.5 - half);
  let nx = surface(c + vec2i(-1, 0), water) - surface(c + vec2i(1, 0), water);
  let nz = surface(c + vec2i(0, -1), water) - surface(c + vec2i(0, 1), water);
  var o: Vx;
  o.clip = L.view * vec4f(p, 1.0);
  o.world = p;
  o.normal = normalize(vec3f(nx, 2.0, nz));
  o.cell = a[i];
  o.speed = length(vel[i]);
  return o;
}

@vertex
fn ground_vx(@builtin(vertex_index) v: u32) -> Vx {
  return vertex(v, false);
}

@vertex
fn water_vx(@builtin(vertex_index) v: u32) -> Vx {
  var o = vertex(v, true);
  // a hair above the ground, so a film of water does not fight the land for the same depth
  o.clip.z -= 0.0004 * o.clip.w;
  return o;
}

const SUN = vec3f(-0.5, 0.75, -0.35);

@fragment
fn ground(px: Vx) -> @location(0) vec4f {
  let nrm = normalize(px.normal);
  let steep = 1.0 - nrm.y;
  let h = px.cell.x;
  // grass on the flats, rock on the slopes, snow on the tops
  var c = mix(vec3f(0.33, 0.47, 0.22), vec3f(0.45, 0.4, 0.36), smoothstep(0.08, 0.3, steep));
  c = mix(c, vec3f(0.92, 0.94, 0.97), smoothstep(48.0, 60.0, h) * (1.0 - smoothstep(0.25, 0.5, steep)));
  // what the water changed: sand where it laid ground down, raw earth where it carved
  let change = h - px.cell.w;
  c = mix(c, vec3f(0.82, 0.72, 0.5), clamp(change * 0.8, 0.0, 0.85));
  c = mix(c, vec3f(0.36, 0.25, 0.18), clamp(-change * 0.5, 0.0, 0.7));
  // wet ground is darker
  c *= 1.0 - 0.3 * clamp(px.cell.y * 4.0, 0.0, 1.0);
  let light = 0.35 + 0.75 * max(0.0, dot(nrm, normalize(SUN)));
  let haze = clamp(distance(px.world, L.eye) / 900.0, 0.0, 0.5);
  return vec4f(mix(c * light, vec3f(0.62, 0.72, 0.85), haze), 1.0);
}

@fragment
fn water(px: Vx) -> @location(0) vec4f {
  let d = px.cell.y;
  if (d < 0.015) {
    discard;
  }
  let nrm = normalize(px.normal);
  let to_eye = normalize(L.eye - px.world);
  let fres = pow(1.0 - max(0.0, dot(nrm, to_eye)), 3.0);
  let deep = clamp(d / 3.0, 0.0, 1.0);
  var c = mix(vec3f(0.25, 0.55, 0.65), vec3f(0.05, 0.2, 0.42), deep);
  // white where it runs fast, and muddy where it carries ground
  c = mix(c, vec3f(0.55, 0.45, 0.3), clamp(px.cell.z * 3.0, 0.0, 0.6));
  c = mix(c, vec3f(0.92, 0.95, 1.0), clamp((px.speed - 4.0) / 10.0, 0.0, 0.7));
  let spec = pow(max(0.0, dot(reflect(-normalize(SUN), nrm), to_eye)), 40.0);
  c = mix(c, vec3f(0.75, 0.85, 0.95), fres * 0.6) + spec * 0.6;
  let alpha = clamp(0.25 + d * 0.9 + fres * 0.3, 0.0, 0.92) * smoothstep(0.015, 0.08, d);
  return vec4f(c * alpha, alpha);
}
