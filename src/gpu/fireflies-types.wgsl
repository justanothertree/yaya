// The fireflies' one uniform, shared by the clocks and the drawing.
//
// ⚠️ `Flies` IS PACKED BY HAND IN fireflies.ts (`FLIES`); fireflies.test.ts lays it out from here.

struct Flies {
  size: vec2u, // the canvas, in pixels
  count: u32,
  cells: u32, // patches of meadow
  dt: f32,
  time: f32,
  pull: f32, // K: how strongly a firefly is drawn into step with its neighbours
  kick: f32, // a beat of the music: everyone pulled towards flashing now
  tap: vec3f, // a tap: x, y (0..1), and how fresh
  beat: f32, // the pace a beat has set them, rad/s; 0 when each keeps its own
}

@group(0) @binding(0) var<uniform> F: Flies;

const TAU = 6.2831853;
const SCALE = 1024.0;
const CELLS_X = 16u;
const CELLS_Y = 10u;

fn cell_of(p: vec2f) -> vec2u {
  return vec2u(clamp(floor(p * vec2f(f32(CELLS_X), f32(CELLS_Y))), vec2f(0.0), vec2f(f32(CELLS_X - 1u), f32(CELLS_Y - 1u))));
}
