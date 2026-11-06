// The sand itself: the brush, then one Margolus step — see sand.ts for why blocks. `rule` and
// `hash` are mirrored there line for line, and the GPU must match the CPU cell for cell.
// Joined after sand-types.wgsl.

@group(0) @binding(1) var<storage, read_write> cells: array<u32>;
// each dab: x, y, radius (in cells), what it puts down
@group(0) @binding(2) var<storage, read> dabs: array<vec4f>;

fn hash(x: u32, y: u32, step: u32) -> u32 {
  var h = (x * 1597334677u) ^ (y * 3812015801u) ^ (step * 2798796415u);
  h = (h ^ (h >> 16u)) * 2246822519u;
  h = (h ^ (h >> 13u)) * 3266489917u;
  return h ^ (h >> 16u);
}

fn kind(c: u32) -> u32 {
  return c & 3u;
}

fn movable(c: u32) -> bool {
  return kind(c) == GRAIN || kind(c) == WATER;
}

fn sinks(top: u32, below: u32) -> bool {
  return (movable(top) && kind(below) == EMPTY) || (kind(top) == GRAIN && kind(below) == WATER);
}

const FLOWS_RIGHT = 4u;

fn spread(l: u32, r: u32) -> vec2u {
  if (kind(l) == WATER && (l & FLOWS_RIGHT) != 0u) {
    return select(vec2u(l ^ FLOWS_RIGHT, r), vec2u(r, l), kind(r) == EMPTY);
  }
  if (kind(r) == WATER && (r & FLOWS_RIGHT) == 0u) {
    return select(vec2u(l, r ^ FLOWS_RIGHT), vec2u(r, l), kind(l) == EMPTY);
  }
  return vec2u(l, r);
}

fn topple(top: u32, r: u32) -> bool {
  return kind(top) == WATER || (r & 3u) != 0u;
}

// One block, gravity from the top row (a b) to the bottom (c d): only ever SWAPS, so nothing is
// lost or made. Mirrors `rule` in sand.ts.
fn rule(a: u32, b: u32, c: u32, d: u32, r: u32) -> vec4u {
  var A = a;
  var B = b;
  var C = c;
  var D = d;
  var fell_left = false;
  var fell_right = false;
  if (sinks(A, C) && (r & 15u) != 0u) {
    let t = A; A = C; C = t;
    fell_left = true;
  }
  if (sinks(B, D) && ((r >> 4u) & 15u) != 0u) {
    let t = B; B = D; D = t;
    fell_right = true;
  }
  if (!fell_left && !fell_right) {
    let left_first = ((r >> 8u) & 1u) == 0u;
    for (var k = 0u; k < 2u; k++) {
      let side = select(1u - k, k, left_first);
      if (side == 0u && movable(A) && !sinks(A, C) && sinks(A, D) && topple(A, r >> 9u)) {
        let t = A; A = D; D = t;
        break;
      }
      if (side == 1u && movable(B) && !sinks(B, D) && sinks(B, C) && topple(B, r >> 11u)) {
        let t = B; B = C; C = t;
        break;
      }
    }
  }
  // water spreads the way each drop is going, turning round when it meets something — see
  // FLOWS_RIGHT in sand.ts
  if (((r >> 13u) & 7u) != 0u) {
    let low = spread(C, D);
    C = low.x;
    D = low.y;
    if (kind(C) != EMPTY && kind(D) != EMPTY) {
      let high = spread(A, B);
      A = high.x;
      B = high.y;
    }
  }
  return vec4u(A, B, C, D);
}

// where a block's (top-left, top-right, bottom-left, bottom-right) are, with gravity `dir`;
// mirrors `blockCells` in sand.ts
fn cell_of(dir: u32, k: u32) -> vec2u {
  let gs = array<vec2i, 4>(vec2i(0, 1), vec2i(-1, 0), vec2i(0, -1), vec2i(1, 0));
  let g = gs[dir & 3u];
  let u = vec2i(g.y, -g.x);
  let c = vec2i(i32(k & 1u), i32(k >> 1u));
  let v = c.x * u + c.y * g + vec2i(select(0, 1, u.x < 0), select(0, 1, u.y < 0)) + vec2i(select(0, 1, g.x < 0), select(0, 1, g.y < 0));
  return vec2u(v);
}

@compute @workgroup_size(8, 8)
fn brush(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= S.size)) {
    return;
  }
  let i = id.y * S.size.x + id.x;
  let here = vec2f(id.xy) + 0.5;
  for (var k = 0u; k < S.dabs; k++) {
    let d = dabs[k];
    if (distance(here, d.xy) > d.z) {
      continue;
    }
    let what = u32(d.w);
    let r = hash(id.x, id.y, S.step + 977u * k);
    if (what == GRAIN || what == WATER) {
      // poured, not painted: a spray into empty space, each grain its own shade
      if (kind(cells[i]) == EMPTY && (r & 3u) == 0u) {
        cells[i] = what | (((r >> 8u) & 63u) << 2u);
      }
    } else {
      cells[i] = what;
    }
  }
}

@compute @workgroup_size(8, 8)
fn fall(@builtin(global_invocation_id) id: vec3u) {
  let o = S.step & 1u;
  let base = id.xy * 2u + vec2u(o);
  if (base.x + 1u >= S.size.x || base.y + 1u >= S.size.y) {
    return;
  }
  var at: array<u32, 4>;
  for (var k = 0u; k < 4u; k++) {
    let p = base + cell_of(S.gravity, k);
    at[k] = p.y * S.size.x + p.x;
  }
  let out = rule(cells[at[0]], cells[at[1]], cells[at[2]], cells[at[3]], hash(base.x, base.y, S.step));
  cells[at[0]] = out.x;
  cells[at[1]] = out.y;
  cells[at[2]] = out.z;
  cells[at[3]] = out.w;
}
