// The light: every texel casts `rays` rays a frame, at angles spread evenly round it and turned by
// a random amount each frame, and SPHERE-TRACES each one through the baked field — step by the
// distance to the nearest surface, which can never pass through anything — until it lands on a
// lamp (and brings its light back) or on anything else (and brings nothing). Soft shadows,
// penumbras and colours mixing are what that average comes out as; nothing draws them.
// The frame's answer is blended into the picture so far. Joined after light-types.wgsl.

@group(0) @binding(1) var field: texture_2d<f32>;
@group(0) @binding(2) var lin: sampler;
@group(0) @binding(3) var before: texture_2d<f32>;
@group(0) @binding(4) var after: texture_storage_2d<rgba16float, write>;

const TAU = 6.2831853;
const STEPS = 48;

fn hash(p: vec3u) -> f32 {
  var x = p.x * 1664525u + p.y * 1013904223u + p.z * 2654435761u;
  x = (x ^ (x >> 16u)) * 2246822519u;
  x = (x ^ (x >> 13u)) * 3266489917u;
  x = x ^ (x >> 16u);
  return f32(x) / 4294967295.0;
}

@compute @workgroup_size(8, 8)
fn trace(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= L.size.x || id.y >= L.size.y) {
    return;
  }
  let p = world(vec2f(id.xy) + 0.5);
  // a texel's own spot: half a texel, in the room's units — the smallest step worth taking
  let texel = 2.0 / f32(L.size.y);
  let here = textureSampleLevel(field, lin, to_uv(p), 0.0);
  var light = vec3f(0.0);
  if (here.a <= 0.0) {
    // inside something: a lamp is its own light, anything else is dark
    light = here.rgb;
  } else {
    let turn = hash(vec3u(id.xy, L.frame));
    for (var k = 0u; k < L.rays; k++) {
      let a = (f32(k) + turn) / f32(L.rays) * TAU;
      let dir = vec2f(cos(a), sin(a));
      var t = 0.0;
      for (var s = 0; s < STEPS; s++) {
        let q = p + dir * t;
        let uv = to_uv(q);
        if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0))) {
          break;
        }
        let f = textureSampleLevel(field, lin, uv, 0.0);
        if (f.a < texel * 0.5) {
          light += f.rgb;
          break;
        }
        t += max(f.a, texel * 0.5);
      }
    }
    light /= f32(L.rays);
  }
  let was = textureLoad(before, id.xy, 0).rgb;
  textureStore(after, id.xy, vec4f(mix(was, light, L.blend), 1.0));
}
