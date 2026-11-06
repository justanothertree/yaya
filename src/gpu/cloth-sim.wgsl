// The cloth's physics: position-based dynamics, after Müller et al. and Jakobsen's Hitman cloth.
// Every particle remembers where it was; a step moves it on by its own velocity and gravity
// (Verlet), and then every edge is pulled back towards its own length, over and over, until the
// cloth is cloth again. Pull an edge past TEAR times its length and it breaks.
//
// ⚠️ EDGES ARE PROJECTED IN EIGHT COLOURED PHASES, never all at once: see `edgeEnds` in cloth.ts.
// No two edges in a phase share a particle, so no two threads ever write the same one.
//
// ⚠️ The constants below are mirrored in cloth.ts; cloth.test.ts checks they agree.

// Joined after cloth-types.wgsl.

@group(0) @binding(0) var<uniform> C: Cloth;
@group(0) @binding(1) var<storage, read_write> pos: array<vec4f>; // xyz, w inverse mass (0 pinned)
@group(0) @binding(2) var<storage, read_write> prev: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> grab: array<vec4f>; // xy offset, z finger + 1
@group(0) @binding(4) var<storage, read_write> broken: array<u32>;

const GRAVITY = 2.5;
const DAMP = 0.995;
const TEAR = 2.4;
const GRAB_RADIUS = 0.07;
const FLOOR = -0.98;
const DIAGONAL_STIFF = 0.5;

fn finger(f: u32) -> vec4f {
  switch (f) {
    case 1u: {
      return C.f1;
    }
    case 2u: {
      return C.f2;
    }
    case 3u: {
      return C.f3;
    }
    default: {
      return C.f0;
    }
  }
}

fn wind_at(p: vec2f) -> vec3f {
  let s = 0.6 + 0.4 * sin(p.x * 3.0 + C.time * 1.7) * cos(p.y * 2.3 - C.time * 1.1);
  return vec3f(0.35 * s, 0.0, 1.0 * s) * C.wind;
}

// One step for one particle: let go, take hold, or move on.
@compute @workgroup_size(64)
fn integrate(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= C.cols * C.rows) {
    return;
  }
  let p = pos[i];
  var g = grab[i];
  // a finger that has lifted lets go — and the particle keeps the finger's last velocity, which
  // is what makes a throw a throw
  if (g.z > 0.0 && ((C.down >> u32(g.z - 1.0)) & 1u) == 0u) {
    g = vec4f(0.0);
  }
  // a finger that has just gone down takes hold of everything within reach of it, as it lies
  if (g.z == 0.0 && C.tool == 0u && C.step == 0u) {
    for (var f = 0u; f < 4u; f++) {
      let at = finger(f).xy;
      if (((C.pressed >> f) & 1u) == 1u && distance(p.xy, at) < GRAB_RADIUS) {
        g = vec4f(p.xy - at, f32(f + 1u), 0.0);
        break;
      }
    }
  }
  grab[i] = g;

  if (g.z > 0.0) {
    // held: follow the finger, spread over this frame's steps so it moves rather than jumps
    let fg = finger(u32(g.z - 1.0));
    let k = f32(C.step + 1u) / f32(C.steps);
    let goal = mix(fg.zw, fg.xy, k) + g.xy;
    prev[i] = p;
    pos[i] = vec4f(goal, p.z * 0.9, p.w);
    return;
  }
  if (p.w == 0.0) {
    prev[i] = p;
    return;
  }
  var here = p;
  var q = prev[i];
  // ⚠️ BELOW THE FLOOR IS ON IT, AND STILL. Before `relax` kept the floor too, pulling an edge
  // straight pushed particles through it, and clamping only the NEXT position turned that into an
  // upward kick, a frame at a time — a piece cut loose tore itself apart on landing. `relax` now
  // never leaves one under; this stays so a held particle dragged below cannot kick either.
  if (here.y < FLOOR) {
    here.y = FLOOR;
    q.y = FLOOR;
  }
  let a = vec3f(0.0, -GRAVITY, 0.0) + wind_at(here.xy);
  var n = here.xyz + (here.xyz - q.xyz) * DAMP + a * C.dt * C.dt;
  if (n.y < FLOOR) {
    // the floor: it stops, and drags
    n.y = FLOOR;
    n.x = (n.x + here.x) * 0.5;
  }
  n.x = clamp(n.x, -C.aspect, C.aspect);
  prev[i] = here;
  pos[i] = vec4f(n, p.w);
}

struct Edge {
  a: u32,
  b: u32,
  colour: u32,
  id: u32, // where its broken flag lives
  rest: f32,
  stiff: f32,
}

// mirrors `edgeEnds` in cloth.ts
fn edge(kind: u32, e: u32) -> Edge {
  let c = C.cols;
  let nh = (c - 1u) * C.rows;
  let nv = c * (C.rows - 1u);
  let nq = (c - 1u) * (C.rows - 1u);
  var o: Edge;
  if (kind == 0u) {
    let x = e % (c - 1u);
    let y = e / (c - 1u);
    o = Edge(y * c + x, y * c + x + 1u, x, e, C.spacing, 1.0);
  } else if (kind == 1u) {
    let x = e % c;
    let y = e / c;
    o = Edge(y * c + x, (y + 1u) * c + x, y, nh + e, C.spacing, 1.0);
  } else {
    let x = e % (c - 1u);
    let y = e / (c - 1u);
    let rest = C.spacing * 1.41421356;
    if (kind == 2u) {
      o = Edge(y * c + x, (y + 1u) * c + x + 1u, x, nh + nv + e, rest, DIAGONAL_STIFF);
    } else {
      o = Edge(y * c + x + 1u, (y + 1u) * c + x, x, nh + nv + nq + e, rest, DIAGONAL_STIFF);
    }
  }
  return o;
}

fn kind_count(kind: u32) -> u32 {
  let c = C.cols;
  switch (kind) {
    case 0u: {
      return (c - 1u) * C.rows;
    }
    case 1u: {
      return c * (C.rows - 1u);
    }
    default: {
      return (c - 1u) * (C.rows - 1u);
    }
  }
}

// a particle a finger is holding does not give: the edge's whole correction goes to the other end
fn give(i: u32) -> f32 {
  return select(pos[i].w, 0.0, grab[i].z > 0.0);
}

// One phase of one pass: every edge of one kind and one colour pulled back towards its length.
@compute @workgroup_size(64)
fn relax(@builtin(global_invocation_id) id: vec3u) {
  let kind = C.phase >> 1u;
  if (id.x >= kind_count(kind)) {
    return;
  }
  let e = edge(kind, id.x);
  if ((e.colour & 1u) != (C.phase & 1u) || broken[e.id] != 0u) {
    return;
  }
  let pa = pos[e.a];
  let pb = pos[e.b];
  let d = pb.xyz - pa.xyz;
  let len = length(d);
  if (len > e.rest * TEAR) {
    broken[e.id] = 1u;
    return;
  }
  let wa = give(e.a);
  let wb = give(e.b);
  if (wa + wb == 0.0 || len < 1e-6) {
    return;
  }
  let k = (len - e.rest) / (len * (wa + wb)) * e.stiff;
  // the floor is a constraint like any other, kept inside the loop — so pulling an edge straight
  // can never leave a particle under it
  var na = pa.xyz + d * k * wa;
  var nb = pb.xyz - d * k * wb;
  na.y = max(na.y, FLOOR);
  nb.y = max(nb.y, FLOOR);
  pos[e.a] = vec4f(na, pa.w);
  pos[e.b] = vec4f(nb, pb.w);
}

fn side(p: vec2f, q: vec2f, r: vec2f) -> f32 {
  return (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
}

// The scissors: every edge the stroke crossed since last frame is cut. Mirrors `segmentsCross`.
@compute @workgroup_size(64)
fn cut(@builtin(global_invocation_id) id: vec3u) {
  if (C.tool != 1u) {
    return;
  }
  var left = id.x;
  var kind = 0u;
  loop {
    if (kind >= 4u) {
      return;
    }
    let n = kind_count(kind);
    if (left < n) {
      break;
    }
    left -= n;
    kind++;
  }
  let e = edge(kind, left);
  let a = pos[e.a].xy;
  let b = pos[e.b].xy;
  for (var f = 0u; f < 4u; f++) {
    if (((C.down >> f) & 1u) == 0u) {
      continue;
    }
    let fg = finger(f);
    let c = fg.zw;
    let d = fg.xy;
    if (side(c, d, a) * side(c, d, b) < 0.0 && side(a, b, c) * side(a, b, d) < 0.0) {
      broken[e.id] = 1u;
    }
  }
}
