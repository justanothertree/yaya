// The sandbox as it is seen: each cell its own colour — sand in its own shade, water with a
// slight shimmer, stone walls — and the empty box dark behind. Joined after sand-types.wgsl.

@group(0) @binding(1) var<storage, read> cells: array<u32>;

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
  let xy = min(vec2u(px.uv * vec2f(S.size)), S.size - 1u);
  let c = cells[xy.y * S.size.x + xy.x];
  let shade = f32((c >> 2u) & 63u) / 63.0;
  switch (c & 3u) {
    case 1u: {
      return vec4f(mix(vec3f(0.78, 0.6, 0.32), vec3f(0.95, 0.82, 0.52), shade), 1.0);
    }
    case 2u: {
      let shimmer = 0.5 + 0.5 * sin(f32(xy.x) * 0.7 + f32(xy.y) * 0.35 + S.time * 3.0 + shade * 6.0);
      return vec4f(mix(vec3f(0.12, 0.35, 0.75), vec3f(0.3, 0.6, 0.95), shimmer * 0.5 + shade * 0.2), 1.0);
    }
    case 3u: {
      let n = fract(sin(dot(vec2f(xy), vec2f(12.9898, 78.233))) * 43758.5453);
      return vec4f(vec3f(0.36, 0.36, 0.4) * (0.85 + 0.15 * n), 1.0);
    }
    default: {
      return vec4f(mix(vec3f(0.05, 0.05, 0.08), vec3f(0.09, 0.08, 0.12), px.uv.y), 1.0);
    }
  }
}
