// Fluid painting: Jos Stam's "stable fluids", one fragment pass per step, every field a half-float
// texture. Each pass draws one triangle over a target texture and reads its inputs through a
// linear sampler, which is what makes the semi-Lagrangian advection a single lookup.
//
// Conventions, because every sign below depends on them:
//   - uv runs 0..1 with y DOWN, matching texture rows; "up" on screen is uv.y - texel.y.
//   - velocity is stored in sim TEXELS per second. The sim grid's cells are square, so a texel is
//     the same distance across as down and the pressure solve can treat x and y alike.
//
// ⚠️ `Fluid` IS PACKED BY HAND IN fluid.ts (`FLUID`); fluid.test.ts lays it out from this source.

struct Fluid {
  texel: vec2f, // one sim (velocity/pressure) texel, in uv
  dye_texel: vec2f, // one dye texel, in uv
  point: vec2f, // the splat's centre, in uv
  force: vec2f, // velocity the splat adds, in sim texels per second
  color: vec4f, // the splat's colour (rgb) and how much of it covers what is there (a)
  aspect: f32, // width / height, so a splat is round on screen
  radius: f32, // the splat's size, as a fraction of the screen's height, squared
  dt: f32,
  swirl: f32, // vorticity confinement strength
  vel_decay: f32, // per second
  dye_decay: f32, // per second
}

@group(0) @binding(0) var<uniform> F: Fluid;
@group(0) @binding(1) var lin: sampler;
@group(0) @binding(2) var a: texture_2d<f32>;
@group(0) @binding(3) var b: texture_2d<f32>;

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

fn at(t: texture_2d<f32>, uv: vec2f) -> vec4f {
  return textureSampleLevel(t, lin, uv, 0.0);
}

// a soft round dab at F.point, 1 at its centre
fn dab(uv: vec2f) -> f32 {
  var d = uv - F.point;
  d.x *= F.aspect;
  return exp(-dot(d, d) / F.radius);
}

@fragment
fn splat_velocity(p: Px) -> @location(0) vec4f {
  return vec4f(at(a, p.uv).xy + F.force * dab(p.uv), 0.0, 1.0);
}

// ⚠️ MIXED IN, NOT ADDED. Adding is how light works and not how paint does: a circular stir through
// the rainbow summed every hue into one pale grey-white blob. Mixing toward the stroke's colour
// keeps it saturated and can never pass 1, so nothing clips however long you stir one spot.
@fragment
fn splat_dye(p: Px) -> @location(0) vec4f {
  let k = clamp(dab(p.uv) * F.color.a, 0.0, 1.0);
  return vec4f(mix(at(a, p.uv).rgb, F.color.rgb, k), 1.0);
}

// a: velocity. ω = ∂vy/∂x − ∂vx/∂y, by central differences.
@fragment
fn curl(p: Px) -> @location(0) vec4f {
  let t = F.texel;
  let l = at(a, p.uv - vec2f(t.x, 0.0)).y;
  let r = at(a, p.uv + vec2f(t.x, 0.0)).y;
  let u = at(a, p.uv - vec2f(0.0, t.y)).x;
  let d = at(a, p.uv + vec2f(0.0, t.y)).x;
  return vec4f(0.5 * ((r - l) - (d - u)), 0.0, 0.0, 1.0);
}

// a: velocity, b: curl. Vorticity confinement: push along N × ω, where N points up the slope of
// |ω|, which feeds small eddies back the energy the grid's own smoothing takes out of them.
@fragment
fn vorticity(p: Px) -> @location(0) vec4f {
  let t = F.texel;
  let l = abs(at(b, p.uv - vec2f(t.x, 0.0)).x);
  let r = abs(at(b, p.uv + vec2f(t.x, 0.0)).x);
  let u = abs(at(b, p.uv - vec2f(0.0, t.y)).x);
  let d = abs(at(b, p.uv + vec2f(0.0, t.y)).x);
  let w = at(b, p.uv).x;
  let g = 0.5 * vec2f(r - l, d - u);
  let n = g / (length(g) + 1e-5);
  let push = F.swirl * w * vec2f(n.y, -n.x);
  return vec4f(at(a, p.uv).xy + push * F.dt, 0.0, 1.0);
}

// a: velocity
@fragment
fn divergence(p: Px) -> @location(0) vec4f {
  let t = F.texel;
  let l = at(a, p.uv - vec2f(t.x, 0.0)).x;
  let r = at(a, p.uv + vec2f(t.x, 0.0)).x;
  let u = at(a, p.uv - vec2f(0.0, t.y)).y;
  let d = at(a, p.uv + vec2f(0.0, t.y)).y;
  return vec4f(0.5 * ((r - l) + (d - u)), 0.0, 0.0, 1.0);
}

// a: pressure, b: divergence. One Jacobi sweep of ∇²p = div.
@fragment
fn pressure(p: Px) -> @location(0) vec4f {
  let t = F.texel;
  let l = at(a, p.uv - vec2f(t.x, 0.0)).x;
  let r = at(a, p.uv + vec2f(t.x, 0.0)).x;
  let u = at(a, p.uv - vec2f(0.0, t.y)).x;
  let d = at(a, p.uv + vec2f(0.0, t.y)).x;
  let div = at(b, p.uv).x;
  return vec4f((l + r + u + d - div) * 0.25, 0.0, 0.0, 1.0);
}

// a: velocity, b: pressure. Taking away the pressure's gradient leaves what is divergence-free:
// the fluid can swirl but cannot pile up or empty out.
@fragment
fn project(p: Px) -> @location(0) vec4f {
  let t = F.texel;
  let l = at(b, p.uv - vec2f(t.x, 0.0)).x;
  let r = at(b, p.uv + vec2f(t.x, 0.0)).x;
  let u = at(b, p.uv - vec2f(0.0, t.y)).x;
  let d = at(b, p.uv + vec2f(0.0, t.y)).x;
  return vec4f(at(a, p.uv).xy - 0.5 * vec2f(r - l, d - u), 0.0, 1.0);
}

// a: velocity. Carry the velocity along itself: look back to where this texel's fluid came from.
@fragment
fn advect_velocity(p: Px) -> @location(0) vec4f {
  let back = p.uv - F.dt * at(a, p.uv).xy * F.texel;
  return vec4f(at(a, back).xy / (1.0 + F.vel_decay * F.dt), 0.0, 1.0);
}

// a: dye, b: velocity. The same look back, on the finer dye grid.
@fragment
fn advect_dye(p: Px) -> @location(0) vec4f {
  let back = p.uv - F.dt * at(b, p.uv).xy * F.texel;
  return vec4f(at(a, back).rgb / (1.0 + F.dye_decay * F.dt), 1.0);
}

// a: dye, to the screen, over the pool's own dark blue
@fragment
fn show(p: Px) -> @location(0) vec4f {
  let c = at(a, p.uv).rgb;
  let bg = vec3f(0.02, 0.02, 0.05);
  return vec4f(bg + c * (1.0 - bg), 1.0);
}
