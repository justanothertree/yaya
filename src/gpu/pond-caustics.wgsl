// The caustics: a fine mesh laid on the water, every vertex moved to where light through that
// point of the surface reaches the floor. Where the mesh is squeezed the light is concentrated,
// where it is stretched it is spread thin — so each pixel's brightness is the area of surface it
// came from, measured with the screen-space derivatives of the original position. Light is only
// MOVED, never made: over the whole floor it adds up to what fell on it (pond.test.ts and the
// probe check that). After Evan Wallace's WebGL Water. Joined after pond-types.wgsl.

@group(0) @binding(1) var<storage, read> water: array<vec2f>;

// pond-surface.wgsl is joined here

struct Px {
  @builtin(position) clip: vec4f,
  @location(0) from_: vec2f, // where on the surface this light came through, in texels
}

// the caustic texture is twice the water's resolution each way
const TEXELS = 2.0;

@vertex
fn mesh(@builtin(vertex_index) v: u32) -> Px {
  let cols = P.size.x - 1u;
  let q = v / 6u;
  let corner = array<vec2u, 6>(vec2u(0u, 0u), vec2u(1u, 0u), vec2u(0u, 1u), vec2u(1u, 0u), vec2u(1u, 1u), vec2u(0u, 1u));
  let c = vec2u(q % cols, q / cols) + corner[v % 6u];
  let p = vec2f(c) + 0.5;
  let lands = on_floor(p);
  var o: Px;
  let uv = lands / vec2f(P.size);
  o.clip = vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 0.0, 1.0);
  o.from_ = p * TEXELS;
  return o;
}

@fragment
fn light(px: Px) -> @location(0) vec4f {
  // how much surface lands on this texel: 1 where the water is flat
  let a = dpdx(px.from_);
  let b = dpdy(px.from_);
  let area = abs(a.x * b.y - a.y * b.x);
  return vec4f(vec3f(area), 1.0);
}
