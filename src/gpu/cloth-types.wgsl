// The cloth's one uniform, shared by the simulation and the drawing.
//
// ⚠️ `Cloth` IS PACKED BY HAND IN cloth.ts (`CLOTH`); cloth.test.ts lays it out from here.

struct Cloth {
  f0: vec4f, // each finger: xy where it is, zw where it was last frame
  f1: vec4f,
  f2: vec4f,
  f3: vec4f,
  cols: u32,
  rows: u32,
  phase: u32, // which colour of edges this dispatch projects, 0..7
  tool: u32, // 0 grab, 1 cut
  spacing: f32,
  dt: f32,
  time: f32,
  wind: f32,
  aspect: f32,
  down: u32, // bit f: finger f is down
  pressed: u32, // bit f: finger f went down this frame
  fabric: u32,
  step: u32, // which of this frame's steps
  steps: u32, // how many steps this frame takes
}
