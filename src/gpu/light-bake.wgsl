// The room, BAKED: once per change, every texel works out its distance to the nearest surface and
// the light that surface gives, so the trace that follows asks one texture fetch per step rather
// than every shape. Joined after light-types.wgsl.

// each shape: [3i] x, y, size, height · [3i + 1] colour, power · [3i + 2] angle, kind
@group(0) @binding(1) var<storage, read> shapes: array<vec4f>;
@group(0) @binding(2) var field: texture_storage_2d<rgba16float, write>;

// mirrors `sdf` in light.ts
fn sdf(i: u32, p: vec2f) -> f32 {
  let a = shapes[3u * i];
  let c = shapes[3u * i + 2u];
  let d = p - a.xy;
  if (c.y < 1.5) {
    return length(d) - a.z;
  }
  let cs = cos(c.x);
  let sn = sin(c.x);
  let l = abs(vec2f(cs * d.x + sn * d.y, -sn * d.x + cs * d.y)) - a.zw;
  return length(max(l, vec2f(0.0))) + min(max(l.x, l.y), 0.0);
}

@compute @workgroup_size(8, 8)
fn bake(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= L.size.x || id.y >= L.size.y) {
    return;
  }
  let p = world(vec2f(id.xy) + 0.5);
  var d = 1e3;
  var emit = vec3f(0.0);
  for (var i = 0u; i < L.count; i++) {
    let e = sdf(i, p);
    if (e < d) {
      d = e;
      let b = shapes[3u * i + 1u];
      emit = select(vec3f(0.0), b.rgb * b.w, shapes[3u * i + 2u].y < 0.5);
    }
  }
  textureStore(field, id.xy, vec4f(emit, d));
}
