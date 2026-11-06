// The clay's one uniform and its distance sums, shared by the sculpting and the drawing.
//
// ⚠️ `Clay` IS PACKED BY HAND IN clay.ts (`CLAY`), and `smin`/`ssub`/`lump` mirror the functions
// there; clay.test.ts and the probe hold them together.

struct Clay {
  eye: vec4f, // the camera; w the aspect
  fwd: vec4f, // w the focal length
  right: vec4f,
  up: vec4f,
  ray_o: vec4f, // the finger's ray, in the volume's space; w the brush's radius
  ray_d: vec4f, // w 1 while a finger is sculpting
  n: u32, // voxels each way
  tool: u32, // 0 add, 1 carve, 2 smooth, 3 turn
  mirror: u32, // 1: every stroke is made on both sides
  glaze: u32,
}

@group(0) @binding(0) var<uniform> C: Clay;

const BLEND = 0.08;

fn smin(a: f32, b: f32) -> f32 {
  let h = max(BLEND - abs(a - b), 0.0) / BLEND;
  return min(a, b) - h * h * BLEND * 0.25;
}

fn ssub(a: f32, b: f32) -> f32 {
  return -smin(-a, b);
}

fn lump(p: vec3f) -> f32 {
  return length(vec3f(p.x, p.y * 1.15, p.z)) - 0.55;
}

// where a ray enters and leaves the volume's cube, -1..1 each way (far < near: it misses)
fn cube(o: vec3f, d: vec3f) -> vec2f {
  let inv = 1.0 / d;
  let a = (vec3f(-1.0) - o) * inv;
  let b = (vec3f(1.0) - o) * inv;
  let lo = min(a, b);
  let hi = max(a, b);
  return vec2f(max(max(lo.x, lo.y), lo.z), min(min(hi.x, hi.y), hi.z));
}
