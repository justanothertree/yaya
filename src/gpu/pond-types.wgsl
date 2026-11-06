// The pond's one uniform, shared by the waves, the caustics and the display.
//
// ⚠️ `Pond` IS PACKED BY HAND IN pond.ts (`POND`); pond.test.ts lays it out from here.

struct Pond {
  size: vec2u, // the water, in cells
  drops: u32, // drops falling this step
  floor: u32, // 0 pool tiles, 1 pebbles, 2 sand
  time: f32,
  depth: f32, // how far below the surface the floor is, in cells
  pull: f32, // how hard a cell is pulled towards its neighbours
  damp: f32, // how much of its speed a cell keeps
}

@group(0) @binding(0) var<uniform> P: Pond;

const ETA = 0.7518797; // 1 / 1.33: from air into water
// how steep a cell's height difference makes the surface: heights are small, cells are big
const SLOPE = 2.5;
