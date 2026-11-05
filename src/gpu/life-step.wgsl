// The compute half of Life: joined after life-types.wgsl.

@group(0) @binding(0) var<uniform> L: Life;
@group(0) @binding(1) var<storage, read> src: array<u32>;
@group(0) @binding(2) var<storage, read_write> dst: array<u32>;

// the board wraps at every edge, so a glider leaving one side comes back on the other
fn alive_at(x: i32, y: i32) -> u32 {
  let c = i32(L.cols);
  let r = i32(L.rows);
  let i = u32((y + r) % r) * L.cols + u32((x + c) % c);
  return select(0u, 1u, src[i] == ALIVE);
}

@compute @workgroup_size(8, 8)
fn generation(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= L.cols || id.y >= L.rows) {
    return;
  }
  let x = i32(id.x);
  let y = i32(id.y);
  let n = alive_at(x - 1, y - 1) + alive_at(x, y - 1) + alive_at(x + 1, y - 1)
        + alive_at(x - 1, y) + alive_at(x + 1, y)
        + alive_at(x - 1, y + 1) + alive_at(x, y + 1) + alive_at(x + 1, y + 1);
  let i = id.y * L.cols + id.x;
  let v = src[i];
  var next = 0u;
  if ((v == ALIVE && (n == 2u || n == 3u)) || (v != ALIVE && n == 3u)) {
    next = ALIVE;
  } else if (v == ALIVE) {
    next = TRAIL;
  } else if (v > DECAY) {
    next = v - DECAY;
  }
  dst[i] = next;
}

// Painting runs on the board as it stands, every frame the press is down — so drawing works while
// paused, and a stroke is not held back until the next generation. Each cell touches only itself,
// which is what makes writing in place safe.
@compute @workgroup_size(8, 8)
fn paint(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= L.cols || id.y >= L.rows || L.paint == 0u) {
    return;
  }
  let d = vec2f(id.xy) + 0.5 - L.brush;
  if (dot(d, d) <= L.radius * L.radius) {
    dst[id.y * L.cols + id.x] = select(0u, ALIVE, L.paint == 1u);
  }
}

fn pcg(v: u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}

// about a quarter alive: dense enough to churn for a long while, sparse enough not to die at once
@compute @workgroup_size(8, 8)
fn scatter(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= L.cols || id.y >= L.rows) {
    return;
  }
  let i = id.y * L.cols + id.x;
  dst[i] = select(0u, ALIVE, (pcg(i ^ pcg(L.seed)) & 1023u) < 280u);
}
