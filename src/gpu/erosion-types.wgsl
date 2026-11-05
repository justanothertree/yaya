// The eroding land's one uniform, shared by the simulation and the drawing.
//
// ⚠️ `Land` IS PACKED BY HAND IN erosion.ts (`LAND`); erosion.test.ts lays it out from here.

struct Land {
  view: mat4x4f, // world to clip
  eye: vec3f,
  n: u32, // cells each way
  ray_o: vec3f, // the finger's ray, from the eye
  dt: f32,
  ray_d: vec3f,
  tool: u32, // 0 nothing, 1 rain, 2 raise, 3 dig
  rain: f32, // 0..1: how hard it is raining everywhere
  step: u32, // which step this is, so each step's rain falls somewhere new
  radius: f32, // of the finger's brush, in cells
  open: u32, // 1: water pours off the edges of the map
}

@group(0) @binding(0) var<uniform> L: Land;

// the ground, the water, the sediment carried, and the ground it started as
fn ix(x: i32, y: i32) -> u32 {
  let n = i32(L.n);
  return u32(clamp(y, 0, n - 1) * n + clamp(x, 0, n - 1));
}
