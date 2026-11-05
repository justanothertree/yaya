// The Lab's particle swarm: one storage buffer of particles, advanced by a compute pass and drawn
// straight out of the same buffer. Nothing round-trips through the CPU.
//
// Three files, joined in swarmEngine.ts: this one holds what both halves read, swarm-step.wgsl
// the compute passes, swarm-draw.wgsl the dots. They are separate modules because the two halves
// must declare the particles differently — read_write to move them, read-only to draw them, since
// a vertex shader may not write — and one module cannot bind the same slot twice.
//
// ⚠️ `Params` IS PACKED BY HAND IN swarm.ts (`PARAMS`), and swarm.test.ts reads this struct back
// out of this file and lays it out by WGSL's own alignment rules. Reorder a field here and that
// test fails, rather than every particle quietly reading its speed out of the pointer's x.

struct Params {
  pointer: vec2f, // where the press is, in world units (x spans ±aspect, y spans ±1)
  aspect: f32,
  dt: f32, // seconds this step covers; 0 draws without moving anything
  time: f32, // simulated seconds, which also salts the scatter
  flow: f32, // how hard the current carries
  pull: f32, // + toward the press, - away from it, 0 when nothing is pressed
  size: f32, // a dot's half-width in clip units
  glow: f32, // per-dot brightness, so a million dots do not burn the screen white
  count: u32,
  palette: u32, // 0 speed, 1 rainbow by heading, 2 fire
}

struct Particle {
  pos: vec2f,
  vel: vec2f,
}
