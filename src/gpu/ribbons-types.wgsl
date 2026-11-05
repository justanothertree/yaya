// Ribbons of light that dance by themselves. Two halves:
//
// `advance` moves each ribbon's head one frame (a spring towards its point in the dance) and
// writes where it got to into that ribbon's TRAIL — a ring buffer. Nothing in the trail ever
// moves: each frame writes one new point over the oldest, and `head` says which slot is newest.
// A trail of 160 points costs one write a frame, not 160.
//
// `strip` builds the ribbon from the trail in the vertex shader: two vertices across each point,
// spread along a direction that faces the camera and TWISTS slowly down the length, so the ribbon
// turns edge-on and back as it goes — which is what makes a flat strip read as silk in space.
//
// ⚠️ `Ribbons` IS PACKED BY HAND IN ribbons.ts (`RIBBONS`); the dances and the spring are mirrored
// there too, and ribbons.test.ts and the Lab's GPU probe hold the two together.

struct Ribbons {
  right: vec4f, // the camera; w the aspect
  up: vec4f, // w the time
  fwd: vec4f, // w the focal length
  eye: vec4f,
  lead: vec4f, // xyz where a finger leads them, w how strongly (0: nobody leading)
  count: u32,
  length: u32,
  head: u32, // the slot this frame writes, and so the newest
  dance: u32,
  pulse: f32, // the music's loudness
  kick: f32, // 1 on a beat, falling away
  dt: f32,
  width: f32,
}

@group(0) @binding(0) var<uniform> U: Ribbons;
