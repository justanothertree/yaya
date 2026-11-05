// A photo sorted pixel by pixel, a stage of a sorting network at a time. See pixelsort.ts for why
// the keys carry their spans and why the network runs in stages.
//
// ⚠️ `Sort` IS PACKED BY HAND IN pixelsort.ts (`SORT`); pixelsort.test.ts lays it out from here.

struct Sort {
  size: vec2u, // the canvas, in pixels
  image: vec2u, // the photo, in pixels
  line_len: u32, // keys a line holds: LINE
  lines: u32, // how many lines are being sorted
  axis: u32, // 0: along rows, 1: down columns
  flip: u32, // 1: the other way along them
  lo: f32, // a pixel joins a span when its measure is in lo..hi
  hi: f32,
  by: u32, // 0 brightness, 1 hue, 2 warmth
  dabs: u32, // how many brush dabs this frame
  show: u32, // 1: draw the sort in progress (pixel i shows its key's pixel); 0: the photo as it is
}

@group(0) @binding(0) var<uniform> S: Sort;

const IDX_BITS = 10u;
const KEY_BITS = 10u;
const PAD = 0xffffffffu;
const LINE = 1024u;

fn line_length() -> u32 {
  return select(S.image.x, S.image.y, S.axis == 1u);
}

// the pixel at place `pos` along line `line`
fn pixel_of(line: u32, pos: u32) -> vec2u {
  let len = line_length();
  let p = select(pos, len - 1u - pos, S.flip == 1u);
  return select(vec2u(p, line), vec2u(line, p), S.axis == 1u);
}

// and the other way: which line a pixel is on, and where along it
fn place_of(px: vec2u) -> vec2u {
  let len = line_length();
  var line = px.y;
  var pos = px.x;
  if (S.axis == 1u) {
    line = px.x;
    pos = px.y;
  }
  return vec2u(line, select(pos, len - 1u - pos, S.flip == 1u));
}

// mirrored in pixelsort.ts (`measure`)
fn measure(c: vec3f) -> f32 {
  if (S.by == 0u) {
    return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  }
  if (S.by == 2u) {
    return clamp(0.5 + (c.r - c.b) * 0.5, 0.0, 1.0);
  }
  let mx = max(c.r, max(c.g, c.b));
  let mn = min(c.r, min(c.g, c.b));
  if (mx == mn) {
    return 0.0;
  }
  let d = mx - mn;
  var h = 0.0;
  if (mx == c.r) {
    h = (c.g - c.b) / d + select(0.0, 6.0, c.g < c.b);
  } else if (mx == c.g) {
    h = (c.b - c.r) / d + 2.0;
  } else {
    h = (c.r - c.g) / d + 4.0;
  }
  return h / 6.0;
}

fn level(m: f32) -> u32 {
  return u32(clamp(floor(m * 1024.0), 0.0, 1023.0));
}

@group(0) @binding(1) var photo: texture_2d<f32>;
@group(0) @binding(2) var<storage, read_write> mask: array<u32>;
@group(0) @binding(3) var<storage, read_write> keys: array<u32>;
@group(0) @binding(4) var<storage, read> dab: array<vec4f>; // x, y (photo pixels), radius
@group(0) @binding(5) var baked: texture_storage_2d<rgba8unorm, write>;

// the brush: everything within a dab of the stroke is to be sorted
@compute @workgroup_size(8, 8)
fn paint(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= S.image.x || id.y >= S.image.y) {
    return;
  }
  let p = vec2f(id.xy) + 0.5;
  for (var k = 0u; k < S.dabs; k++) {
    let d = dab[k];
    if (distance(p, d.xy) <= d.z) {
      mask[id.y * S.image.x + id.x] = 1u;
    }
  }
}

fn joins(line: u32, pos: u32) -> bool {
  let px = pixel_of(line, pos);
  let m = measure(textureLoad(photo, px, 0).rgb);
  return mask[px.y * S.image.x + px.x] == 1u && m >= S.lo && m <= S.hi;
}

var<workgroup> starts: array<u32, 1024>;
var<workgroup> partial: array<u32, 256>;

// one line's keys: span · 2²⁰ + level · 2¹⁰ + place. The span of each pixel is how many spans
// began before it — a prefix sum of "a span starts here", taken in the workgroup's memory
@compute @workgroup_size(256)
fn build(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_index) t: u32) {
  let line = wg.x;
  let len = line_length();
  // four places per thread: does a new span begin at each?
  var mine = 0u;
  for (var k = 0u; k < 4u; k++) {
    let pos = t * 4u + k;
    var begins = 0u;
    if (pos > 0u && pos < len) {
      begins = select(1u, 0u, joins(line, pos) && joins(line, pos - 1u));
    }
    starts[pos] = begins;
    mine += begins;
  }
  partial[t] = mine;
  workgroupBarrier();
  // Hillis–Steele over the 256 threads' totals: afterwards partial[t] counts up to and including t
  for (var off = 1u; off < 256u; off *= 2u) {
    var add = 0u;
    if (t >= off) {
      add = partial[t - off];
    }
    workgroupBarrier();
    partial[t] += add;
    workgroupBarrier();
  }
  var span = select(0u, partial[t - 1u], t > 0u);
  for (var k = 0u; k < 4u; k++) {
    let pos = t * 4u + k;
    span += starts[pos];
    var key = PAD;
    if (pos < len) {
      let px = pixel_of(line, pos);
      let lv = level(measure(textureLoad(photo, px, 0).rgb));
      key = (span << (KEY_BITS + IDX_BITS)) | (lv << IDX_BITS) | pos;
    }
    keys[line * LINE + pos] = key;
  }
}

// one stage of the bitonic network, for every line at once — the k and j come from a small
// uniform of their own, one slot per stage, chosen with a dynamic offset
@group(1) @binding(0) var<uniform> stage: vec4u;

@compute @workgroup_size(256)
fn swap(@builtin(global_invocation_id) id: vec3u) {
  let line = id.x / LINE;
  let i = id.x % LINE;
  if (line >= S.lines) {
    return;
  }
  let k = stage.x;
  let j = stage.y;
  // the first stage of each merge compares mirrored pairs, so every block ends up sorted the same
  // way round (pixelsort.ts says why)
  let p = select(i ^ j, i ^ (k - 1u), j == k / 2u);
  if (p <= i) {
    return;
  }
  let a = keys[line * LINE + i];
  let b = keys[line * LINE + p];
  if (a > b) {
    keys[line * LINE + i] = b;
    keys[line * LINE + p] = a;
  }
}

// where the pixel shown at px comes from, as the keys stand
fn source_of(px: vec2u) -> vec2u {
  let at = place_of(px);
  let key = keys[at.x * LINE + at.y];
  if (key == PAD) {
    return px;
  }
  return pixel_of(at.x, key & ((1u << IDX_BITS) - 1u));
}

// the sort finished: the picture it made becomes the photo, and the brush is put away
@compute @workgroup_size(8, 8)
fn bake(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= S.image.x || id.y >= S.image.y) {
    return;
  }
  textureStore(baked, id.xy, textureLoad(photo, source_of(id.xy), 0));
  mask[id.y * S.image.x + id.x] = 0u;
}

// ---- drawing

struct Px {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn cover(@builtin(vertex_index) v: u32) -> Px {
  let p = vec2f(f32((v << 1u) & 2u), f32(v & 2u));
  var o: Px;
  o.clip = vec4f(p * 2.0 - 1.0, 0.0, 1.0);
  o.uv = vec2f(p.x, 1.0 - p.y);
  return o;
}

@group(0) @binding(6) var<storage, read> shown_keys: array<u32>;
@group(0) @binding(7) var<storage, read> shown_mask: array<u32>;

@fragment
fn show(px: Px) -> @location(0) vec4f {
  // the photo fitted into the canvas, the rest dark
  let canvas = vec2f(S.size);
  let img = vec2f(S.image);
  let scale = min(canvas.x / img.x, canvas.y / img.y);
  let offset = (canvas - img * scale) * 0.5;
  let p = (px.uv * canvas - offset) / scale;
  if (p.x < 0.0 || p.y < 0.0 || p.x >= img.x || p.y >= img.y) {
    return vec4f(0.04, 0.04, 0.06, 1.0);
  }
  var at = vec2u(p);
  if (S.show == 1u) {
    let place = place_of(at);
    let key = shown_keys[place.x * LINE + place.y];
    if (key != PAD) {
      at = pixel_of(place.x, key & ((1u << IDX_BITS) - 1u));
    }
  }
  var c = textureLoad(photo, at, 0).rgb;
  // the stroke waiting to be sorted, lightly marked
  if (S.show == 0u && shown_mask[u32(p.y) * S.image.x + u32(p.x)] == 1u) {
    c = mix(c, vec3f(1.0, 0.35, 0.75), 0.28);
  }
  return vec4f(c, 1.0);
}
