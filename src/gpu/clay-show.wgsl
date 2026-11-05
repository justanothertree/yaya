// The clay as it is seen: every pixel's ray marched through the volume to the surface, lit like
// glazed clay — a soft key light, a rim, and shadowing in the creases (how much clay is close by
// along the normal). Joined after clay-types.wgsl.

@group(0) @binding(1) var vol: texture_3d<f32>;
@group(0) @binding(2) var lin: sampler;

struct Px {
  @builtin(position) clip: vec4f,
  @location(0) ndc: vec2f,
}

@vertex
fn cover(@builtin(vertex_index) v: u32) -> Px {
  let p = vec2f(f32((v << 1u) & 2u), f32(v & 2u)) * 2.0 - 1.0;
  var o: Px;
  o.clip = vec4f(p, 0.0, 1.0);
  o.ndc = p;
  return o;
}

fn sdf(p: vec3f) -> f32 {
  return textureSampleLevel(vol, lin, p * 0.5 + 0.5, 0.0).r;
}

fn normal(p: vec3f) -> vec3f {
  let e = 2.0 / f32(C.n);
  return normalize(vec3f(
    sdf(p + vec3f(e, 0.0, 0.0)) - sdf(p - vec3f(e, 0.0, 0.0)),
    sdf(p + vec3f(0.0, e, 0.0)) - sdf(p - vec3f(0.0, e, 0.0)),
    sdf(p + vec3f(0.0, 0.0, e)) - sdf(p - vec3f(0.0, 0.0, e)),
  ));
}

fn glaze_colour() -> vec3f {
  switch (C.glaze) {
    case 1u: {
      return vec3f(0.92, 0.9, 0.86);
    }
    case 2u: {
      return vec3f(0.35, 0.62, 0.5);
    }
    default: {
      return vec3f(0.78, 0.45, 0.3);
    }
  }
}

@fragment
fn show(px: Px) -> @location(0) vec4f {
  let o = C.eye.xyz;
  let d = normalize(C.fwd.xyz * C.fwd.w + C.right.xyz * px.ndc.x * C.eye.w + C.up.xyz * px.ndc.y);
  // a studio backdrop: lighter behind, darker below
  var c = mix(vec3f(0.12, 0.12, 0.14), vec3f(0.3, 0.3, 0.33), px.ndc.y * 0.5 + 0.5);
  let span = cube(o, d);
  if (span.y < max(span.x, 0.0)) {
    return vec4f(c, 1.0);
  }
  let voxel = 2.0 / f32(C.n);
  var t = max(span.x, 0.0);
  for (var s = 0; s < 128; s++) {
    let p = o + d * t;
    let dist = sdf(p);
    if (dist < voxel * 0.2) {
      let n = normal(p);
      let key = normalize(vec3f(-0.4, 0.8, 0.5));
      let diffuse = max(dot(n, key), 0.0);
      let rim = pow(1.0 - max(dot(n, -d), 0.0), 3.0);
      // creases: how much clay sits just outside the surface along the normal
      let open = clamp(sdf(p + n * 0.08) / 0.08, 0.0, 1.0);
      let spec = pow(max(dot(reflect(-key, n), -d), 0.0), 24.0) * select(0.15, 0.5, C.glaze == 1u);
      let base = glaze_colour();
      c = base * (0.25 + 0.75 * diffuse) * (0.55 + 0.45 * open) + base * rim * 0.35 + vec3f(spec);
      break;
    }
    t += max(dist * 0.9, voxel * 0.5);
    if (t > span.y) {
      break;
    }
  }
  return vec4f(c, 1.0);
}
