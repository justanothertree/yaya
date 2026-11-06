// The time brush: within a dab's reach the delay eases towards the past (slow) or back to now,
// softest at the edge. Mirrors `brush` in mirror.ts. Joined after mirror-types.wgsl.

@group(0) @binding(1) var<storage, read_write> delay: array<f32>;
@group(0) @binding(2) var<storage, read> dabs: array<vec4f>; // x, y, radius, 1 slow / 0 now

const BRUSH_RATE = 0.06;

@compute @workgroup_size(8, 8)
fn paint(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= M.size)) {
    return;
  }
  let i = id.y * M.size.x + id.x;
  var d = delay[i];
  let here = vec2f(id.xy) + 0.5;
  for (var k = 0u; k < M.dabs; k++) {
    let b = dabs[k];
    let r = distance(here, b.xy);
    if (r >= b.z) {
      continue;
    }
    d += (b.w - d) * BRUSH_RATE * (1.0 - r / b.z);
  }
  delay[i] = d;
}
