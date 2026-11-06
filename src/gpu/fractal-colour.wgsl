// The cheap half, run every frame: each pixel's count turned into a colour that flows round its
// palette, so the picture moves without a single iteration being done again.
// Joined after fractal-types.wgsl.

@group(0) @binding(1) var<storage, read> counts: array<f32>;

struct Px {
  @builtin(position) clip: vec4f,
}

@vertex
fn cover(@builtin(vertex_index) v: u32) -> Px {
  let p = vec2f(f32((v << 1u) & 2u), f32(v & 2u)) * 2.0 - 1.0;
  var o: Px;
  o.clip = vec4f(p, 0.0, 1.0);
  return o;
}

// Inigo Quilez's cosine palettes: a + b·cos(2π(c·t + d))
fn palette(t: f32) -> vec3f {
  var a = vec3f(0.5);
  var b = vec3f(0.5);
  var c = vec3f(1.0);
  var d = vec3f(0.0, 0.1, 0.2);
  switch (F.palette) {
    case 1u: {
      d = vec3f(0.5, 0.6, 0.7);
      c = vec3f(1.0, 1.0, 0.8);
    }
    case 2u: {
      d = vec3f(0.8, 0.9, 0.3);
      c = vec3f(2.0, 1.0, 0.0);
      b = vec3f(0.5, 0.4, 0.5);
    }
    case 3u: {
      d = vec3f(0.0);
      b = vec3f(0.48);
    }
    default: {}
  }
  return a + b * cos(6.2831853 * (c * t + d));
}

@fragment
fn colour(px: Px) -> @location(0) vec4f {
  let xy = vec2u(px.clip.xy);
  let n = counts[min(xy.y, F.size.y - 1u) * F.size.x + min(xy.x, F.size.x - 1u)];
  if (n < 0.0) {
    // inside: very nearly black, breathing very slightly, so the set reads as a shape
    return vec4f(vec3f(0.02, 0.015, 0.04) * (1.0 + 0.3 * sin(F.time * 0.7)), 1.0);
  }
  // ⚠️ A LOGARITHM, NOT A ROOT. Near the edge, neighbouring pixels escape hundreds of steps
  // apart, and a √n palette made every one of those a new colour — speckle. Spaced by log, a
  // colour band spans a doubling of the count, so the deep edge reads as smooth gradients.
  let t = log2(n + 1.0) * 0.45 + F.cycle;
  return vec4f(palette(t), 1.0);
}
