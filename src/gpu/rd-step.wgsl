// The compute half of reaction–diffusion: joined after rd-types.wgsl.

@group(0) @binding(0) var<uniform> R: RD;
@group(0) @binding(1) var<storage, read> src: array<vec2f>;
@group(0) @binding(2) var<storage, read_write> dst: array<vec2f>;
// x, y, radius (all in cells), and 1 to seed B or 0 to wipe back to bare A
@group(0) @binding(3) var<storage, read> brush: array<vec4f>;

fn cell(x: i32, y: i32) -> vec2f {
  let c = i32(R.cols);
  let r = i32(R.rows);
  return src[u32((y + r) % r) * R.cols + u32((x + c) % c)];
}

// what this cell's feed and kill are: one pair everywhere, or — in the map — a sweep across the
// grid, feed growing to the right and kill growing downward
fn rates(x: u32, y: u32) -> vec2f {
  if (R.map == 1u) {
    let u = f32(x) / f32(R.cols);
    let v = f32(y) / f32(R.rows);
    // ⚠️ mirrored by MAP in rd.ts, so a tap on the map can read the rates under it; rd.test.ts
    // checks the two agree
    return vec2f(mix(0.01, 0.09, u), mix(0.045, 0.07, v));
  }
  return vec2f(R.feed, R.kill);
}

@compute @workgroup_size(8, 8)
fn react(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= R.cols || id.y >= R.rows) {
    return;
  }
  let x = i32(id.x);
  let y = i32(id.y);
  let here = cell(x, y);
  // the nine-point Laplacian: neighbours by side weigh 0.2, by corner 0.05, the cell itself -1
  let lap = 0.2 * (cell(x - 1, y) + cell(x + 1, y) + cell(x, y - 1) + cell(x, y + 1))
          + 0.05 * (cell(x - 1, y - 1) + cell(x + 1, y - 1) + cell(x - 1, y + 1) + cell(x + 1, y + 1))
          - here;
  let fk = rates(id.x, id.y);
  let a = here.x;
  let b = here.y;
  let abb = a * b * b;
  var next = vec2f(
    a + R.da * lap.x - abb + fk.x * (1.0 - a),
    b + R.db * lap.y + abb - (fk.x + fk.y) * b,
  );
  // a brush dab, applied as this step writes, so it is never overwritten by the step itself
  for (var i = 0u; i < R.brushes; i++) {
    let d = brush[i];
    let off = vec2f(f32(id.x), f32(id.y)) + 0.5 - d.xy;
    if (dot(off, off) <= d.z * d.z) {
      next = select(vec2f(1.0, 0.0), vec2f(0.5, 0.5), d.w > 0.5);
    }
  }
  dst[id.y * R.cols + id.x] = clamp(next, vec2f(0.0), vec2f(1.0));
}
