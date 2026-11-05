// Sculpting: start the lump, find where the finger's ray meets the clay (on the GPU — see
// clay.ts), and fold a brush into the volume there. Joined after clay-types.wgsl.

@group(0) @binding(1) var vol_in: texture_3d<f32>;
@group(0) @binding(2) var vol_out: texture_storage_3d<rgba16float, write>;
@group(0) @binding(3) var lin: sampler;
// where the ray met the clay: xyz, and w 1 if it did
@group(0) @binding(4) var<storage, read_write> hit: vec4f;

// how far each frame of a held brush goes towards its full effect: a stroke builds, it does not slap
const RATE = 0.3;

fn centre(id: vec3u) -> vec3f {
  return -1.0 + (vec3f(id) + 0.5) * (2.0 / f32(C.n));
}

fn sdf(p: vec3f) -> f32 {
  return textureSampleLevel(vol_in, lin, p * 0.5 + 0.5, 0.0).r;
}

@compute @workgroup_size(4, 4, 4)
fn start(@builtin(global_invocation_id) id: vec3u) {
  if (any(id >= vec3u(C.n))) {
    return;
  }
  textureStore(vol_out, id, vec4f(lump(centre(id)), 0.0, 0.0, 1.0));
}

@compute @workgroup_size(1)
fn pick() {
  hit = vec4f(0.0);
  if (C.ray_d.w < 0.5) {
    return;
  }
  let o = C.ray_o.xyz;
  let d = C.ray_d.xyz;
  let span = cube(o, d);
  if (span.y < max(span.x, 0.0)) {
    return;
  }
  let voxel = 2.0 / f32(C.n);
  var t = max(span.x, 0.0);
  for (var s = 0; s < 160; s++) {
    let p = o + d * t;
    let dist = sdf(p);
    if (dist < voxel * 0.3) {
      hit = vec4f(p, 1.0);
      return;
    }
    t += max(dist * 0.9, voxel * 0.5);
    if (t > span.y) {
      return;
    }
  }
}

fn brush(p: vec3f, at: vec3f) -> f32 {
  return length(p - at) - C.ray_o.w;
}

@compute @workgroup_size(4, 4, 4)
fn edit(@builtin(global_invocation_id) id: vec3u) {
  if (any(id >= vec3u(C.n))) {
    return;
  }
  let here = textureLoad(vol_in, id, 0).r;
  var d = here;
  let p = centre(id);
  if (hit.w > 0.5) {
    let r = C.ray_o.w;
    var spots = array<vec3f, 2>(hit.xyz, hit.xyz * vec3f(-1.0, 1.0, 1.0));
    let count = select(1u, 2u, C.mirror == 1u && abs(hit.x) > r * 0.5);
    for (var k = 0u; k < count; k++) {
      let at = spots[k];
      let near = length(p - at);
      if (near > r + BLEND * 2.0) {
        continue;
      }
      if (C.tool == 0u) {
        d = mix(d, smin(d, brush(p, at)), RATE);
      } else if (C.tool == 1u) {
        d = mix(d, ssub(d, brush(p, at)), RATE);
      } else if (C.tool == 2u) {
        // smoothing: towards the mean of the six neighbours, most at the brush's middle
        let n = vec3i(i32(C.n) - 1);
        let q = vec3i(id);
        var mean = 0.0;
        mean += textureLoad(vol_in, clamp(q + vec3i(1, 0, 0), vec3i(0), n), 0).r;
        mean += textureLoad(vol_in, clamp(q - vec3i(1, 0, 0), vec3i(0), n), 0).r;
        mean += textureLoad(vol_in, clamp(q + vec3i(0, 1, 0), vec3i(0), n), 0).r;
        mean += textureLoad(vol_in, clamp(q - vec3i(0, 1, 0), vec3i(0), n), 0).r;
        mean += textureLoad(vol_in, clamp(q + vec3i(0, 0, 1), vec3i(0), n), 0).r;
        mean += textureLoad(vol_in, clamp(q - vec3i(0, 0, 1), vec3i(0), n), 0).r;
        d = mix(d, mean / 6.0, 0.5 * clamp(1.0 - near / r, 0.0, 1.0));
      }
    }
  }
  textureStore(vol_out, id, vec4f(d, 0.0, 0.0, 1.0));
}
