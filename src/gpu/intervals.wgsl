// The Lab's ear trainer. One fullscreen pass draws the pitch spiral: every semitone from C3 to G5
// along a spiral that turns once an octave, so an octave is the same angle one ring further out and
// a fifth is seven steps round. Before the answer the notes are only ripples from the centre — the
// picture must not give the answer away. After it, the two notes appear on the spiral and the arc
// between them lights: green if it was named right, amber if not.

struct U {
  // canvas size; time; 1 once answered
  view: vec4f,
  // first note, second note (semitones above C3); seconds since each sounded
  notes: vec4f,
  // 1 right, 2 wrong, 0 not yet; unused
  look: vec4f,
}

@group(0) @binding(0) var<uniform> u: U;

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

const SPAN = 31.0; // C3 to G5
const TAU = 6.2831853;

fn radius(p: f32) -> f32 {
  return 0.3 + 0.7 * p / SPAN;
}
fn point(p: f32, c: vec2f, R: f32) -> vec2f {
  let a = p / 12.0 * TAU;
  return c + vec2f(sin(a), -cos(a)) * radius(p) * R;
}

@fragment
fn spiral(in: Cover) -> @location(0) vec4f {
  let size = u.view.xy;
  let t = u.view.z;
  let answered = u.view.w > 0.5;
  let c = size * 0.5;
  let R = min(size.x, size.y) * 0.46;
  let v = in.pos.xy - c;
  let r = length(v) / R;
  var theta = atan2(v.x, -v.y);
  if (theta < 0.0) {
    theta += TAU;
  }
  let s = theta / TAU * 12.0;
  var col = vec3f(0.035, 0.04, 0.07) + 0.04 * vec3f(0.3, 0.4, 0.9) * (1.0 - r);

  // the spiral: the nearest of its turns to this pixel, and where along it that is
  var d = 1e9;
  var p_here = 0.0;
  for (var n = 0; n < 3; n++) {
    let p = s + 12.0 * f32(n);
    if (p > SPAN + 0.5) {
      continue;
    }
    let dd = abs(r - radius(p)) * R;
    if (dd < d) {
      d = dd;
      p_here = p;
    }
  }
  col += vec3f(0.22, 0.26, 0.4) * clamp(1.2 - d, 0.0, 1.0);
  // a tick at every semitone, brighter at each C
  let tick = abs(p_here - round(p_here)) * TAU / 12.0 * radius(p_here) * R;
  if (d < 5.0 && tick < 1.2) {
    let isC = (i32(round(p_here)) % 12) == 0;
    col += select(vec3f(0.18), vec3f(0.5, 0.55, 0.8), isC) * clamp(5.0 - d, 0.0, 1.0) / 5.0;
  }

  // before the answer: each note a ripple from the centre, nothing on the spiral
  for (var k = 0; k < 2; k++) {
    let since = select(u.notes.z, u.notes.w, k == 1);
    if (since >= 0.0 && since < 1.6) {
      let ring = abs(length(v) - since * R * 0.9) ;
      col += vec3f(0.35, 0.5, 1.0) * clamp(2.0 - ring * 0.5, 0.0, 1.0) * (1.0 - since / 1.6) * 0.8;
    }
  }

  if (answered) {
    let lo = min(u.notes.x, u.notes.y);
    let hi = max(u.notes.x, u.notes.y);
    let tone = select(vec3f(1.0, 0.7, 0.2), vec3f(0.3, 0.95, 0.55), u.look.x < 1.5);
    // the arc between the two notes, along the spiral
    if (p_here >= lo && p_here <= hi) {
      col = mix(col, tone, clamp(3.0 - d, 0.0, 1.0));
      col += tone * exp(-d / 6.0) * 0.25;
    }
    // the two notes, as dots that pulse when they sound
    for (var k = 0; k < 2; k++) {
      let p = select(u.notes.x, u.notes.y, k == 1);
      let since = select(u.notes.z, u.notes.w, k == 1);
      let pulse = select(0.0, exp(-since * 3.0), since >= 0.0);
      let dd = length(in.pos.xy - point(p, c, R));
      let rr = R * 0.035 * (1.0 + 0.5 * pulse);
      col = mix(col, vec3f(1.0), clamp(rr - dd, 0.0, 1.0));
      col += tone * exp(-dd / (rr * 1.5)) * 0.5;
    }
  }
  return vec4f(col, 1.0);
}
