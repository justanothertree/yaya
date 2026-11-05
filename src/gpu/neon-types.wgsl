// The neon sign's one uniform, shared by the seeding, the flood and the display.
//
// ⚠️ `Neon` IS PACKED BY HAND IN neon.ts (`NEON`); neon.test.ts lays it out from here.

struct Neon {
  size: vec2u, // the field, in texels — half the canvas each way
  step: u32, // this flood pass's jump, in texels
  style: u32, // 0 tube (seeds on the letters' outlines), 1 solid (seeds fill them)
  time: f32,
  scale: f32, // canvas pixels per field texel
  palette: u32,
  letters: u32,
}

@group(0) @binding(0) var<uniform> N: Neon;
