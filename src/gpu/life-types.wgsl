// Conway's Game of Life on the GPU — what the step and the draw both read. Joined in front of
// life-step.wgsl and life-draw.wgsl by lifeEngine.ts, for the same reason the swarm is split:
// the step writes the cells and the draw must only read them.
//
// ⚠️ `Life` IS PACKED BY HAND IN life.ts (`LIFE`), and life.test.ts lays this struct out from its
// source by WGSL's rules and compares.

struct Life {
  cols: u32,
  rows: u32,
  brush: vec2f, // the press, in cells (x across, y down)
  view: vec2f, // the canvas, in device pixels
  radius: f32, // the brush, in cells
  paint: u32, // 0 nothing, 1 bring cells to life, 2 wipe them
  seed: u32, // salts the random fill
}

// A cell is one u32. ALIVE is alive; anything below it is how recently it died, which is drawn as
// a fading trail and never counts as a neighbour. Mirrored in life.ts, and life.test.ts checks.
const ALIVE = 255u;
const TRAIL = 160u;
const DECAY = 16u;
