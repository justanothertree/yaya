// The compute half: joined after swarm-types.wgsl, which declares Params and Particle.

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read_write> parts: array<Particle>;

// The current is the CURL of a stream function, so it is divergence-free: it swirls and has no
// sinks of its own. psi = sin(a)·cos(b) + 0.5·sin(c), and the velocity is (∂psi/∂y, −∂psi/∂x).
//
// ⚠️ THAT IS NOT ENOUGH TO STOP THE SWARM COLLAPSING, and this comment once claimed it was. The
// particles EASE toward the current rather than riding it exactly, and particles with inertia
// gather in a sink-free flow anyway. Measured on a 480×270 field of 32K: 55,000 lit pixels at the
// scatter, 23,000 after five seconds, 8,000 after twenty — every particle drawn into a few thin
// threads. `LIFE` is what holds it open: see the rebirth at the end of `advance`.
fn current(p: vec2f, t: f32) -> vec2f {
  let a = p.x * 1.7 + t * 0.31;
  let b = p.y * 1.3 - t * 0.23;
  let c = p.x * 3.1 - p.y * 2.3 + t * 0.47;
  let dpsi_dx = 1.7 * cos(a) * cos(b) + 0.5 * 3.1 * cos(c);
  let dpsi_dy = -1.3 * sin(a) * sin(b) - 0.5 * 2.3 * cos(c);
  return vec2f(dpsi_dy, -dpsi_dx);
}

const MAX_SPEED = 4.0;
// a particle's mean lifetime in seconds, before it is reborn somewhere at random
const LIFE = 6.0;
// the square of how far a press reaches, in world units — about half the field's height
const REACH2 = 0.25;

@compute @workgroup_size(64)
fn advance(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= P.count) {
    return;
  }
  var q = parts[i];
  // ease toward the current rather than snapping to it, so a pull leaves a wake that settles
  let want = current(q.pos, P.time) * P.flow;
  q.vel = mix(q.vel, want, 1.0 - exp(-P.dt * 2.0));
  if (P.pull != 0.0) {
    let d = P.pointer - q.pos;
    let r2 = dot(d, d);
    // softened, or a dot passing through the press would be flung at infinite speed — and
    // REACHED, or it is gravity: unbounded, a press held for two seconds gathered nearly the
    // whole field into one ball and left nothing for the current to carry
    q.vel += d * (P.pull * P.dt * 1.2 * exp(-r2 / REACH2) / (r2 + 0.02));
  }
  let speed = length(q.vel);
  if (speed > MAX_SPEED) {
    q.vel *= MAX_SPEED / speed;
  }
  q.pos += q.vel * P.dt;
  // wrap at the edges into [-span, span), which is the visible field whatever its shape
  let span = vec2f(P.aspect, 1.0);
  q.pos = (fract((q.pos + span) / (2.0 * span)) * 2.0 - 1.0) * span;
  // Reborn with a chance of dt/LIFE each step, so the field keeps a steady trickle of fresh
  // particles that the threads are drawn back out of. A coin, not a countdown: it needs no
  // storage, and with dt = 0 it never lands, so a still frame stays still.
  let coin = pcg(i) ^ bitcast<u32>(P.time);
  if (unit(coin) < P.dt / LIFE) {
    q.pos = vec2f((unit(coin ^ 0x9e3779b9u) * 2.0 - 1.0) * P.aspect, unit(coin ^ 0x7f4a7c15u) * 2.0 - 1.0);
    q.vel = vec2f(0.0, 0.0);
  }
  parts[i] = q;
}

// PCG hash: a good spread from consecutive inputs, which is all a scatter needs.
fn pcg(v: u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}

// [0, 1) — 24 bits, because that is all an f32 can hold exactly
fn unit(v: u32) -> f32 {
  return f32(pcg(v) >> 8u) / 16777216.0;
}

// Scattering on the GPU rather than filling a Float32Array: two million particles is 32 MB, and
// building that in JavaScript to upload it would stall the page for the one moment it is busiest.
@compute @workgroup_size(64)
fn scatter(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= P.count) {
    return;
  }
  let salt = pcg(bitcast<u32>(P.time));
  let x = (unit(salt ^ (2u * i)) * 2.0 - 1.0) * P.aspect;
  let y = unit(salt ^ (2u * i + 1u)) * 2.0 - 1.0;
  parts[i] = Particle(vec2f(x, y), vec2f(0.0, 0.0));
}
