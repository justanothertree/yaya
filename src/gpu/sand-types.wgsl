// The sandbox's one uniform, shared by the simulation and the drawing.
//
// ⚠️ `Sand` IS PACKED BY HAND IN sand.ts (`SAND`); sand.test.ts lays it out from here.

struct Sand {
  size: vec2u, // the grid, in cells
  step: u32, // which step: its parity picks the block grid, and it seeds the dice
  gravity: u32, // 0 down, 1 left, 2 up, 3 right, on screen
  dabs: u32, // brush dabs this frame
  time: f32,
}

@group(0) @binding(0) var<uniform> S: Sand;

const EMPTY = 0u;
const GRAIN = 1u;
const WATER = 2u;
const WALL = 3u;
