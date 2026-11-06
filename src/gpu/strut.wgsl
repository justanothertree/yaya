// Strut's painting. The floor the creature walks over is a sheet of watercolour paper, kept in a
// float texture in world space. Every note a muscle plays lays a wet blot of pigment where the
// muscle is, coloured by its pitch, and every footfall a stamp. Each frame the paper BLEEDS: where
// it is still wet, pigment spreads to its neighbours and the wetness dries a little — so a note
// blooms for a second or two and then stays. Two textures take turns. Then the picture: the paper
// through the camera, the finish line, and the creature over it.

struct Paint {
  size: vec2u,
  ink: vec2u,
  origin: vec2f,
  cam: vec2f,
  ppm: f32,
  scale: f32,
  splats: u32,
  bones: u32,
  joints: u32,
  finish: f32,
  time: f32,
}

@group(0) @binding(0) var<uniform> P: Paint;
@group(0) @binding(1) var<storage, read> splats: array<vec4f>;
@group(0) @binding(2) var paper: texture_2d<f32>;
@group(0) @binding(3) var<storage, read> bones: array<vec4f>;
@group(0) @binding(4) var<storage, read> joints: array<vec4f>;
@group(0) @binding(5) var lin: sampler;

const DRY = 0.985;

@vertex
fn cover(@builtin(vertex_index) v: u32) -> @builtin(position) vec4f {
  let p = array(vec2f(-1, -3), vec2f(3, 1), vec2f(-1, 1))[v];
  return vec4f(p, 0, 1);
}

// ---------------------------------------------------------------- laying paint

struct Blot {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) @interpolate(flat) pigment: vec4f,
}

/** a blot, drawn into the paper: world to paper pixels, y up */
@vertex
fn blot_vs(@builtin(vertex_index) v: u32) -> Blot {
  let i = v / 6u;
  let a = splats[i * 2u];
  let corner = array(vec2f(-1, -1), vec2f(1, -1), vec2f(-1, 1), vec2f(-1, 1), vec2f(1, -1), vec2f(1, 1))[v % 6u];
  let world = a.xy + corner * a.z;
  let px = (world - P.origin) * P.ppm;
  let ink = vec2f(P.ink);
  var o: Blot;
  o.pos = vec4f(px.x / ink.x * 2.0 - 1.0, px.y / ink.y * 2.0 - 1.0, 0, 1);
  o.uv = corner;
  o.pigment = splats[i * 2u + 1u];
  return o;
}

@fragment
fn blot_fs(i: Blot) -> @location(0) vec4f {
  let r = dot(i.uv, i.uv);
  if (r > 1.0) {
    discard;
  }
  // a soft-edged blot with a darker rim, as a drop of watercolour dries to its edge
  let body = (1.0 - r) * 0.5 + smoothstep(0.6, 0.95, r) * smoothstep(1.0, 0.95, r) * 0.6;
  return vec4f(i.pigment.rgb * body * 0.7, i.pigment.a * (1.0 - r));
}

/** the bleed: wet paper shares its pigment with its neighbours, and dries */
@fragment
fn bleed(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let c = vec2i(pos.xy);
  let hi = vec2i(P.ink) - 1;
  let here = textureLoad(paper, c, 0);
  var sum = vec4f(0);
  var wet = 0.0;
  for (var k = 0; k < 4; k++) {
    let o = array(vec2i(1, 0), vec2i(-1, 0), vec2i(0, 1), vec2i(0, -1))[k];
    let n = textureLoad(paper, clamp(c + o, vec2i(0), hi), 0);
    sum += n;
    wet += n.a;
  }
  // pigment flows only where both this pixel and its neighbours are wet
  let flow = clamp(here.a, 0.0, 1.0) * clamp(wet * 0.25, 0.0, 1.0) * 0.2;
  let rgb = mix(here.rgb, sum.rgb * 0.25, flow);
  let a = max(here.a, wet * 0.25 * 0.9) * DRY;
  return vec4f(rgb, a);
}

// ---------------------------------------------------------------- the picture

fn hash(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.547);
}

/** the paper, coloured by what has been laid on it */
fn sheet(world: vec2f) -> vec3f {
  let px = (world - P.origin) * P.ppm;
  let ink = vec2f(P.ink);
  var absorb = vec3f(0);
  if (px.x >= 0.0 && px.y >= 0.0 && px.x < ink.x && px.y < ink.y) {
    // the paper is stored y-up from its own origin; textures are y-down, so flip — and read it
    // between its pixels, since the camera shows it larger than it was painted
    absorb = textureSampleLevel(paper, lin, vec2f(px.x, ink.y - px.y) / ink, 0.0).rgb;
  }
  let grain = 0.97 + 0.03 * hash(floor(world * 200.0));
  return vec3f(0.98, 0.96, 0.9) * grain * exp(-absorb * 2.2);
}

@fragment
fn develop(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  // the whole painting, for keeping: a pixel of the picture is a pixel of the paper
  let ink = vec2f(P.ink);
  let world = P.origin + vec2f(pos.x, ink.y - pos.y) / P.ppm;
  return vec4f(sheet(world), 1);
}

@fragment
fn show(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let size = vec2f(P.size);
  let p = P.cam + vec2f(pos.x - size.x * 0.5, size.y * 0.5 - pos.y) / P.scale;
  let px = 1.0 / P.scale;
  var c = sheet(p);
  // the floor line, the bar marks under it, and the finish
  if (p.y < 0.0) {
    c = mix(c, vec3f(0.55, 0.5, 0.45), 0.25);
    let m = abs(fract(p.x + 0.5) - 0.5);
    if (m < px && p.y > -0.12) {
      c *= 0.7;
    }
  }
  c = mix(c, vec3f(0.3, 0.28, 0.25), smoothstep(px * 1.5, 0.0, abs(p.y)) * 0.8);
  if (abs(p.x - P.finish) < px * 2.0 && p.y > 0.0 && p.y < 2.5) {
    let chk = (u32(floor(p.y * 6.0)) % 2u) == 0u;
    c = select(vec3f(0.95), vec3f(0.1), chk);
  }
  return vec4f(c, 1);
}

struct Stroke {
  @builtin(position) pos: vec4f,
  @location(0) local: vec2f,
  @location(1) @interpolate(flat) half: vec2f,
  @location(2) @interpolate(flat) colour: vec3f,
}

fn to_screen(p: vec2f) -> vec4f {
  let size = vec2f(P.size);
  let s = (p - P.cam) * P.scale;
  return vec4f(s.x / size.x * 2.0, s.y / size.y * 2.0, 0, 1);
}

/** a bone: a capsule; a muscle drawn in its note's colour (bones[i].w is its hue, or −1) */
@vertex
fn bone_vs(@builtin(vertex_index) v: u32, @builtin(instance_index) n: u32) -> Stroke {
  let b = bones[n];
  let a = joints[u32(b.x)].xy;
  let z = joints[u32(b.y)].xy;
  let muscle = b.w >= 0.0;
  let r = select(0.035, 0.055, muscle);
  let dir = normalize(z - a + vec2f(1e-6, 0));
  let side = vec2f(-dir.y, dir.x);
  let len = length(z - a);
  let corner = array(vec2f(0, -1), vec2f(1, -1), vec2f(0, 1), vec2f(0, 1), vec2f(1, -1), vec2f(1, 1))[v];
  let along = mix(-r, len + r, corner.x);
  var o: Stroke;
  o.pos = to_screen(a + dir * along + side * corner.y * r);
  o.local = vec2f(along, corner.y * r);
  o.half = vec2f(len, r);
  // a muscle's colour is its note's, brighter while it pulls (joints[i].z of its first end holds
  // nothing; the pull is passed in bones[i].z as the muscle's current squeeze 0..1)
  let hue = b.w;
  let k = (vec3f(5.0, 3.0, 1.0) + hue * 6.0) % vec3f(6.0);
  let rgb = 1.0 - max(vec3f(0), min(min(k, 4.0 - k), vec3f(1)));
  o.colour = select(vec3f(0.3, 0.3, 0.34), mix(rgb * 0.6, rgb, b.z), muscle);
  return o;
}

@fragment
fn bone_fs(i: Stroke) -> @location(0) vec4f {
  let q = vec2f(i.local.x - clamp(i.local.x, 0.0, i.half.x), i.local.y);
  if (length(q) > i.half.y) {
    discard;
  }
  return vec4f(i.colour, 1);
}

@vertex
fn joint_vs(@builtin(vertex_index) v: u32, @builtin(instance_index) n: u32) -> Stroke {
  let p = joints[n].xy;
  let r = 0.065;
  let corner = array(vec2f(-1, -1), vec2f(1, -1), vec2f(-1, 1), vec2f(-1, 1), vec2f(1, -1), vec2f(1, 1))[v];
  var o: Stroke;
  o.pos = to_screen(p + corner * r);
  o.local = corner * r;
  o.half = vec2f(0, r);
  o.colour = vec3f(0.12, 0.12, 0.16);
  return o;
}

@fragment
fn joint_fs(i: Stroke) -> @location(0) vec4f {
  if (length(i.local) > i.half.y) {
    discard;
  }
  return vec4f(i.colour, 1);
}
