// The draw half of the aquarium: joined after tank-types.wgsl. The water — a deep gradient with
// light rippling through it — then every fish as three triangles, nose, body and a tail that beats.

@group(0) @binding(0) var<uniform> T: Tank;
@group(0) @binding(1) var<storage, read> fish: array<vec4f>;
@group(0) @binding(2) var<storage, read> pellets: array<vec4f>;

struct Water {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn water_vertex(@builtin(vertex_index) v: u32) -> Water {
  let p = vec2f(f32((v << 1u) & 2u), f32(v & 2u));
  var o: Water;
  o.clip = vec4f(p * 2.0 - 1.0, 0.0, 1.0);
  o.uv = vec2f(p.x, 1.0 - p.y);
  return o;
}

@fragment
fn water(w: Water) -> @location(0) vec4f {
  let x = (w.uv.x - 0.5) * 2.0 * T.aspect;
  let y = w.uv.y * 2.0 - 1.0;
  // deeper is darker; light comes down from the surface in shifting bands
  var col = mix(vec3f(0.05, 0.32, 0.42), vec3f(0.01, 0.06, 0.12), w.uv.y);
  let t = T.time;
  let caustic = sin(x * 7.0 + t * 0.9 + sin(y * 5.0 + t * 0.6) * 1.5) * sin(y * 6.0 - t * 0.7 + sin(x * 4.0) * 1.3);
  col += vec3f(0.12, 0.2, 0.18) * smoothstep(0.6, 1.0, caustic) * (1.0 - w.uv.y);
  // food: small warm specks, fading as they are eaten
  for (var f = 0u; f < T.food; f++) {
    let p = pellets[f];
    let d = length(vec2f(x, y) - p.xy);
    col += vec3f(1.0, 0.75, 0.35) * p.z * smoothstep(0.02, 0.008, d);
  }
  return vec4f(col, 1.0);
}

struct Fin {
  @builtin(position) clip: vec4f,
  @location(0) color: vec3f,
}

// nose, two body corners, the tail's root, and its two tips — three triangles
const SHAPE = array<vec2f, 9>(
  vec2f(0.5, 0.0), vec2f(0.0, 0.16), vec2f(0.0, -0.16),
  vec2f(0.0, 0.16), vec2f(-0.35, 0.0), vec2f(0.0, -0.16),
  vec2f(-0.3, 0.0), vec2f(-0.62, 0.14), vec2f(-0.62, -0.14),
);

@vertex
fn fish_vertex(@builtin(vertex_index) v: u32) -> Fin {
  let i = v / 9u;
  let k = v % 9u;
  var shape = SHAPE;
  var s = shape[k];
  let f = fish[i];
  let speed = length(f.zw);
  // the tail beats faster the faster it swims, each fish on its own phase
  if (k >= 6u) {
    s.y += sin(T.time * (6.0 + speed * 18.0) + f32(i) * 1.7) * 0.09 * select(0.0, 1.0, k > 6u);
  }
  let dir = f.zw / max(speed, 1e-5);
  let size = T.size * (0.8 + 0.4 * fract(f32(i) * 0.618));
  let world = f.xy + (dir * s.x + vec2f(-dir.y, dir.x) * s.y) * size;
  var o: Fin;
  o.clip = vec4f(world.x / T.aspect, -world.y, 0.0, 1.0);
  var palette = array<vec3f, 3>(vec3f(1.0, 0.55, 0.15), vec3f(0.35, 0.8, 1.0), vec3f(0.95, 0.9, 0.45));
  // a little darker on the tail and lighter on the nose, so a fish has a front
  o.color = palette[species(i)] * select(1.0, 0.7, k >= 6u) * select(1.0, 1.15, k == 0u);
  return o;
}

@fragment
fn fin(f: Fin) -> @location(0) vec4f {
  return vec4f(f.color, 1.0);
}
