// Lava lamp: blobs drawn as metaballs. Each blob contributes r² / d² at every pixel, the field is
// their sum, and the wax's surface is where the field crosses 1 — so two blobs that come close
// grow a neck and merge, the way wax does, with no blob knowing about any other.
//
// ⚠️ `Lava` IS PACKED BY HAND IN lava.ts (`LAVA`); lava.test.ts lays it out from this source.

struct Lava {
  aspect: f32,
  count: u32,
  time: f32,
  scheme: u32, // 0 classic, 1 ocean, 2 slime, 3 neon
}

@group(0) @binding(0) var<uniform> L: Lava;
// x, y, r, heat per blob — see packBlobs in lava.ts
@group(0) @binding(1) var<storage, read> blobs: array<vec4f>;

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

struct Scheme {
  top: vec3f, // the liquid at the top of the lamp
  bottom: vec3f, // …and at the bottom, where the bulb is
  cool: vec3f, // wax that has cooled
  hot: vec3f, // wax fresh off the bulb
}

fn scheme(i: u32) -> Scheme {
  switch (i) {
    case 1u: {
      return Scheme(vec3f(0.01, 0.04, 0.12), vec3f(0.02, 0.12, 0.25), vec3f(0.1, 0.55, 0.85), vec3f(0.55, 1.0, 0.95));
    }
    case 2u: {
      return Scheme(vec3f(0.01, 0.02, 0.01), vec3f(0.04, 0.09, 0.03), vec3f(0.25, 0.7, 0.1), vec3f(0.85, 1.0, 0.3));
    }
    case 3u: {
      return Scheme(vec3f(0.06, 0.0, 0.1), vec3f(0.18, 0.02, 0.22), vec3f(1.0, 0.1, 0.6), vec3f(0.3, 0.95, 1.0));
    }
    default: {
      return Scheme(vec3f(0.08, 0.02, 0.14), vec3f(0.3, 0.06, 0.18), vec3f(0.85, 0.18, 0.08), vec3f(1.0, 0.75, 0.2));
    }
  }
}

@fragment
fn shade(p: Px) -> @location(0) vec4f {
  let s = scheme(L.scheme);
  let q = vec2f(p.uv.x * L.aspect, p.uv.y);
  var field = 0.0;
  var warmth = 0.0;
  var weight = 0.0;
  for (var i = 0u; i < L.count; i++) {
    let b = blobs[i];
    let d = q - vec2f(b.x * L.aspect, b.y);
    let f = b.z * b.z / max(dot(d, d), 1e-6);
    field += f;
    // a blob's say in the colour is capped: near its own centre its field is huge, and uncapped
    // it painted every blob inside a merged lump as its own coloured dot
    let say = min(f, 1.5);
    warmth += say * b.w;
    weight += say;
  }
  // how hot the wax here is: each blob's heat, weighted by how much of this point is that blob
  let heat = clamp(warmth / max(weight, 1e-6), 0.0, 1.0);

  // the liquid: a glow from the bulb at the bottom, fading towards the top
  let glow = smoothstep(0.0, 1.0, p.uv.y);
  var col = mix(s.top, s.bottom, glow * glow);

  // the wax: an edge where the field crosses 1, brighter towards its middle like something lit
  // from inside, and its colour from how hot it is
  // ⚠️ A NARROW EDGE: the field changes slowly across a big merged lump, so a wide smoothstep
  // turned its surface into fog. Wax has a skin.
  let edge = smoothstep(0.96, 1.04, field);
  // lit from inside, but gently — a strong core showed every blob inside a merged lump as a dot
  let core = smoothstep(1.0, 8.0, field);
  let wax = mix(s.cool, s.hot, heat) * (0.86 + 0.14 * core);
  col = mix(col, wax, edge);
  // a rim of light just outside the surface, where wax meets liquid
  col += mix(s.cool, s.hot, heat) * 0.2 * exp(-abs(field - 0.92) * 16.0) * (1.0 - edge);

  // the glass: a little darker at its sides
  let side = abs(p.uv.x - 0.5) * 2.0;
  col *= 1.0 - 0.35 * side * side * side;
  return vec4f(col, 1.0);
}
