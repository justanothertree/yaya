// The time mirror's one uniform, shared by the brush and the picture.
//
// ⚠️ `Mirror` IS PACKED BY HAND IN mirror.ts (`MIRROR`); mirror.test.ts lays it out from here.

struct Mirror {
  size: vec2u, // the history's pictures and the delay map, in texels
  head: u32, // the layer holding the newest frame
  frames: u32, // how many layers the ring has
  dabs: u32,
  tint: u32, // 1: colour the picture by how far back it looks, so the brush can be seen
}

@group(0) @binding(0) var<uniform> M: Mirror;
