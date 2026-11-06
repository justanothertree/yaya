// A picture of sound: a column written by a Fourier transform of the microphone, painted on, and
// played back by summing a sine for every row. See voiceprint.ts.
//
// ⚠️ `Print` IS PACKED BY HAND IN voiceprint.ts (`PRINT`); voiceprint.test.ts lays it out from here.

struct Print {
  size: vec2u, // the canvas, in pixels
  columns: u32,
  rows: u32,
  head: u32, // the column being written
  rate: f32, // samples a second
  per_column: u32, // samples a column of the picture lasts
  first: u32, // the first sample this `play` writes
  dabs: u32,
  playing: u32,
  playhead: f32, // where playback is, in columns
}

@group(0) @binding(0) var<uniform> P: Print;
@group(0) @binding(1) var<storage, read_write> print: array<f32>; // columns × rows

const PI = 3.14159265;
const FFT = 1024u;
const LOW = 80.0;
const HIGH = 8000.0;

fn row_hz(r: u32) -> f32 {
  return LOW * pow(HIGH / LOW, f32(r) / f32(P.rows - 1u));
}

// ---- listening: one column from the newest FFT samples

@group(0) @binding(2) var<storage, read> wave: array<f32>;
var<workgroup> re: array<f32, 1024>;
var<workgroup> im: array<f32, 1024>;

@compute @workgroup_size(256)
fn column(@builtin(local_invocation_index) t: u32) {
  // each thread windows four samples and puts each where its bits, reversed, say
  for (var k = 0u; k < 4u; k++) {
    let i = t * 4u + k;
    let w = 0.5 - 0.5 * cos(2.0 * PI * f32(i) / f32(FFT - 1u));
    let j = reverseBits(i) >> 22u;
    re[j] = wave[i] * w;
    im[j] = 0.0;
  }
  workgroupBarrier();
  // ten stages of butterflies, 512 to a stage, two to a thread — voiceprint.ts `fft`
  for (var len = 2u; len <= FFT; len *= 2u) {
    let half = len / 2u;
    for (var k = 0u; k < 2u; k++) {
      let b = t * 2u + k;
      let i = (b / half) * len + b % half;
      let j = i + half;
      let a = -2.0 * PI * f32(b % half) / f32(len);
      let wr = cos(a);
      let wi = sin(a);
      let tr = re[j] * wr - im[j] * wi;
      let ti = re[j] * wi + im[j] * wr;
      let ur = re[i];
      let ui = im[i];
      re[j] = ur - tr;
      im[j] = ui - ti;
      re[i] = ur + tr;
      im[i] = ui + ti;
    }
    workgroupBarrier();
  }
  // one row a thread: the spectrum read at the row's pitch — voiceprint.ts `loudnessAt`
  let r = t;
  let bin = row_hz(r) * f32(FFT) / P.rate;
  let b0 = min(FFT / 2u - 1u, u32(floor(bin)));
  let f = min(1.0, bin - f32(b0));
  let m0 = length(vec2f(re[b0], im[b0]));
  let m1 = length(vec2f(re[b0 + 1u], im[b0 + 1u]));
  print[P.head * P.rows + r] = sqrt((m0 * (1.0 - f) + m1 * f) / f32(FFT / 4u));
}

// ---- painting

@group(0) @binding(3) var<storage, read> dab: array<vec4f>; // column, row, strength (< 0 erases), radius

@compute @workgroup_size(16, 16)
fn brush(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= P.columns || id.y >= P.rows) {
    return;
  }
  let i = id.x * P.rows + id.y;
  var v = print[i];
  for (var k = 0u; k < P.dabs; k++) {
    let d = dab[k];
    let gap = vec2f(f32(id.x), f32(id.y)) - d.xy;
    let w = exp(-dot(gap, gap) / (d.w * d.w));
    if (d.z >= 0.0) {
      v = max(v, d.z * w);
    } else {
      v *= 1.0 - w * 0.8;
    }
  }
  print[i] = v;
}

// ---- playing: a sine for every row, summed — voiceprint.ts `synth`

@group(0) @binding(4) var<storage, read_write> sound: array<f32>;
// each row's pitch in turns a sample, worked out once on the CPU in full precision — ⚠️ not with
// `row_hz` here: WGSL holds pow only loosely, and a pitch a millionth out drifts a whole sample's
// worth of phase off by the end of the picture (and it was a pow per row per sample, 10⁸ a play)
@group(0) @binding(6) var<storage, read> pitch: array<f32>;

@compute @workgroup_size(64)
fn play(@builtin(global_invocation_id) id: vec3u) {
  let s = P.first + id.x;
  if (id.x >= arrayLength(&sound)) {
    return;
  }
  let at = f32(s) / f32(P.per_column);
  // ⚠️ the phase is pitch × time, which runs to tens of thousands of turns by the end of the picture,
  // where an f32 can only tell turns apart to a hundredth — so the sample number is split, and every
  // product kept small: (hi·4096 + lo)·f = fract(fract(4096·f)·hi) + fract(lo·f), f in turns a sample
  let hi = f32(s / 4096u);
  let lo = f32(s % 4096u);
  let c0 = min(P.columns - 1u, u32(floor(at)));
  let c1 = min(P.columns - 1u, c0 + 1u);
  let f = at - floor(at);
  var sum = 0.0;
  for (var r = 0u; r < P.rows; r++) {
    let a = print[c0 * P.rows + r] * (1.0 - f) + print[c1 * P.rows + r] * f;
    if (a > 0.003) {
      // the phase belongs to the time alone, so no sine ever jumps from one column to the next
      let f = pitch[r];
      let turns = fract(fract(f * 4096.0) * hi) + fract(f * lo);
      // and read on −π..π, the only range WGSL holds sin to its precision on: sin(x) = −sin(x − π)
      sum -= a * a * sin(2.0 * PI * (fract(turns) - 0.5));
    }
  }
  sound[id.x] = sum;
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

@group(0) @binding(5) var<storage, read> shown: array<f32>;

// dark blue through violet and orange to a pale gold: quiet to loud
fn heat(x: f32) -> vec3f {
  let a = vec3f(0.02, 0.02, 0.08);
  let b = vec3f(0.35, 0.08, 0.5);
  let c = vec3f(0.95, 0.4, 0.2);
  let d = vec3f(1.0, 0.95, 0.7);
  if (x < 0.33) {
    return mix(a, b, x / 0.33);
  }
  if (x < 0.66) {
    return mix(b, c, (x - 0.33) / 0.33);
  }
  return mix(c, d, clamp((x - 0.66) / 0.34, 0.0, 1.0));
}

@fragment
fn show(px: Px) -> @location(0) vec4f {
  let cf = px.uv.x * f32(P.columns);
  let rf = (1.0 - px.uv.y) * f32(P.rows - 1u);
  let c = min(P.columns - 1u, u32(cf));
  let r0 = u32(floor(rf));
  let r1 = min(P.rows - 1u, r0 + 1u);
  let v = mix(shown[c * P.rows + r0], shown[c * P.rows + r1], fract(rf));
  var col = heat(clamp(v, 0.0, 1.0));
  // octave lines, faintly: every doubling from 110 Hz
  let octave = log2(LOW * pow(HIGH / LOW, rf / f32(P.rows - 1u)) / 110.0);
  let line = 1.0 - smoothstep(0.0, 0.02, abs(fract(octave + 0.5) - 0.5));
  col += vec3f(0.05) * line;
  // the column being written, and the playhead
  let px_per_col = f32(P.size.x) / f32(P.columns);
  if (P.playing == 0u && abs(cf - (f32(P.head) + 0.5)) * px_per_col < 1.0) {
    col = mix(col, vec3f(0.5, 0.9, 1.0), 0.7);
  }
  if (P.playing == 1u && abs(cf - P.playhead) * px_per_col < 1.5) {
    col = vec3f(1.0, 1.0, 1.0);
  }
  return vec4f(col, 1.0);
}
