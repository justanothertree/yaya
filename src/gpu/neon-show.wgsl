// The sign, lit: every pixel's distance to the nearest tube (from the flood) and which letter that
// tube is, turned into a white-hot core, a coloured glow, and the wall behind it catching the
// light. Each letter has its own brightness, so letters stutter on and the faulty one buzzes.
// Joined after neon-types.wgsl.

@group(0) @binding(1) var nearest: texture_2d<f32>;
@group(0) @binding(2) var<storage, read> bright: array<f32>;

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

fn hue(h: f32) -> vec3f {
  return clamp(abs(fract(h + vec3f(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, vec3f(0.0), vec3f(1.0));
}

fn colour(letter: u32) -> vec3f {
  switch (N.palette) {
    case 1u: {
      return vec3f(0.3, 0.85, 1.0);
    }
    case 2u: {
      return vec3f(1.0, 0.65, 0.2);
    }
    case 3u: {
      return hue(f32(letter) * 0.13 + 0.85);
    }
    default: {
      return vec3f(1.0, 0.2, 0.55);
    }
  }
}

@fragment
fn show(px: Px) -> @location(0) vec4f {
  // the wall: dark bricks, so the glow has something to fall on
  let wall_uv = px.clip.xy / (N.scale * 2.0);
  let row = floor(wall_uv.y / 22.0);
  let brick = vec2f(wall_uv.x / 46.0 + row * 0.5, wall_uv.y / 22.0);
  let mortar = min(fract(brick.x), fract(brick.y));
  var c = vec3f(0.07, 0.05, 0.06) * (0.75 + 0.25 * smoothstep(0.0, 0.06, mortar));

  let texel = vec2i(px.clip.xy / N.scale);
  let n = textureLoad(nearest, clamp(texel, vec2i(0), vec2i(N.size) - 1), 0);
  if (n.w <= 0.0) {
    return vec4f(c, 1.0);
  }
  // distance to the tube, in canvas pixels
  let d = distance(n.xy + 0.5, px.clip.xy / N.scale) * N.scale;
  let letter = u32(n.z);
  let b = bright[min(letter, 15u)];
  let col = colour(letter);
  // a tube has a width; a solid letter is its own body, so its "tube" is the glyph itself
  let radius = select(2.6 * N.scale, 0.0, N.style == 1u);
  let off = max(d - radius, 0.0);
  // written 1 − smoothstep(0, 1.5, …) rather than smoothstep(1.5, 0, …): reversed edges work in
  // practice (Kaleidoscope and Music use them, live), but Metal's own smoothstep calls them
  // undefined, and there is no need to depend on the translation handling it
  let glass = 1.0 - smoothstep(0.0, 1.5, off);
  // lit glass is white at the core and coloured at its rim; unlit, a dull grey tube
  let core = mix(col, vec3f(1.0), 0.65) * b + vec3f(0.12, 0.11, 0.12) * (1.0 - b);
  // ⚠️ THE WIDE GLOW IS THE WHOLE SIGN'S, not the nearest letter's. Taken from the nearest, the
  // wall was carved into one region per letter — a dark column behind an unlit letter, and a
  // differently coloured wall behind each letter of a mixed sign. A wall is lit by everything.
  var sign = vec3f(0.0);
  for (var i = 0u; i < min(N.letters, 16u); i++) {
    sign += colour(i) * bright[i];
  }
  sign /= f32(max(N.letters, 1u));
  let glow = col * b * 0.85 * exp(-off / (5.0 * N.scale)) + sign * 0.35 * exp(-off / (26.0 * N.scale));
  c = mix(c + glow, core, glass);
  return vec4f(c, 1.0);
}
