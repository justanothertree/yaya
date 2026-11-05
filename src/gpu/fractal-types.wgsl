// The fractal's one uniform, shared by the iteration and the colouring.
//
// ⚠️ `Fractal` IS PACKED BY HAND IN fractal.ts (`FRACTAL`); fractal.test.ts lays it out from here.

struct Fractal {
  size: vec2u, // the canvas, in pixels
  scale: f32, // how much of the plane one pixel spans
  max_iter: u32,
  ref_len: u32, // how many points of the reference orbit there are
  julia: u32, // 0 Mandelbrot, 1 Julia
  time: f32,
  palette: u32,
  cycle: f32, // how far round its palette the colouring has turned
  block: u32, // 1 for every pixel; 2 while the view moves, one in four, each filling its 2×2
}

@group(0) @binding(0) var<uniform> F: Fractal;
