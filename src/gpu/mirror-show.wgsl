// The picture: every pixel looks back as far as its delay says, into the ring of past frames,
// blending the two frames either side so time smears smoothly. Mirrors `layersFor` in mirror.ts.
// Joined after mirror-types.wgsl.

@group(0) @binding(1) var past: texture_2d_array<f32>;
@group(0) @binding(2) var lin: sampler;
@group(0) @binding(3) var<storage, read> delay: array<f32>;

struct Px {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn cover(@builtin(vertex_index) v: u32) -> Px {
  let p = vec2f(f32((v << 1u) & 2u), f32(v & 2u));
  var o: Px;
  o.clip = vec4f(p * 2.0 - 1.0, 0.0, 1.0);
  o.uv = vec2f(p.x, 1.0 - p.y);
  return o;
}

fn delay_at(p: vec2f) -> f32 {
  // bilinear by hand: the map is a buffer, and a smooth delay is what makes a smooth smear
  let q = p - 0.5;
  let i = vec2i(floor(q));
  let f = q - floor(q);
  let s = vec2i(M.size) - 1;
  let a = delay[u32(clamp(i.y, 0, s.y)) * M.size.x + u32(clamp(i.x, 0, s.x))];
  let b = delay[u32(clamp(i.y, 0, s.y)) * M.size.x + u32(clamp(i.x + 1, 0, s.x))];
  let c = delay[u32(clamp(i.y + 1, 0, s.y)) * M.size.x + u32(clamp(i.x, 0, s.x))];
  let d = delay[u32(clamp(i.y + 1, 0, s.y)) * M.size.x + u32(clamp(i.x + 1, 0, s.x))];
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

@fragment
fn show(px: Px) -> @location(0) vec4f {
  let d = clamp(delay_at(px.uv * vec2f(M.size)), 0.0, 1.0);
  let back = d * f32(M.frames - 1u);
  let whole = u32(floor(back));
  let a = (M.head + M.frames - whole % M.frames) % M.frames;
  let b = (a + M.frames - 1u) % M.frames;
  let t = back - f32(whole);
  var c = mix(
    textureSampleLevel(past, lin, px.uv, a, 0.0).rgb,
    textureSampleLevel(past, lin, px.uv, b, 0.0).rgb,
    t,
  );
  if (M.tint == 1u) {
    // now is warm, the past is cool: you can see what the brush has done
    c = mix(c, mix(vec3f(1.0, 0.6, 0.3), vec3f(0.3, 0.5, 1.0), d), 0.3);
  }
  return vec4f(c, 1.0);
}
