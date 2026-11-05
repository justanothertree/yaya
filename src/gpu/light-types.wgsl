// The light room's one uniform, shared by the bake, the trace and the display.
//
// ⚠️ `Light` IS PACKED BY HAND IN light.ts (`LIGHT`); light.test.ts lays it out from here.

struct Light {
  size: vec2u, // the field and the picture, in texels — half the canvas each way
  aspect: f32,
  count: u32, // how many shapes
  frame: u32, // frames gathered since the room last changed
  rays: u32, // rays per texel per frame
  exposure: f32,
  blend: f32, // how much of this frame's light goes into the picture
}

@group(0) @binding(0) var<uniform> L: Light;

// a texel's place in the room: y up, x from -aspect to aspect
fn world(texel: vec2f) -> vec2f {
  let uv = texel / vec2f(L.size);
  return vec2f((uv.x * 2.0 - 1.0) * L.aspect, 1.0 - uv.y * 2.0);
}

fn to_uv(p: vec2f) -> vec2f {
  return vec2f((p.x / L.aspect + 1.0) * 0.5, (1.0 - p.y) * 0.5);
}
