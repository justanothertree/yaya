// The slime mould's one uniform, shared by the simulation and the drawing.
//
// ⚠️ `Slime` IS PACKED BY HAND IN slime.ts (`SLIME`); slime.test.ts lays it out from here.

struct Slime {
  size: vec2u, // the trail grid, in cells
  agents: u32,
  step: u32, // seeds each agent's dice
  sense_angle: f32, // radians either side of ahead
  sense_dist: f32, // cells ahead it smells
  turn: f32, // radians it turns
  speed: f32, // cells a step
  decay: f32, // share of the trail lost each step
  deposit: f32, // trail an agent leaves
  palette: u32,
  dabs: u32,
  time: f32,
  diffuse: f32, // how far towards its neighbours' mean a cell moves each step
}

@group(0) @binding(0) var<uniform> S: Slime;

const NOTHING = 0u;
const FOOD = 1u;
const WALL = 2u;
const SPORES = 3u;
