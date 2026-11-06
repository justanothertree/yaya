// The pond as seen from above: every pixel looks down through the moving surface, is bent by it,
// and sees the floor somewhere a little off — lit by the caustics, deepening in colour with
// depth, with a glint where the surface tilts towards the sun. Joined after pond-types.wgsl.

@group(0) @binding(1) var<storage, read> water: array<vec2f>;
@group(0) @binding(2) var caustics: texture_2d<f32>;
@group(0) @binding(3) var lin: sampler;

// pond-surface.wgsl is joined here

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

fn hash2(p: vec2f) -> vec2f {
  return fract(sin(vec2f(dot(p, vec2f(127.1, 311.7)), dot(p, vec2f(269.5, 183.3)))) * 43758.5453);
}

// the floor's own colour at a point, in cells
fn floor_colour(p: vec2f) -> vec3f {
  switch (P.floor) {
    case 1u: {
      // pebbles: the nearest of a jittered grid of stones, each its own colour, dark between
      let s = p / 7.0;
      let i = floor(s);
      var best = 9.0;
      var second = 9.0;
      var col = vec3f(0.0);
      for (var y = -1; y <= 1; y++) {
        for (var x = -1; x <= 1; x++) {
          let g = i + vec2f(f32(x), f32(y));
          let o = g + hash2(g);
          let d = distance(s, o);
          if (d < best) {
            second = best;
            best = d;
            let h = hash2(g + 17.0);
            col = mix(vec3f(0.45, 0.4, 0.35), vec3f(0.75, 0.68, 0.55), h.x) * (0.8 + 0.3 * h.y);
          } else if (d < second) {
            second = d;
          }
        }
      }
      return col * smoothstep(0.0, 0.12, second - best);
    }
    case 2u: {
      // sand, with the ripples the water leaves in it
      let ripple = 0.5 + 0.5 * sin(p.x * 0.9 + sin(p.y * 0.2) * 2.0);
      return mix(vec3f(0.78, 0.68, 0.5), vec3f(0.88, 0.8, 0.62), ripple);
    }
    default: {
      // pool tiles: white grout, blue tiles
      let t = fract(p / 6.0);
      let grout = smoothstep(0.0, 0.06, min(min(t.x, t.y), min(1.0 - t.x, 1.0 - t.y)));
      return mix(vec3f(0.85, 0.9, 0.92), vec3f(0.25, 0.6, 0.8), grout);
    }
  }
}

@fragment
fn show(px: Px) -> @location(0) vec4f {
  let p = px.uv * vec2f(P.size);
  let n = normal_at(p);
  let below = on_floor(p);
  let light = textureSampleLevel(caustics, lin, below / vec2f(P.size), 0.0).r;
  var c = floor_colour(below) * (0.35 + 0.75 * light);
  // the water itself: deeper, bluer-green
  c = mix(c, vec3f(0.05, 0.25, 0.3), 0.25);
  // a glint where the surface tips towards the sun
  let sun = normalize(vec3f(0.4, -0.5, 1.0));
  let glint = pow(max(dot(reflect(-sun, n), vec3f(0.0, 0.0, 1.0)), 0.0), 120.0);
  c += vec3f(1.0, 0.97, 0.9) * glint * 0.6;
  return vec4f(c, 1.0);
}
