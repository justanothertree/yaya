// The waves: every cell pulled towards the average of its neighbours (the discrete wave
// equation), keeping most of its speed, plus any drops landing this step. The edge reflects: a
// missing neighbour counts as the cell itself. Mirrors `stepWaves` in pond.ts.
// Joined after pond-types.wgsl.

@group(0) @binding(1) var<storage, read> was: array<vec2f>; // height, speed
@group(0) @binding(2) var<storage, read_write> now: array<vec2f>;
@group(0) @binding(3) var<storage, read> drops: array<vec4f>; // x, y, radius, strength

const PI = 3.14159265;

fn height(x: i32, y: i32, fx: i32, fy: i32) -> f32 {
  if (x < 0 || y < 0 || x >= i32(P.size.x) || y >= i32(P.size.y)) {
    return was[u32(fy) * P.size.x + u32(fx)].x;
  }
  return was[u32(y) * P.size.x + u32(x)].x;
}

@compute @workgroup_size(8, 8)
fn wave(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= P.size)) {
    return;
  }
  let x = i32(id.x);
  let y = i32(id.y);
  let c = was[id.y * P.size.x + id.x];
  // nine neighbours, edges weighted 4 and corners 1: four alone made every ring a rounded square
  let edges = height(x - 1, y, x, y) + height(x + 1, y, x, y) + height(x, y - 1, x, y) + height(x, y + 1, x, y);
  let corners = height(x - 1, y - 1, x, y) + height(x + 1, y - 1, x, y) + height(x - 1, y + 1, x, y) + height(x + 1, y + 1, x, y);
  let avg = (edges * 4.0 + corners) / 20.0;
  let v = (c.y + (avg - c.x) * P.pull) * P.damp;
  var h = c.x + v;
  // a drop: a smooth dimple pressed into the surface, which the waves then carry away as a ring
  for (var k = 0u; k < P.drops; k++) {
    let d = drops[k];
    let r = distance(vec2f(id.xy) + 0.5, d.xy);
    if (r < d.z) {
      h -= d.w * 0.5 * (1.0 + cos(PI * r / d.z));
    }
  }
  now[id.y * P.size.x + id.x] = vec2f(h, v);
}
