// The picture: the gathered light, exposed and rolled off, with every solid thing drawn as a dark
// shape with a faint rim so you can see what you are moving. Joined after light-types.wgsl.

@group(0) @binding(1) var field: texture_2d<f32>;
@group(0) @binding(2) var lin: sampler;
@group(0) @binding(3) var picture: texture_2d<f32>;

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

@fragment
fn show(px: Px) -> @location(0) vec4f {
  let light = textureSampleLevel(picture, lin, px.uv, 0.0).rgb;
  // exposure with a soft shoulder, then gamma: the canvas is not sRGB, so this is the encoding
  var c = pow(vec3f(1.0) - exp(-light * L.exposure), vec3f(1.0 / 2.2));
  let f = textureSampleLevel(field, lin, px.uv, 0.0);
  let texel = 2.0 / f32(L.size.y);
  let solid = f.a < 0.0 && dot(f.rgb, f.rgb) == 0.0;
  if (solid) {
    // a solid thing: dark, lit faintly at its edge by the room
    c = vec3f(0.06, 0.06, 0.08) + c * 0.25;
  }
  let rim = 1.0 - smoothstep(0.0, texel * 1.5, abs(f.a));
  c = mix(c, vec3f(0.55, 0.55, 0.6), rim * 0.35 * select(1.0, 0.3, dot(f.rgb, f.rgb) > 0.0));
  return vec4f(c, 1.0);
}
