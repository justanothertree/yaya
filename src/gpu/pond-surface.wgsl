// The water's surface, read the same way by the caustics and the display: a height anywhere
// (bilinear between cells) and the surface's normal there. Joined after pond-types.wgsl and the
// pass's own `water` binding.

fn cell_h(x: i32, y: i32) -> f32 {
  let c = clamp(vec2i(x, y), vec2i(0), vec2i(P.size) - 1);
  return water[u32(c.y) * P.size.x + u32(c.x)].x;
}

fn height_at(p: vec2f) -> f32 {
  let q = p - 0.5;
  let i = vec2i(floor(q));
  let f = q - floor(q);
  let a = mix(cell_h(i.x, i.y), cell_h(i.x + 1, i.y), f.x);
  let b = mix(cell_h(i.x, i.y + 1), cell_h(i.x + 1, i.y + 1), f.x);
  return mix(a, b, f.y);
}

// pointing up out of the water; y grows down the screen, as the cells do
fn normal_at(p: vec2f) -> vec3f {
  let dx = height_at(p + vec2f(1.0, 0.0)) - height_at(p - vec2f(1.0, 0.0));
  let dy = height_at(p + vec2f(0.0, 1.0)) - height_at(p - vec2f(0.0, 1.0));
  return normalize(vec3f(-dx * SLOPE, -dy * SLOPE, 1.0));
}

// where light coming straight down through the surface at p reaches the floor, in cells
fn on_floor(p: vec2f) -> vec2f {
  let r = refract(vec3f(0.0, 0.0, -1.0), normal_at(p), ETA);
  return p + r.xy / max(-r.z, 0.2) * P.depth;
}
