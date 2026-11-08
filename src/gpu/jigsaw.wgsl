// The Lab's jigsaw. Three things are drawn: the table (felt, and the board's tray with the picture
// faint in it when asked), the pieces' shadows, and the pieces. A fourth pass paints a built-in
// picture into a texture, once per puzzle.
//
// ⚠️ A PIECE IS A SQUARE QUAD CUT BY THE SAME RULE AS jigsaw.ts's `owner`. Each piece is drawn as its
// cell grown by REACH on every side; the fragment asks which piece owns that point of the board as
// cut, and keeps it only if the answer is this piece. So the outline drawn, the outline picked up
// and the hole in the neighbour are one circle asked three ways.

struct U {
  // canvas size in pixels; where the board's (0, 0) lands, in pixels
  view: vec4f,
  // pixels a cell, columns, rows, pieces
  grid: vec4f,
  // the table's corners, in cells
  table: vec4f,
  // time (s), ghost 0..1, the held group (−1 none), seconds since finishing (−1 not finished)
  live: vec4f,
  // the picture being painted (index into PICTURES), its texture's width/height, unused ×2
  paint: vec4f,
}

@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> across: array<vec4f>;
@group(0) @binding(2) var<storage, read> down: array<vec4f>;
@group(0) @binding(3) var<storage, read> pieces: array<vec4f>;
@group(0) @binding(4) var<storage, read> order: array<u32>;
@group(0) @binding(5) var pic: texture_2d<f32>;
@group(0) @binding(6) var smp: sampler;

const REACH = 0.34;

fn inside(k: vec4f, p: vec2f) -> bool {
  let d = p - k.xy;
  return dot(d, d) < k.z * k.z;
}

// the piece a point of the board belongs to, or −1 off it — jigsaw.ts `owner`, line for line
fn owner_at(p: vec2f) -> i32 {
  let cols = i32(u.grid.y);
  let rows = i32(u.grid.z);
  if (!(p.x >= 0.0 && p.y >= 0.0 && p.x < f32(cols) && p.y < f32(rows))) {
    return -1;
  }
  let c = i32(floor(p.x));
  let r = i32(floor(p.y));
  if (c > 0) {
    let k = across[r * (cols - 1) + c - 1];
    if (inside(k, p)) { return i32(k.w); }
  }
  if (c < cols - 1) {
    let k = across[r * (cols - 1) + c];
    if (inside(k, p)) { return i32(k.w); }
  }
  if (r > 0) {
    let k = down[(r - 1) * cols + c];
    if (inside(k, p)) { return i32(k.w); }
  }
  if (r < rows - 1) {
    let k = down[r * cols + c];
    if (inside(k, p)) { return i32(k.w); }
  }
  return r * cols + c;
}

fn home(k: i32) -> vec2f {
  let cols = i32(u.grid.y);
  return vec2f(f32(k % cols), f32(k / cols));
}

/* ------------------------------------------------------------------ cover: one big triangle ---- */

struct Cover {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn cover(@builtin(vertex_index) i: u32) -> Cover {
  let xy = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  var o: Cover;
  o.pos = vec4f(xy * 2.0 - 1.0, 0.0, 1.0);
  o.uv = vec2f(xy.x, 1.0 - xy.y);
  return o;
}

fn hash(p: vec2f) -> f32 {
  let q = fract(p * vec2f(127.1, 311.7));
  return fract(sin(dot(q, vec2f(12.9898, 78.233)) * 43758.5453) + q.x * q.y);
}

fn noise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let w = f * f * (3.0 - 2.0 * f);
  let a = hash(i);
  let b = hash(i + vec2f(1.0, 0.0));
  let c = hash(i + vec2f(0.0, 1.0));
  let d = hash(i + vec2f(1.0, 1.0));
  return mix(mix(a, b, w.x), mix(c, d, w.x), w.y);
}

fn fbm(p: vec2f) -> f32 {
  var s = 0.0;
  var a = 0.5;
  var q = p;
  for (var i = 0; i < 5; i++) {
    s += a * noise(q);
    q = q * 2.03 + vec2f(1.7, 9.2);
    a *= 0.5;
  }
  return s;
}

/* ------------------------------------------------------------------ the table ------------------ */

@fragment
fn table_fs(in: Cover) -> @location(0) vec4f {
  let px = in.pos.xy;
  let t = (px - u.view.zw) / u.grid.x;
  let inTable = t.x >= u.table.x && t.y >= u.table.y && t.x <= u.table.z && t.y <= u.table.w;
  if (!inTable) {
    return vec4f(0.02, 0.02, 0.05, 1.0);
  }
  // felt: a deep green with a fine nap
  let nap = noise(px * 0.9) * 0.04 + fbm(t * 1.3) * 0.05;
  var col = vec3f(0.07, 0.22, 0.18) + nap;
  // darker towards the table's rim
  let edge = min(min(t.x - u.table.x, u.table.z - t.x), min(t.y - u.table.y, u.table.w - t.y));
  col *= 0.75 + 0.25 * smoothstep(0.0, 1.5, edge);
  // the board's tray: a recessed panel exactly the picture's size, with a lip round it
  let size = u.grid.yz;
  let inBoard = t.x >= 0.0 && t.y >= 0.0 && t.x <= size.x && t.y <= size.y;
  let beyond = max(max(-t.x, t.x - size.x), max(-t.y, t.y - size.y));
  if (inBoard) {
    col = vec3f(0.11, 0.12, 0.13) + noise(px * 0.7) * 0.02;
    // a ghost of the picture, when asked for: enough to aim by, not enough to copy
    let g = textureSampleLevel(pic, smp, t / size, 0.0).rgb;
    col = mix(col, g, u.live.y * 0.32);
    // the inner shadow of the lip
    let inner = min(min(t.x, size.x - t.x), min(t.y, size.y - t.y));
    col *= 0.7 + 0.3 * smoothstep(0.0, 0.18, inner);
  } else if (beyond < 0.12) {
    col = mix(vec3f(0.42, 0.33, 0.22), vec3f(0.3, 0.23, 0.15), beyond / 0.12);
  }
  return vec4f(col, 1.0);
}

/* ------------------------------------------------------------------ pieces --------------------- */

struct Bit {
  @builtin(position) pos: vec4f,
  // the point on the table, in cells
  @location(0) t: vec2f,
  @location(1) @interpolate(flat) k: u32,
}

const CORNERS = array<vec2f, 6>(
  vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(0.0, 1.0),
  vec2f(0.0, 1.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0),
);

fn lifted(k: u32) -> bool {
  return u.live.z >= 0.0 && pieces[k].z == u.live.z;
}

// where a piece is drawn: where it is, and a little up and left while it is held
fn drawn_at(k: u32) -> vec2f {
  let at = pieces[k].xy;
  if (lifted(k)) {
    return at - vec2f(0.03, 0.04);
  }
  return at;
}

fn to_clip(t: vec2f) -> vec4f {
  let px = t * u.grid.x + u.view.zw;
  return vec4f(px.x / u.view.x * 2.0 - 1.0, 1.0 - px.y / u.view.y * 2.0, 0.0, 1.0);
}

fn quad(i: u32, at: vec2f) -> vec2f {
  return at - vec2f(REACH) + CORNERS[i] * (1.0 + 2.0 * REACH);
}

// a shadow falls down and right of a piece, further for a held one; a piece in place has none
fn shadow_off(k: u32) -> vec2f {
  if (lifted(k)) {
    return vec2f(0.1, 0.14);
  }
  return vec2f(0.035, 0.05);
}

@vertex
fn shade_vs(@builtin(vertex_index) i: u32, @builtin(instance_index) j: u32) -> Bit {
  let k = order[j];
  var o: Bit;
  let at = drawn_at(k) + shadow_off(k);
  o.t = quad(i, at);
  o.k = k;
  o.pos = to_clip(o.t);
  if (pieces[k].w > 0.5) {
    o.pos = vec4f(2.0, 2.0, 0.0, 1.0); // placed: no shadow, the quad is sent off screen
  }
  return o;
}

@fragment
fn shade_fs(in: Bit) -> @location(0) vec4f {
  let k = in.k;
  let b = in.t - (drawn_at(k) + shadow_off(k)) + home(i32(k));
  // a soft edge: four samples a little apart, so the shadow is not a hard copy of the outline
  let e = 1.5 / u.grid.x;
  var a = 0.0;
  a += select(0.0, 0.25, owner_at(b + vec2f(e, e)) == i32(k));
  a += select(0.0, 0.25, owner_at(b + vec2f(-e, e)) == i32(k));
  a += select(0.0, 0.25, owner_at(b + vec2f(e, -e)) == i32(k));
  a += select(0.0, 0.25, owner_at(b + vec2f(-e, -e)) == i32(k));
  if (a <= 0.0) {
    discard;
  }
  let dark = select(0.38, 0.3, lifted(k));
  return vec4f(0.0, 0.0, 0.0, a * dark);
}

@vertex
fn piece_vs(@builtin(vertex_index) i: u32, @builtin(instance_index) j: u32) -> Bit {
  let k = order[j];
  var o: Bit;
  o.t = quad(i, drawn_at(k));
  o.k = k;
  o.pos = to_clip(o.t);
  return o;
}

// does the neighbour at `o` belong with piece k: the same piece, or a piece of its group
fn kin(k: u32, o: i32) -> bool {
  if (o == i32(k)) { return true; }
  if (o < 0) { return false; }
  return pieces[u32(o)].z == pieces[k].z;
}

@fragment
fn piece_fs(in: Bit) -> @location(0) vec4f {
  let k = in.k;
  let b = in.t - drawn_at(k) + home(i32(k));
  if (owner_at(b) != i32(k)) {
    discard;
  }
  let size = u.grid.yz;
  var col = textureSampleLevel(pic, smp, b / size, 0.0).rgb;
  // the bevel: light from the top left. Asked at two distances, so the rim has a gradient; against
  // a piece of its own group the cut is only a hairline, the way a finished puzzle still shows it
  let px = 1.0 / u.grid.x;
  var light = 0.0;
  var seam = 0.0;
  let dirs = array<vec2f, 4>(vec2f(-1.0, 0.0), vec2f(0.0, -1.0), vec2f(1.0, 0.0), vec2f(0.0, 1.0));
  for (var d = 0; d < 4; d++) {
    let v = dirs[d];
    let facing = select(-1.0, 1.0, d < 2); // up and left are lit; down and right are in shade
    for (var s = 1; s <= 3; s++) {
      let o = owner_at(b + v * px * f32(s) * 1.2);
      if (o == i32(k)) { continue; }
      if (kin(k, o)) {
        if (s == 1) { seam = 1.0; }
      } else {
        light += facing * (0.24 - 0.06 * f32(s));
      }
      break;
    }
  }
  col = col * (1.0 + light) + vec3f(max(light, 0.0) * 0.25);
  col *= 1.0 - seam * 0.22;
  // a held piece is a touch brighter, so the hand can see what it has
  if (lifted(k)) {
    col *= 1.06;
  }
  // finished: a sheen sweeps the picture once, corner to corner
  let f = u.live.w;
  if (f >= 0.0) {
    let along = (b.x + b.y) / (size.x + size.y);
    let band = 1.0 - smoothstep(0.0, 0.07, abs(along - (f * 0.55 - 0.15)));
    col += vec3f(band * 0.35);
  }
  return vec4f(clamp(col, vec3f(0.0), vec3f(1.0)), 1.0);
}

/* ------------------------------------------------------------------ the pictures --------------- */

fn hills(uv: vec2f) -> vec3f {
  // a sky going from gold at the horizon to violet overhead, a low sun, and five ridges
  var col = mix(vec3f(1.0, 0.62, 0.3), vec3f(0.24, 0.12, 0.38), smoothstep(0.62, 0.0, uv.y));
  col = mix(col, vec3f(0.08, 0.06, 0.22), smoothstep(0.35, 0.0, uv.y));
  let sun = length((uv - vec2f(0.68, 0.5)) * vec2f(1.33, 1.0));
  col = mix(col, vec3f(1.0, 0.9, 0.6), smoothstep(0.075, 0.07, sun));
  col += vec3f(1.0, 0.5, 0.2) * 0.25 * exp(-sun * 7.0);
  // a few stars where the sky is dark
  let st = floor(uv * vec2f(160.0, 120.0));
  if (hash(st) > 0.992 && uv.y < 0.3) {
    col += vec3f(0.8) * (1.0 - uv.y / 0.3);
  }
  for (var i = 0; i < 5; i++) {
    let fi = f32(i);
    let base = 0.5 + fi * 0.1;
    let h = base - 0.09 * fbm(vec2f(uv.x * (2.0 + fi), fi * 3.1)) - 0.03 * sin(uv.x * (5.0 + fi * 2.0) + fi);
    if (uv.y > h) {
      let shade = mix(vec3f(0.55, 0.32, 0.42), vec3f(0.08, 0.05, 0.12), fi / 4.0);
      // trees along the nearer ridges
      let tree = select(0.0, step(0.75, noise(vec2f(uv.x * 90.0, fi))), i >= 3);
      col = shade * (1.0 - 0.12 * (uv.y - h) * 8.0) - tree * 0.03;
      if (i >= 3 && uv.y < h + 0.012 * tree) {
        col = shade * 0.6;
      }
    }
  }
  return col;
}

fn quilt(uv: vec2f) -> vec3f {
  let n = vec2f(8.0, 6.0);
  let cell = floor(uv * n);
  let f = fract(uv * n);
  let r = hash(cell + 3.0);
  let palette = array<vec3f, 6>(
    vec3f(0.85, 0.25, 0.25), vec3f(0.95, 0.75, 0.3), vec3f(0.25, 0.55, 0.75),
    vec3f(0.35, 0.65, 0.4), vec3f(0.6, 0.35, 0.65), vec3f(0.95, 0.9, 0.8),
  );
  let a = palette[u32(r * 6.0) % 6u];
  let b = palette[u32(hash(cell + 9.0) * 6.0) % 6u] * 0.85;
  let kind = u32(hash(cell + 17.0) * 5.0);
  var on = false;
  if (kind == 0u) {
    on = fract((f.x + f.y) * 4.0) < 0.5; // diagonal stripes
  } else if (kind == 1u) {
    on = length(fract(f * 4.0) - 0.5) < 0.28; // dots
  } else if (kind == 2u) {
    on = (u32(f.x * 4.0) + u32(f.y * 4.0)) % 2u == 0u; // checks
  } else if (kind == 3u) {
    on = abs(fract(f.y * 3.0 + abs(fract(f.x * 3.0) - 0.5)) - 0.5) < 0.18; // zigzag
  } else {
    on = max(abs(f.x - 0.5), abs(f.y - 0.5)) < 0.3 && max(abs(f.x - 0.5), abs(f.y - 0.5)) > 0.18; // a frame
  }
  var col = select(a, b, on);
  // the cloth's weave, and the stitching round every patch
  col *= 0.94 + 0.06 * sin(uv.x * 900.0) * sin(uv.y * 900.0);
  let edge = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
  let stitch = edge < 0.03 && fract((f.x + f.y) * 20.0) < 0.5;
  col = select(col, vec3f(0.97, 0.95, 0.88), stitch);
  col *= 0.8 + 0.2 * smoothstep(0.0, 0.04, edge);
  return col;
}

fn garden(uv: vec2f) -> vec3f {
  // sky and a wooden fence behind, grass and flowers in front
  var col = mix(vec3f(0.55, 0.78, 0.95), vec3f(0.85, 0.93, 1.0), uv.y / 0.3);
  let cloud = fbm(uv * vec2f(4.0, 8.0) + vec2f(2.0, 0.0));
  col = mix(col, vec3f(1.0), smoothstep(0.55, 0.7, cloud) * step(uv.y, 0.25));
  if (uv.y > 0.22) {
    let plank = fract(uv.x * 14.0);
    let top = 0.22 + 0.025 * abs(plank - 0.5);
    if (uv.y > top) {
      col = vec3f(0.62, 0.45, 0.3) * (0.85 + 0.15 * noise(vec2f(uv.x * 14.0, uv.y * 80.0)));
      col *= select(1.0, 0.7, plank < 0.06);
    }
  }
  if (uv.y > 0.42) {
    col = vec3f(0.2, 0.5, 0.18) * (0.75 + 0.35 * fbm(uv * vec2f(60.0, 12.0)));
    // flowers: one in some cells of a jittered grid, nearer ones bigger. The grid itself is one
    // size everywhere — a grid whose scale varied with height smeared every flower into a streak
    let depth = (uv.y - 0.42) / 0.58;
    let g = uv * vec2f(12.0, 9.0);
    let id = floor(g);
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        let c = id + vec2f(f32(dx), f32(dy));
        if (hash(c + 1.3) < 0.35) { continue; }
        let centre = c + vec2f(hash(c), hash(c + 7.7)) * 0.6 + 0.2;
        let d = g - centre;
        let ang = atan2(d.y, d.x);
        let petals = 5.0 + floor(hash(c + 3.3) * 3.0);
        let r = (0.28 + 0.1 * cos(ang * petals)) * mix(0.55, 1.15, depth);
        let len = length(d);
        let hue = hash(c + 5.1);
        let petal = mix(vec3f(0.95, 0.3, 0.45), vec3f(1.0, 0.85, 0.25), hue);
        let petal2 = mix(petal, vec3f(0.6, 0.45, 0.95), step(0.7, hue));
        if (len < r) {
          col = petal2 * (0.75 + 0.35 * (1.0 - len / r));
        }
        if (len < 0.09 * mix(0.55, 1.15, depth)) {
          col = vec3f(0.95, 0.75, 0.2) * 0.9;
        }
      }
    }
  }
  return col;
}

fn city(uv: vec2f) -> vec3f {
  var col = mix(vec3f(0.02, 0.03, 0.1), vec3f(0.2, 0.12, 0.35), smoothstep(0.0, 0.62, uv.y));
  let moon = length((uv - vec2f(0.2, 0.17)) * vec2f(1.333, 1.0));
  col = mix(col, vec3f(0.95, 0.93, 0.82), smoothstep(0.052, 0.048, moon));
  col += vec3f(0.3, 0.3, 0.4) * exp(-moon * 12.0) * 0.4;
  if (hash(floor(uv * vec2f(200.0, 150.0))) > 0.995 && uv.y < 0.4) {
    col += vec3f(0.7);
  }
  let water = 0.74;
  // the buildings, two rows deep, each with its own height and window colour
  var y = uv.y;
  var mirrored = 0.0;
  if (uv.y > water) {
    y = water - (uv.y - water) - 0.004 * sin(uv.y * 400.0 + uv.x * 40.0);
    mirrored = 1.0;
  }
  for (var row = 0; row < 2; row++) {
    let w = select(0.045, 0.07, row == 1);
    let bx = floor(uv.x / w + f32(row) * 0.5);
    let fx = fract(uv.x / w + f32(row) * 0.5);
    let h = water - (0.12 + 0.35 * hash(vec2f(bx, f32(row)))) * select(1.0, 0.8, row == 1);
    if (y > h && fx > 0.06 && fx < 0.94) {
      let shade = select(vec3f(0.08, 0.07, 0.14), vec3f(0.04, 0.035, 0.07), row == 1);
      col = shade;
      let win = vec2f(fx * 5.0, (y - h) * 90.0);
      let wid = floor(win) + vec2f(bx * 7.0, f32(row) * 13.0);
      let lit = hash(wid) > 0.55;
      let inWin = fract(win.x) > 0.25 && fract(win.x) < 0.75 && fract(win.y) > 0.3 && fract(win.y) < 0.8;
      if (lit && inWin && win.x > 0.5 && win.x < 4.5) {
        col = mix(vec3f(1.0, 0.8, 0.4), vec3f(0.6, 0.85, 1.0), step(0.8, hash(wid + 2.0)));
      }
    }
  }
  if (mirrored > 0.5) {
    col = col * 0.45 + vec3f(0.02, 0.04, 0.08);
  }
  return col;
}

fn marbled(uv: vec2f) -> vec3f {
  // marbled endpaper: bands of ink combed and swirled
  var p = uv * vec2f(4.0, 3.0);
  let w = vec2f(fbm(p + vec2f(0.0, 1.3)), fbm(p + vec2f(5.2, 0.7)));
  p += 1.8 * w;
  let v = fbm(p * 1.4) + 0.15 * sin(uv.x * 40.0 + w.x * 6.0);
  let t = fract(v * 3.5);
  var col: vec3f;
  if (t < 0.25) {
    col = mix(vec3f(0.08, 0.16, 0.38), vec3f(0.2, 0.42, 0.7), t / 0.25);
  } else if (t < 0.5) {
    col = mix(vec3f(0.95, 0.88, 0.7), vec3f(0.85, 0.6, 0.3), (t - 0.25) / 0.25);
  } else if (t < 0.75) {
    col = mix(vec3f(0.7, 0.2, 0.2), vec3f(0.35, 0.08, 0.15), (t - 0.5) / 0.25);
  } else {
    col = mix(vec3f(0.12, 0.35, 0.3), vec3f(0.08, 0.16, 0.38), (t - 0.75) / 0.25);
  }
  // fine veins between the bands
  col *= 0.85 + 0.15 * smoothstep(0.0, 0.03, min(t, 1.0 - t));
  return col;
}

fn reef(uv: vec2f) -> vec3f {
  var col = mix(vec3f(0.2, 0.65, 0.8), vec3f(0.02, 0.15, 0.3), uv.y);
  // light falling through the surface
  let ray = sin(uv.x * 22.0 + uv.y * 6.0 + 1.3 * sin(uv.x * 5.0)) * 0.5 + 0.5;
  col += vec3f(0.15, 0.2, 0.2) * pow(ray, 6.0) * (1.0 - uv.y);
  // fish: little bodies with tails, in schools of a colour
  let g = uv * vec2f(16.0, 12.0);
  let id = floor(g);
  if (hash(id + 2.2) > 0.82 && uv.y < 0.62) {
    let f = fract(g) - vec2f(0.5);
    let body = length(f * vec2f(1.0, 2.2)) < 0.28;
    let tail = f.x > 0.22 && f.x < 0.42 && abs(f.y) < (f.x - 0.2) * 0.9;
    if (body || tail) {
      col = mix(vec3f(1.0, 0.55, 0.1), vec3f(1.0, 0.9, 0.2), step(0.5, hash(id)));
      col = mix(col, vec3f(0.3, 0.6, 1.0), step(0.85, hash(id + 4.0)));
      if (length(f - vec2f(-0.15, -0.03)) < 0.04) { col = vec3f(0.05); }
    }
  }
  // coral: fbm heads along the floor, each a colour of its own
  let floor_y = 0.58 + 0.08 * fbm(vec2f(uv.x * 3.0, 1.0));
  if (uv.y > floor_y) {
    let n = fbm(uv * vec2f(18.0, 14.0));
    let bed = floor(uv.x * 7.0 + n * 2.0);
    let k = hash(vec2f(bed, 4.0));
    var coral = mix(vec3f(0.95, 0.4, 0.5), vec3f(0.98, 0.65, 0.3), k);
    coral = mix(coral, vec3f(0.6, 0.35, 0.8), step(0.7, k));
    coral = mix(coral, vec3f(0.3, 0.75, 0.55), step(0.88, k));
    col = coral * (0.5 + 0.6 * n);
    // polyps
    let dots = length(fract(uv * vec2f(120.0, 90.0)) - 0.5);
    col *= 0.85 + 0.15 * smoothstep(0.2, 0.35, dots);
  } else if (uv.y > floor_y - 0.25) {
    // fronds of weed swaying up from the floor
    let x = uv.x * 30.0 + 0.6 * sin(uv.y * 25.0);
    let frond = abs(fract(x) - 0.5) < 0.06 && hash(vec2f(floor(x), 1.0)) > 0.6;
    let tall = uv.y > floor_y - 0.25 * hash(vec2f(floor(x), 2.0));
    if (frond && tall) {
      col = vec3f(0.15, 0.5, 0.25);
    }
  }
  return col;
}

@fragment
fn paint_fs(in: Cover) -> @location(0) vec4f {
  // a picture is painted in a 4 : 3 frame whatever the board's shape, and the board shows the middle
  // of it, so it is never squashed; a board a little wider than 4 : 3 loses a little top and bottom
  let aspect = u.paint.y;
  var uv = in.uv;
  if (aspect > 4.0 / 3.0) {
    uv.y = 0.5 + (uv.y - 0.5) * (4.0 / 3.0) / aspect;
  } else {
    uv.x = 0.5 + (uv.x - 0.5) * aspect / (4.0 / 3.0);
  }
  let id = u32(u.paint.x);
  var col: vec3f;
  switch id {
    case 0u: { col = hills(uv); }
    case 1u: { col = quilt(uv); }
    case 2u: { col = garden(uv); }
    case 3u: { col = city(uv); }
    case 4u: { col = marbled(uv); }
    default: { col = reef(uv); }
  }
  return vec4f(clamp(col, vec3f(0.0), vec3f(1.0)), 1.0);
}
