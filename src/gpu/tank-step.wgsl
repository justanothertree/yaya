// The compute half of the aquarium: joined after tank-types.wgsl.

@group(0) @binding(0) var<uniform> T: Tank;
@group(0) @binding(1) var<storage, read> fish_in: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> fish_out: array<vec4f>;
// x, y, and how much is left of it (0..1)
@group(0) @binding(3) var<storage, read> pellets: array<vec4f>;

const TILE = 64u;
const SEE = 0.22; // how far a fish notices its own kind
const CROWD = 0.06; // closer than this, it steers away
const FAST = 0.55;
const SLOW = 0.18;

// ⚠️ THE NEIGHBOURS ARRIVE A TILE AT A TIME, through workgroup memory. Every fish has to look at
// every other one; read straight from the storage buffer that is count² scattered reads. Instead
// each workgroup loads 64 fish into shared memory together, every fish in the group reads those 64
// from there, and the group moves on — the same arithmetic, a sixty-fourth of the trips to memory.
var<workgroup> tile: array<vec4f, 64>;

@compute @workgroup_size(64)
fn swim(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_index) lid: u32) {
  let i = gid.x;
  let mine = i < T.count;
  var me = vec4f(0.0);
  if (mine) {
    me = fish_in[i];
  }
  let kind = species(i);
  var away = vec2f(0.0);
  var heading = vec2f(0.0);
  var centre = vec2f(0.0);
  var seen = 0.0;

  let tiles = (T.count + TILE - 1u) / TILE;
  for (var t = 0u; t < tiles; t++) {
    let j0 = t * TILE;
    // everybody loads one, everybody waits, everybody reads all 64 — so the barriers must be
    // reached by the whole group, including the threads past the last fish
    if (j0 + lid < T.count) {
      tile[lid] = fish_in[j0 + lid];
    } else {
      tile[lid] = vec4f(1e6, 1e6, 0.0, 0.0);
    }
    workgroupBarrier();
    if (mine) {
      for (var k = 0u; k < TILE; k++) {
        let j = j0 + k;
        if (j == i || j >= T.count) {
          continue;
        }
        let o = tile[k];
        let d = o.xy - me.xy;
        let dist = length(d);
        if (dist < CROWD) {
          // anyone too close is pushed off, whatever kind they are
          away -= d / max(dist * dist, 1e-4);
        }
        if (dist < SEE && species(j) == kind) {
          heading += o.zw;
          centre += o.xy;
          seen += 1.0;
        }
      }
    }
    workgroupBarrier();
  }
  if (!mine) {
    return;
  }

  var steer = away * 0.0006;
  if (seen > 0.0) {
    steer += (heading / seen - me.zw) * 1.6; // alignment: swim the way they swim
    steer += (centre / seen - me.xy) * 1.1; // cohesion: towards the middle of them
  }
  // food: the nearest pellet with anything left, pulling harder the nearer it is
  var best = 1e6;
  var goal = vec2f(0.0);
  for (var f = 0u; f < T.food; f++) {
    let p = pellets[f];
    let dist = length(p.xy - me.xy);
    if (p.z > 0.0 && dist < best) {
      best = dist;
      goal = p.xy;
    }
  }
  if (best < 0.9) {
    steer += normalize(goal - me.xy) * 1.6 * (1.0 - best / 0.9);
  }
  // the shark: flee, hard, from closer than half the tank
  if (T.hunting > 0.5) {
    let d = me.xy - T.shark;
    let dist = length(d);
    if (dist < 0.5) {
      steer += normalize(d) * 6.0 * (1.0 - dist / 0.5);
    }
  }
  // the glass: turn back from the walls before reaching them
  let wall = vec2f(T.aspect, 1.0) - 0.12;
  steer.x -= select(0.0, sign(me.x) * (abs(me.x) - wall.x) * 30.0, abs(me.x) > wall.x);
  steer.y -= select(0.0, sign(me.y) * (abs(me.y) - wall.y) * 30.0, abs(me.y) > wall.y);

  var v = me.zw + steer * T.dt;
  let speed = length(v);
  v = v / max(speed, 1e-5) * clamp(speed, SLOW, FAST);
  let p = clamp(me.xy + v * T.dt, -vec2f(T.aspect, 1.0), vec2f(T.aspect, 1.0));
  fish_out[i] = vec4f(p, v);
}
