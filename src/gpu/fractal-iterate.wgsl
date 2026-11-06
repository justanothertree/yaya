// The expensive half, run only when the view changes: every pixel's smooth escape count, by
// PERTURBATION against a reference orbit computed in f64 on the CPU — see fractal.ts for why.
// Joined after fractal-types.wgsl.

// the reference orbit Z₀, Z₁, … as f32 pairs
@group(0) @binding(1) var<storage, read> orbit: array<vec2f>;
// each pixel's smooth escape count, or -1 inside the set
@group(0) @binding(2) var<storage, read_write> counts: array<f32>;

const BAILOUT = 256.0;

fn mul(a: vec2f, b: vec2f) -> vec2f {
  return vec2f(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}

@compute @workgroup_size(8, 8)
fn iterate(@builtin(global_invocation_id) id: vec3u) {
  // one thread per block: a pixel, or while the view moves a 2×2 of them worked out once
  let corner = id.xy * F.block;
  if (corner.x >= F.size.x || corner.y >= F.size.y) {
    return;
  }
  // the block's middle, as an offset from the centre in the plane — tiny when deep, and f32 keeps
  // it precise
  let off = (vec2f(corner) + 0.5 * f32(F.block) - vec2f(F.size) * 0.5) * vec2f(1.0, -1.0) * F.scale;
  // Mandelbrot: every pixel starts at 0 and adds its own c, so the difference is in c.
  // Julia: every pixel has the same c and its own start, so the difference is in the start.
  let dc = select(off, vec2f(0.0), F.julia == 1u);
  var d = select(vec2f(0.0), off, F.julia == 1u);
  var m = 0u;
  var result = -1.0;
  for (var n = 0u; n < F.max_iter; n++) {
    let z = orbit[m] + d;
    let r2 = dot(z, z);
    if (r2 > BAILOUT) {
      result = f32(n) + 1.0 - log2(log2(r2) * 0.5);
      break;
    }
    // REBASE: when the pixel is nearer the reference's START than to where the reference has got
    // to, or the reference has run out, carry on from the start, measured from it. Without it, the
    // precision the difference had is lost in a cancellation. ⚠️ FROM THE START, NOT FROM ZERO:
    // the two are the same for Mandelbrot (Z₀ = 0) and not for Julia (Z₀ = the centre), and
    // measuring from zero put every pixel of a deep Julia view 0.12 off in its count.
    let from0 = z - orbit[0];
    if (dot(from0, from0) < dot(d, d) || m + 1u >= F.ref_len) {
      d = from0;
      m = 0u;
    }
    // δ ← 2Zδ + δ² + δc
    d = mul(2.0 * orbit[m] + d, d) + dc;
    m++;
  }
  for (var y = corner.y; y < min(corner.y + F.block, F.size.y); y++) {
    for (var x = corner.x; x < min(corner.x + F.block, F.size.x); x++) {
      counts[y * F.size.x + x] = result;
    }
  }
}
