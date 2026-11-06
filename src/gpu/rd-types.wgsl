// Reaction–diffusion (Gray–Scott): two chemicals on a grid. A is fed in everywhere; B eats A to
// make more of itself and slowly dies. Diffusing at different speeds, they settle into the
// patterns living things are covered in — spots, stripes, coral, cells that divide.
//
// Joined in front of rd-step.wgsl and rd-draw.wgsl by rdEngine.ts, split for the reason Life's
// shaders are: the step writes the grid and the draw may only read it.
//
// ⚠️ `RD` IS PACKED BY HAND IN rd.ts (`RD`); rd.test.ts lays it out from this source.

struct RD {
  cols: u32,
  rows: u32,
  feed: f32, // how fast A is fed in
  kill: f32, // how fast B dies
  da: f32, // how fast A spreads
  db: f32, // how fast B spreads
  brushes: u32, // how many brush dabs to apply before this step
  map: u32, // 1: feed runs across the screen and kill down it, so every pattern shows at once
  view: vec2f, // the canvas, in device pixels
  palette: u32,
  light: f32, // how strongly the surface is lit, for the embossed look
}

// a cell: A in x, B in y
