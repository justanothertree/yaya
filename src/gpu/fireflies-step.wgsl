// The clocks: clear each patch's sums, let every firefly add its phase to its patch, then turn every
// clock towards what it sees round it. See fireflies.ts. Joined after fireflies-types.wgsl.

@group(0) @binding(1) var<storage, read_write> flies: array<vec4f>; // x, y, phase, pace
// per patch: Σ round(cos θ · SCALE), Σ round(sin θ · SCALE), how many — integers, so the sums are exact
@group(0) @binding(2) var<storage, read_write> sums: array<atomic<i32>>;

fn hash(a: u32, b: u32) -> f32 {
  var x = a * 747796405u + b * 2891336453u;
  x = ((x >> ((x >> 28u) + 4u)) ^ x) * 277803737u;
  x = (x >> 22u) ^ x;
  return f32(x) / 4294967295.0;
}

// how hard a beat pulls everyone, and a tap the ones round it, towards flashing; each fades over FADE
// seconds. FOLLOW is how much of a beat's pace they take up. All mirrored in fireflies.ts, which
// says why a beat has to set their pace as well as pull them.
const KICK_PULL = 6.0;
const TAP_PULL = 20.0;
const FADE = 0.12;
const FOLLOW = 0.95;

@compute @workgroup_size(64)
fn clear(@builtin(global_invocation_id) id: vec3u) {
  if (id.x < F.cells * 3u) {
    atomicStore(&sums[id.x], 0);
  }
}

@compute @workgroup_size(64)
fn gather(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= F.count) {
    return;
  }
  let f = flies[id.x];
  let c = cell_of(f.xy);
  let i = (c.y * CELLS_X + c.x) * 3u;
  // WGSL holds cos and sin to their precision only on -π..π, so the clock is read there
  let t = f.z - TAU * round(f.z / TAU);
  atomicAdd(&sums[i], i32(round(cos(t) * SCALE)));
  atomicAdd(&sums[i + 1u], i32(round(sin(t) * SCALE)));
  atomicAdd(&sums[i + 2u], 1);
}

@compute @workgroup_size(64)
fn tick(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= F.count) {
    return;
  }
  var f = flies[id.x];
  // what this firefly sees: its own patch and the eight beside it
  let c = vec2i(cell_of(f.xy));
  var cs = 0.0;
  var sn = 0.0;
  var n = 0.0;
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let q = c + vec2i(dx, dy);
      if (q.x < 0 || q.y < 0 || q.x >= i32(CELLS_X) || q.y >= i32(CELLS_Y)) {
        continue;
      }
      let i = (u32(q.y) * CELLS_X + u32(q.x)) * 3u;
      cs += f32(atomicLoad(&sums[i]));
      sn += f32(atomicLoad(&sums[i + 1u]));
      n += f32(atomicLoad(&sums[i + 2u]));
    }
  }
  var pace = f.w;
  if (F.beat > 0.0) {
    pace = mix(f.w, F.beat, FOLLOW);
  }
  var turn = pace;
  if (n > 0.0) {
    // Kuramoto: K·R·sin(ψ − θ), which is K·(S·cos θ − C·sin θ) with C, S the averaged sums
    let mc = cs / (n * SCALE);
    let ms = sn / (n * SCALE);
    turn += F.pull * (ms * cos(f.z) - mc * sin(f.z));
  }
  // a beat, or a tap nearby: pulled towards flashing as it lands — aimed a little ahead, at
  // pace · FADE, because the pull goes on for FADE seconds while the clock keeps moving
  let aim = sin(pace * FADE - f.z);
  turn += F.kick * KICK_PULL * aim;
  let near = distance(f.xy, F.tap.xy);
  turn += F.tap.z * TAP_PULL * aim * smoothstep(0.25, 0.0, near);
  f.z = f.z + turn * F.dt;
  f.z = f.z - TAU * floor(f.z / TAU);
  // drifting slowly about the meadow, a wander that never leaves it
  let a = hash(id.x, u32(F.time * 2.0)) * TAU;
  f.x = clamp(f.x + cos(a) * 0.004 * F.dt, 0.0, 1.0);
  f.y = clamp(f.y + sin(a) * 0.003 * F.dt, 0.2, 1.0);
  flies[id.x] = f;
}
