// The mould as it is seen: the trail's strength through a palette, food glowing, walls in slate.
// Joined after slime-types.wgsl.

@group(0) @binding(1) var<storage, read> trail: array<f32>;
@group(0) @binding(2) var<storage, read> kinds: array<u32>;

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

fn ramp(v: f32) -> vec3f {
  switch (S.palette) {
    case 1u: {
      return mix(mix(vec3f(0.02, 0.0, 0.05), vec3f(0.85, 0.1, 0.7), smoothstep(0.0, 0.5, v)), vec3f(0.5, 1.0, 1.0), smoothstep(0.45, 1.0, v));
    }
    case 2u: {
      return mix(mix(vec3f(0.01, 0.03, 0.02), vec3f(0.15, 0.5, 0.15), smoothstep(0.0, 0.5, v)), vec3f(0.85, 1.0, 0.45), smoothstep(0.45, 1.0, v));
    }
    default: {
      return mix(mix(vec3f(0.03, 0.02, 0.01), vec3f(0.85, 0.45, 0.05), smoothstep(0.0, 0.5, v)), vec3f(1.0, 0.95, 0.7), smoothstep(0.45, 1.0, v));
    }
  }
}

@fragment
fn show(px: Px) -> @location(0) vec4f {
  let xy = min(vec2u(px.uv * vec2f(S.size)), S.size - 1u);
  let i = xy.y * S.size.x + xy.x;
  let k = kinds[i];
  if (k == WALL) {
    return vec4f(0.22, 0.24, 0.28, 1.0);
  }
  // a log scale: veins carry hundreds, a faint branch a few, and both should show
  let v = clamp(log2(1.0 + trail[i]) / 9.0, 0.0, 1.0);
  var c = ramp(v);
  if (k == FOOD) {
    // food: warm and pulsing gently, so it reads as something alive wants it
    c = mix(c, vec3f(1.0, 0.85, 0.6), 0.55 + 0.15 * sin(S.time * 3.0));
  }
  return vec4f(c, 1.0);
}
