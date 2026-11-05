// Soap bubbles: a soft background, then every bubble as a quad whose fragment shader works out the
// sphere's surface and colours it by THIN-FILM INTERFERENCE — the film's thickness decides, per
// wavelength, whether its two reflections strengthen or cancel. See bubbles.ts.
//
// ⚠️ `Bubbles` IS PACKED BY HAND IN bubbles.ts (`BUBBLES`), and `film_colour` mirrors
// `filmColour` there; bubbles.test.ts and the probe hold them together.

struct Bubbles {
  size: vec2u, // the canvas, in pixels
  count: u32,
  time: f32,
}

@group(0) @binding(0) var<uniform> B: Bubbles;
// each bubble: [2i] x, y, radius, seed · [2i + 1] film (nm), popping, held, -
@group(0) @binding(1) var<storage, read> bubbles: array<vec4f>;

const PI = 3.14159265;
const FILM_N = 1.33;

// mirrors `filmColour` in bubbles.ts: sin²(2π·n·d·cosθt / λ) for red, green and blue
fn film_colour(thickness: f32, cos_in: f32) -> vec3f {
  let sin_in2 = 1.0 - cos_in * cos_in;
  let cos_t = sqrt(max(0.0, 1.0 - sin_in2 / (FILM_N * FILM_N)));
  let phase = 2.0 * PI * FILM_N * thickness * cos_t / vec3f(650.0, 532.0, 450.0);
  let s = sin(phase);
  return s * s;
}

struct Back {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn cover(@builtin(vertex_index) v: u32) -> Back {
  let p = vec2f(f32((v << 1u) & 2u), f32(v & 2u));
  var o: Back;
  o.clip = vec4f(p * 2.0 - 1.0, 0.0, 1.0);
  o.uv = vec2f(p.x, 1.0 - p.y);
  return o;
}

@fragment
fn backdrop(px: Back) -> @location(0) vec4f {
  // a soft garden at dusk, out of focus: a gradient and a few blurred lights drifting
  var c = mix(vec3f(0.08, 0.16, 0.2), vec3f(0.02, 0.04, 0.07), px.uv.y);
  let p = px.clip.xy / f32(B.size.y);
  for (var k = 0; k < 7; k++) {
    let f = f32(k);
    let at = vec2f(fract(f * 0.37 + B.time * 0.01 * (1.0 + f * 0.1)) * f32(B.size.x) / f32(B.size.y), fract(f * 0.61 + 0.2));
    let d = distance(p, at);
    c += vec3f(0.5 + 0.4 * sin(f), 0.45, 0.35 + 0.3 * cos(f * 1.7)) * 0.12 * smoothstep(0.18, 0.0, d);
  }
  return vec4f(c, 1.0);
}

struct Px {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f, // -1..1 across the bubble's quad
  @location(1) @interpolate(flat) i: u32,
}

@vertex
fn bubble(@builtin(vertex_index) v: u32) -> Px {
  let i = v / 6u;
  let corner = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));
  let c = corner[v % 6u];
  let a = bubbles[2u * i];
  let popping = bubbles[2u * i + 1u].y;
  // a pop: the film tears and its edge flies outward a little as it goes
  let r = a.z * (1.0 + popping * 0.35);
  let p = a.xy + c * r;
  var o: Px;
  o.clip = vec4f(p.x / f32(B.size.x) * 2.0 - 1.0, 1.0 - p.y / f32(B.size.y) * 2.0, 0.0, 1.0);
  o.uv = c;
  o.i = i;
  return o;
}

fn noise(p: vec2f) -> f32 {
  return sin(p.x * 3.1 + sin(p.y * 2.3)) * sin(p.y * 2.7 + sin(p.x * 1.9));
}

@fragment
fn film(px: Px) -> @location(0) vec4f {
  let d = length(px.uv);
  if (d > 1.0) {
    discard;
  }
  let a = bubbles[2u * px.i];
  let b = bubbles[2u * px.i + 1u];
  let popping = b.y;
  let nz = sqrt(1.0 - d * d);
  let n = vec3f(px.uv.x, -px.uv.y, nz);
  // the film drains down, so it is thinnest at the top; and it swirls, never still
  let t = B.time * 0.35 + a.w;
  let swirl = noise(px.uv * 2.0 + vec2f(sin(t), cos(t * 0.8)) * 1.5);
  let thickness = b.x * (0.75 + 0.35 * (-px.uv.y * 0.5 + 0.5) + 0.18 * swirl);
  var colour = film_colour(max(thickness, 0.0), nz);
  // glancing light reflects more: the rim is brighter and less see-through than the middle
  let fresnel = 0.04 + 0.96 * pow(1.0 - nz, 5.0);
  let sun = normalize(vec3f(-0.5, 0.6, 0.65));
  let spec = pow(max(dot(reflect(-sun, n), vec3f(0.0, 0.0, 1.0)), 0.0), 60.0);
  // ⚠️ THE REFLECTION ADDS LIGHT; IT IS NOT SCALED BY HOW OPAQUE THE FILM IS. A soap film is
  // nearly clear but reflects vividly, and the first version multiplied its colour by its tiny
  // opacity: a reflection of 0.4 reached the screen as 0.05, and the bubbles were grey ghosts.
  // Premultiplied blending lets the colour exceed the alpha: `alpha` is only how much of what is
  // behind the film it takes away.
  var c = colour * (0.45 + 1.6 * fresnel) * 0.6 + vec3f(spec) * 0.9;
  var alpha = clamp(0.06 + fresnel * 0.5 + spec, 0.0, 1.0);
  if (popping > 0.0) {
    // tearing: holes open across the film and what is left fades
    let tear = noise(px.uv * 5.0 + vec2f(a.w * 13.0)) * 0.5 + 0.5;
    if (tear < popping * 1.4) {
      discard;
    }
    alpha *= 1.0 - popping;
  }
  if (popping > 0.0) {
    c *= 1.0 - popping;
  }
  return vec4f(c, alpha);
}
