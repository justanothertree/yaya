// The draw half of Life: joined after life-types.wgsl. One triangle covers the canvas, and each
// pixel looks up the cell under it — there is no geometry per cell at all.

@group(0) @binding(0) var<uniform> L: Life;
@group(0) @binding(1) var<storage, read> cells: array<u32>;

@vertex
fn cover(@builtin(vertex_index) v: u32) -> @builtin(position) vec4f {
  // one oversized triangle whose middle is the whole screen
  let p = vec2f(f32((v << 1u) & 2u), f32(v & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}

@fragment
fn shade(@builtin(position) at: vec4f) -> @location(0) vec4f {
  let dims = vec2f(f32(L.cols), f32(L.rows));
  let g = at.xy / L.view * dims;
  let c = min(vec2u(g), vec2u(L.cols - 1u, L.rows - 1u));
  let v = cells[c.y * L.cols + c.x];
  let bg = vec3f(0.02, 0.02, 0.05);
  // a cell is drawn a little inside its square, so a block of them still reads as cells
  let f = fract(g);
  let inner = select(0.82, 1.0, min(min(f.x, f.y), min(1.0 - f.x, 1.0 - f.y)) > 0.08);
  if (v == ALIVE) {
    return vec4f(vec3f(0.55, 1.0, 0.72) * inner, 1.0);
  }
  let t = f32(v) / f32(TRAIL);
  return vec4f(mix(bg, vec3f(0.18, 0.28, 0.85), t * 0.7), 1.0);
}
