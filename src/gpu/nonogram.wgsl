// The Lab's nonogram, in one fullscreen pass: each pixel works out whether it is in the grid, in
// a row's numbers or in a column's, and reads what it needs from one array of floats — the marks,
// the clues, which lines are done. The numbers themselves come from an atlas drawn by the browser's
// own font at the cell's size, so they stay crisp. When the puzzle is solved a diagonal sweep turns
// the marks into the picture's colours and the grid lines fade out.

struct U {
  // canvas size; the grid's top-left corner, in pixels
  view: vec4f,
  // cell size in pixels, grid width, grid height, time
  grid: vec4f,
  // numbers left of the rows, numbers above the columns, seconds since solved (<0 not), maker (1)
  clue: vec4f,
  // cursor cell (<0 none); the hinted line: 1 a row, 2 a column, 0 none; its index
  cur: vec4f,
  // where the row clues, column clues and line flags start in the array; floats per clue
  offs: vec4f,
  // the revealed paper (0xRRGGBB); numbers in the atlas; unused; unused
  look: vec4f,
}

@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> d: array<f32>;
@group(0) @binding(2) var atlas: texture_2d<f32>;
@group(0) @binding(3) var smp: sampler;

struct Cover {
  @builtin(position) pos: vec4f,
}

@vertex
fn cover(@builtin(vertex_index) i: u32) -> Cover {
  let xy = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  var o: Cover;
  o.pos = vec4f(xy * 2.0 - 1.0, 0.0, 1.0);
  return o;
}

fn rgb(c: f32) -> vec3f {
  let v = u32(c);
  return vec3f(f32((v >> 16u) & 255u), f32((v >> 8u) & 255u), f32(v & 255u)) / 255.0;
}

/** how much of number n covers this point of its cell (f in 0..1 both ways) */
fn number(n: f32, f: vec2f) -> f32 {
  let uv = vec2f((n + clamp(f.x, 0.02, 0.98)) / u.look.y, clamp(f.y, 0.02, 0.98));
  return textureSampleLevel(atlas, smp, uv, 0.0).a;
}

const PAPER = vec3f(0.96, 0.945, 0.9);
const BAND = vec3f(0.9, 0.885, 0.84);
const INK = vec3f(0.16, 0.16, 0.21);
const ACCENT = vec3f(0.15, 0.45, 0.95);
const HINT = vec3f(1.0, 0.86, 0.35);

fn line_flag(k: u32) -> u32 {
  return u32(d[u32(u.offs.z) + k]);
}

@fragment
fn board(in: Cover) -> @location(0) vec4f {
  let s = u.grid.x;
  let w = u.grid.y;
  let h = u.grid.z;
  let t = u.grid.w;
  let left = u.clue.x;
  let top = u.clue.y;
  let g = (in.pos.xy - u.view.zw) / s; // grid units; (0, 0) is the grid's top-left corner
  let stage = vec3f(0.02, 0.02, 0.05);
  if (g.x < -left || g.y < -top || g.x >= w || g.y >= h || (g.x < 0.0 && g.y < 0.0)) {
    return vec4f(stage, 1.0);
  }
  let since = u.clue.z;
  let done_all = since >= 0.0;
  let sweep = select(0.0, since / 1.4, done_all);
  let cur = u.cur.xy;
  let hint_axis = u.cur.z;
  let hint_at = u.cur.w;
  let stride = u.offs.w;

  // ── the numbers beside the rows and above the columns
  if (g.x < 0.0 || g.y < 0.0) {
    let row_side = g.x < 0.0;
    let line = select(floor(g.x), floor(g.y), row_side);
    let j = floor(select(-g.y, -g.x, row_side)); // 0 is the number nearest the grid
    let base = select(u.offs.y, u.offs.x, row_side) + line * stride;
    let n = d[u32(base)];
    var col = BAND;
    if (cur.x >= 0.0 && line == select(cur.x, cur.y, row_side)) {
      col = mix(col, vec3f(0.8, 0.87, 1.0), 0.6);
    }
    let hinted = hint_axis == select(2.0, 1.0, row_side) && hint_at == line;
    if (hinted) {
      col = mix(col, HINT, 0.55 + 0.15 * sin(t * 5.0));
    }
    if (j < n) {
      let value = d[u32(base + 1.0 + (n - 1.0 - j))];
      let f = vec2f(g.x - floor(g.x), g.y - floor(g.y));
      let k = select(u32(line), u32(h + line), !row_side);
      let finished = (line_flag(k) & 1u) == 1u;
      let tone = select(INK, vec3f(0.66, 0.65, 0.63), finished || done_all);
      col = mix(col, tone, number(value, f));
    }
    // a faint rule every five lines, matching the grid's
    let along = select(g.x, g.y, row_side);
    let edge = abs(along - round(along)) * s;
    if (edge < 0.75 && i32(round(along)) % 5 == 0) {
      col = mix(col, vec3f(0.6, 0.58, 0.55), 0.6);
    }
    return vec4f(col, 1.0);
  }

  // ── the grid
  let c = floor(g);
  let f = g - c;
  let i = u32(c.y * w + c.x);
  let mark = d[i * 4u];
  let flags = u32(d[i * 4u + 1u]);
  let colour = rgb(d[i * 4u + 2u]);
  // the reveal travels corner to corner, a cell at a time
  let k = select(0.0, clamp(sweep * 2.0 - (c.x + c.y) / (w + h), 0.0, 1.0), done_all);
  let e = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)) * s; // pixels to this cell's edge

  var col = PAPER;
  if (cur.x >= 0.0 && (c.x == cur.x || c.y == cur.y)) {
    col = mix(col, vec3f(0.84, 0.9, 1.0), 0.45);
  }
  if ((hint_axis == 1.0 && c.y == hint_at) || (hint_axis == 2.0 && c.x == hint_at)) {
    col = mix(col, HINT, 0.35);
  }
  if ((flags & 2u) != 0u && fract((g.x + g.y) * 2.5) < 0.5) {
    col = mix(col, vec3f(0.96, 0.55, 0.2), 0.45); // the maker's undecided cells
  }
  let pulse = 0.5 + 0.5 * sin(t * 6.0);
  if (mark == 1.0 && e > s * 0.06) {
    col = INK;
  }
  if ((flags & 4u) != 0u && e > s * 0.18) {
    col = mix(col, INK, 0.25 + 0.25 * pulse); // a hint: this one is filled
  }
  // a cross: the player's, or a hint's
  let q = f - 0.5;
  let diag = min(abs(q.x - q.y), abs(q.x + q.y)) * 0.7071 * s;
  let inner = max(abs(q.x), abs(q.y)) < 0.28;
  let width = max(0.9, s * 0.045);
  if (mark == 2.0 && inner) {
    col = mix(col, vec3f(0.5, 0.5, 0.56), clamp(width - diag + 0.5, 0.0, 1.0) * (1.0 - k));
  }
  if ((flags & 8u) != 0u && inner) {
    col = mix(col, ACCENT, clamp(width - diag + 0.5, 0.0, 1.0) * (0.4 + 0.5 * pulse));
  }
  // the picture, as it is revealed: every cell to its colour, the empty ones to the paper's
  if (done_all) {
    let want = select(rgb(u.look.x), colour, mark == 1.0);
    col = mix(col, want, k);
  }
  // the grid: thin lines, a heavier one every five, fading as the picture arrives
  let near = round(g);
  let lx = abs(g.x - near.x) * s;
  let ly = abs(g.y - near.y) * s;
  let major_x = i32(near.x) % 5 == 0 || near.x == w;
  let major_y = i32(near.y) % 5 == 0 || near.y == h;
  let wx = select(0.55, 1.1, major_x);
  let wy = select(0.55, 1.1, major_y);
  let lt = select(vec3f(0.72, 0.71, 0.7), vec3f(0.35, 0.35, 0.4), major_x || major_y);
  let on_line = clamp(max(wx - lx + 0.5, wy - ly + 0.5), 0.0, 1.0);
  col = mix(col, lt, on_line * (1.0 - k));
  if ((flags & 1u) != 0u && e < max(2.0, s * 0.1)) {
    col = mix(col, vec3f(0.9, 0.15, 0.15), 0.9); // a hint: this mark is wrong
  }
  if (cur.x == c.x && cur.y == c.y && e < max(2.0, s * 0.09) && !done_all) {
    col = ACCENT;
  }
  return vec4f(col, 1.0);
}
