// Music visual: the site's live audio, as bands and a waveform, drawn into a feedback trail.
//
// Every frame `trail` draws the new shape on top of the previous frame, which it samples a little
// rotated and a little zoomed and a little darker — so what was drawn a moment ago drifts off and
// fades, and a beat leaves a wake. `show` puts the trail on screen.
//
// ⚠️ `Music` IS PACKED BY HAND IN music.ts (`MUSIC`); music.test.ts lays it out from this source.

struct Music {
  aspect: f32,
  spin: f32, // radians the trail turns per frame
  zoom: f32, // how much the trail grows per frame; 1 is still
  decay: f32, // how much of the trail survives a frame
  time: f32,
  level: f32, // overall loudness, 0..1
  mode: u32, // 0 bars, 1 ring
  bands: u32, // how many bands precede the waveform in `data`
  wave: u32, // how many waveform samples follow them
}

@group(0) @binding(0) var<uniform> M: Music;
@group(0) @binding(1) var lin: sampler;
@group(0) @binding(2) var prev: texture_2d<f32>;
// bands (0..1 each), then the waveform (-1..1)
@group(0) @binding(3) var<storage, read> data: array<f32>;

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

// linear between neighbouring bands, so a wide screen does not look like a staircase
fn band(x: f32) -> f32 {
  let f = clamp(x, 0.0, 1.0) * f32(M.bands - 1u);
  let i = u32(floor(f));
  let j = min(i + 1u, M.bands - 1u);
  return mix(data[i], data[j], fract(f));
}

fn wave(x: f32) -> f32 {
  let f = clamp(x, 0.0, 1.0) * f32(M.wave - 1u);
  let i = u32(floor(f));
  let j = min(i + 1u, M.wave - 1u);
  return mix(data[M.bands + i], data[M.bands + j], fract(f));
}

// a hue wheel, for colouring by pitch: low notes warm, high notes cool, drifting with time
fn tint(h: f32) -> vec3f {
  return 0.55 + 0.45 * cos(6.2831853 * (h + vec3f(0.0, 0.33, 0.67)));
}

// The new frame's shape, in a centred space: y runs -0.5..0.5 and x as far as the aspect allows.
fn shape(c: vec2f) -> vec3f {
  if (M.mode == 0u) {
    // bars from the middle line, mirrored up and down; bass in the centre, treble at the edges
    let half = 0.5 * M.aspect;
    let x = abs(c.x) / half;
    let h = band(x) * 0.42;
    let inside = smoothstep(h + 0.004, h - 0.004, abs(c.y));
    // a gap between bars, so they read as bars
    let k = 64.0;
    let gap = smoothstep(0.0, 0.12, abs(fract(x * k) - 0.5) - 0.08);
    let line = exp(-abs(c.y - wave(c.x / M.aspect + 0.5) * 0.18) * 260.0);
    return tint(x * 0.6 + M.time * 0.03) * inside * gap * 0.9 + vec3f(0.8, 0.9, 1.0) * line * 0.6;
  }
  // ring: the spectrum as petals around a circle, the waveform as a wobbling inner ring
  let r = length(c);
  let a = atan2(c.y, c.x) / 6.2831853 + 0.5; // 0..1 around
  let mirrored = abs(a * 2.0 - 1.0); // bass at the top, symmetric left and right
  let r0 = 0.16 + 0.04 * M.level;
  let petal = r0 + band(mirrored) * 0.24;
  let fill = smoothstep(petal + 0.006, petal - 0.006, r) * smoothstep(r0 - 0.006, r0 + 0.006, r);
  let inner = exp(-abs(r - (r0 * 0.7 + wave(a) * 0.05)) * 300.0);
  return tint(mirrored * 0.7 + M.time * 0.03) * fill * 0.85 + vec3f(1.0, 0.95, 0.85) * inner * 0.7;
}

@fragment
fn trail(p: Px) -> @location(0) vec4f {
  // the previous frame, turned and grown about the centre — sampled from where this pixel was
  var c = p.uv - 0.5;
  c.x *= M.aspect;
  let s = sin(-M.spin);
  let k = cos(-M.spin);
  var back = vec2f(c.x * k - c.y * s, c.x * s + c.y * k) / M.zoom;
  back.x /= M.aspect;
  let old = textureSampleLevel(prev, lin, back + 0.5, 0.0).rgb * M.decay;
  return vec4f(max(old, shape(c)), 1.0);
}

@fragment
fn show(p: Px) -> @location(0) vec4f {
  let c = textureSampleLevel(prev, lin, p.uv, 0.0).rgb;
  let bg = vec3f(0.02, 0.02, 0.05);
  return vec4f(bg + c * (1.0 - bg), 1.0);
}
