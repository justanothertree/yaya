// Bike trials. The course is baked ONCE into a signed distance field — every texel the distance to
// the nearest edge of the ground, negative inside it — and that one field then does three jobs:
// it draws the ground (its depth gives the dirt its layers, its edge the grass), it lets the mud the
// tyres throw bounce off the ground without anybody describing the ground to it again, and its
// slope lights the ground's rim. The bike itself is drawn from a handful of shapes in the same
// pass, posed from the physics the CPU runs.

struct Trial {
  size: vec2u,
  cam: vec2f,
  scale: f32,
  time: f32,
  origin: vec2f,
  grid: vec2u,
  texel: f32,
  segments: u32,
  body: vec4f,
  rear: vec4f,
  front: vec4f,
  flags: vec4f,
  flagsY: vec4f,
  finish: vec2f,
  passed: f32,
  crashed: f32,
  dust: u32,
}

@group(0) @binding(0) var<uniform> P: Trial;
@group(0) @binding(1) var<storage, read> segs: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> field: array<f32>;
@group(0) @binding(3) var<storage, read_write> dust: array<vec4f>;
@group(0) @binding(4) var<storage, read> ground: array<f32>;
@group(0) @binding(5) var<storage, read> motes: array<vec4f>;

const WHEEL_R = 0.36;
const G = 14.0;

// ---------------------------------------------------------------- the bake

/** a texel's signed distance: the nearest edge, and inside by crossings, as signedDistance in trials.ts */
@compute @workgroup_size(16, 16)
fn bake(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= P.grid.x || id.y >= P.grid.y) {
    return;
  }
  let p = P.origin + (vec2f(id.xy) + 0.5) * P.texel;
  var best = 1e9;
  var inside = false;
  for (var i = 0u; i < P.segments; i++) {
    let s = segs[i];
    let a = s.xy;
    let c = s.zw;
    let ab = c - a;
    let l = dot(ab, ab);
    var t = 0.0;
    if (l > 0.0) {
      t = clamp(dot(p - a, ab) / l, 0.0, 1.0);
    }
    best = min(best, length(p - a - t * ab));
    if ((a.y > p.y) != (c.y > p.y) && p.x < a.x + (p.y - a.y) * (c.x - a.x) / (c.y - a.y)) {
      inside = !inside;
    }
  }
  field[id.y * P.grid.x + id.x] = select(best, -best, inside);
}

// ---------------------------------------------------------------- the field, read back

/* ⚠️ Two readers, not one taking a pointer: a pointer to storage as a function argument is a
   language extension not every browser has, and the bake's binding is read_write while the
   drawing's is read-only, so they cannot share one variable anyway */
fn texel_at(c: vec2i) -> f32 {
  let q = clamp(c, vec2i(0), vec2i(P.grid) - 1);
  return field[u32(q.y) * P.grid.x + u32(q.x)];
}

/** the field between texels, in metres — for the mud, which reads the read_write binding */
fn sdf_dust(p: vec2f) -> f32 {
  let q = (p - P.origin) / P.texel - 0.5;
  let c = vec2i(floor(q));
  let f = q - floor(q);
  let a = mix(texel_at(c), texel_at(c + vec2i(1, 0)), f.x);
  let b = mix(texel_at(c + vec2i(0, 1)), texel_at(c + vec2i(1, 1)), f.x);
  return mix(a, b, f.y);
}

fn ground_texel(c: vec2i) -> f32 {
  let q = clamp(c, vec2i(0), vec2i(P.grid) - 1);
  return ground[u32(q.y) * P.grid.x + u32(q.x)];
}

/** the same, for drawing, from the read-only binding */
fn sdf(p: vec2f) -> f32 {
  let q = (p - P.origin) / P.texel - 0.5;
  let c = vec2i(floor(q));
  let f = q - floor(q);
  let a = mix(ground_texel(c), ground_texel(c + vec2i(1, 0)), f.x);
  let b = mix(ground_texel(c + vec2i(0, 1)), ground_texel(c + vec2i(1, 1)), f.x);
  var d = mix(a, b, f.y);
  // below the baked area it is all ground; beside it, all air
  if (p.y < P.origin.y) {
    d = -1.0;
  }
  return d;
}

// ---------------------------------------------------------------- the mud

/**
 * A particle is two vec4fs: (x, y, vx, vy) and (life, size, shade, 0). Gravity and air, and where
 * the field says it is in the ground: out along the slope, the speed into the ground mostly lost.
 */
@compute @workgroup_size(64)
fn fly(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= P.dust) {
    return;
  }
  var a = dust[id.x * 2u];
  var b = dust[id.x * 2u + 1u];
  if (b.x <= 0.0) {
    return;
  }
  let dt = 1.0 / 60.0;
  var v = a.zw;
  v.y -= G * dt;
  v *= 1.0 - 0.6 * dt;
  var p = a.xy + v * dt;
  let r = b.y;
  let d = sdf_dust(p);
  if (d < r) {
    let e = P.texel;
    let n = normalize(vec2f(sdf_dust(p + vec2f(e, 0)) - sdf_dust(p - vec2f(e, 0)),
                            sdf_dust(p + vec2f(0, e)) - sdf_dust(p - vec2f(0, e))) + vec2f(0, 1e-6));
    p += n * (r - d);
    let vn = dot(v, n);
    if (vn < 0.0) {
      v -= 1.35 * vn * n;
    }
    v *= 0.75;
    // mud that has landed lies a while and fades faster
    b.x -= dt * 1.5;
  }
  b.x -= dt;
  dust[id.x * 2u] = vec4f(p, v);
  dust[id.x * 2u + 1u] = b;
}

// ---------------------------------------------------------------- drawing

@vertex
fn cover(@builtin(vertex_index) v: u32) -> @builtin(position) vec4f {
  let p = array(vec2f(-1, -3), vec2f(3, 1), vec2f(-1, 1))[v];
  return vec4f(p, 0, 1);
}

fn hash(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.547);
}
fn noise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = p - i;
  let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2f(1, 0)), u.x), mix(hash(i + vec2f(0, 1)), hash(i + vec2f(1, 1)), u.x), u.y);
}

fn rot(p: vec2f, a: f32) -> vec2f {
  return vec2f(p.x * cos(a) - p.y * sin(a), p.x * sin(a) + p.y * cos(a));
}
/** distance to a capsule from a to b */
fn capsule(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let ab = b - a;
  let t = clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0);
  return length(p - a - t * ab);
}

/** a wheel: tyre, rim, and spokes turned by its spin */
fn wheel(p: vec2f, w: vec4f, px: f32, col: vec4f) -> vec4f {
  let q = p - w.xy;
  let r = length(q);
  var c = col;
  let tyre = smoothstep(px, 0.0, abs(r - WHEEL_R * 0.86) - WHEEL_R * 0.14);
  c = mix(c, vec4f(0.08, 0.08, 0.09, 1), tyre);
  // tread blocks on the tyre, turning with it
  let ang = atan2(q.y, q.x) - w.z;
  let tread = step(0.5, fract(ang * 18.0 / 6.2832)) * smoothstep(WHEEL_R - 0.05, WHEEL_R - 0.02, r) * step(r, WHEEL_R);
  c = mix(c, vec4f(0.2, 0.2, 0.22, 1), tread * 0.6);
  let rim = smoothstep(px, 0.0, abs(r - WHEEL_R * 0.7) - 0.012);
  c = mix(c, vec4f(0.75, 0.75, 0.8, 1), rim);
  // six spokes
  let s = abs(fract(ang * 3.0 / 3.14159 + 0.5) - 0.5) * 3.14159 / 3.0 * r;
  let spoke = smoothstep(px, 0.0, s - 0.008) * step(r, WHEEL_R * 0.7) * step(0.04, r);
  c = mix(c, vec4f(0.7, 0.7, 0.75, 1), spoke);
  let hub = smoothstep(px, 0.0, r - 0.05);
  c = mix(c, vec4f(0.85, 0.3, 0.15, 1), hub);
  return c;
}

/** the bike and the rider, from the chassis's pose and the wheels' */
fn bike(p: vec2f, px: f32, below: vec4f) -> vec4f {
  var c = below;
  let o = P.body.xy;
  let a = P.body.z;
  let lean = P.body.w;
  // forks: from each anchor to its wheel's hub
  let rearA = o + rot(vec2f(-0.72, -0.3), a);
  let frontA = o + rot(vec2f(0.72, -0.3), a);
  let fork = min(capsule(p, rearA, P.rear.xy), capsule(p, frontA + rot(vec2f(-0.08, 0.35), a), P.front.xy));
  c = mix(c, vec4f(0.55, 0.55, 0.6, 1), smoothstep(px, 0.0, fork - 0.035));
  c = wheel(p, P.rear, px, c);
  c = wheel(p, P.front, px, c);
  // the frame: tank, seat, engine
  let l = rot(p - o, -a);
  let tank = capsule(l, vec2f(-0.2, 0.12), vec2f(0.45, 0.2)) - 0.11;
  let seat = capsule(l, vec2f(-0.65, 0.18), vec2f(-0.1, 0.16)) - 0.06;
  let engine = length(max(abs(l - vec2f(0.0, -0.12)) - vec2f(0.22, 0.12), vec2f(0))) - 0.04;
  let frame = min(min(tank, seat), engine);
  var body = vec4f(0.9, 0.35, 0.12, 1);
  if (P.crashed > 0.5) {
    body = vec4f(0.6, 0.3, 0.2, 1);
  }
  c = mix(c, select(body, vec4f(0.12, 0.12, 0.14, 1), engine < min(tank, seat)), smoothstep(px, 0.0, frame));
  // the rider, leaning with the input: hips on the seat, shoulders and head forward or back
  let hip = vec2f(-0.3, 0.32);
  let shoulder = vec2f(-0.05 + 0.18 * -lean, 0.82 - 0.05 * abs(lean));
  let head = shoulder + vec2f(0.08 - 0.05 * lean, 0.22);
  let hand = vec2f(0.42, 0.42);
  let knee = vec2f(0.05, 0.25);
  let foot = vec2f(-0.05, -0.08);
  let legs = min(capsule(l, hip, knee), capsule(l, knee, foot)) - 0.06;
  let torso = capsule(l, hip, shoulder) - 0.09;
  let arm = min(capsule(l, shoulder, (shoulder + hand) * 0.5 + vec2f(0.0, -0.08)), capsule(l, (shoulder + hand) * 0.5 + vec2f(0.0, -0.08), hand)) - 0.04;
  let rider = min(min(legs, torso), arm);
  c = mix(c, vec4f(0.15, 0.25, 0.55, 1), smoothstep(px, 0.0, rider));
  let helmet = length(l - head) - 0.16;
  c = mix(c, vec4f(0.95, 0.85, 0.2, 1), smoothstep(px, 0.0, helmet));
  let visor = length(l - head - vec2f(0.08, 0.0)) - 0.07;
  c = mix(c, vec4f(0.1, 0.12, 0.2, 1), smoothstep(px, 0.0, max(visor, helmet)));
  return c;
}

/** a flag on a pole at (x, ground y): chequered at the finish, green once passed */
fn flag(p: vec2f, base: vec2f, px: f32, kind: f32, below: vec4f) -> vec4f {
  var c = below;
  let pole = capsule(p, base, base + vec2f(0, 2.4));
  c = mix(c, vec4f(0.85, 0.85, 0.85, 1), smoothstep(px, 0.0, pole - 0.03));
  let q = p - base - vec2f(0.03, 1.75);
  let wave = sin(q.x * 6.0 - P.time * 5.0) * 0.06 * q.x;
  if (q.x > 0.0 && q.x < 0.9 && q.y + wave > 0.0 && q.y + wave < 0.6) {
    if (kind > 1.5) {
      let chk = (u32(floor(q.x / 0.15)) + u32(floor((q.y + wave) / 0.15))) % 2u;
      c = select(vec4f(0.1, 0.1, 0.1, 1), vec4f(0.95, 0.95, 0.95, 1), chk == 0u);
    } else if (kind > 0.5) {
      c = vec4f(0.25, 0.75, 0.35, 1);
    } else {
      c = vec4f(0.95, 0.55, 0.1, 1);
    }
  }
  return c;
}

@fragment
fn show(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let size = vec2f(P.size);
  let px = 1.0 / P.scale;
  // world position: y up, the camera in the middle
  let p = P.cam + vec2f(pos.x - size.x * 0.5, size.y * 0.5 - pos.y) * px;
  // the sky, and two ranges of hills behind at their own depths
  let h = clamp((p.y - P.cam.y) / 12.0 + 0.5, 0.0, 1.0);
  var c = vec4f(mix(vec3f(0.98, 0.82, 0.6), vec3f(0.35, 0.55, 0.85), h), 1);
  for (var k = 0; k < 2; k++) {
    let depth = select(0.25, 0.5, k == 1);
    let x = P.cam.x * (1.0 - depth) + (p.x - P.cam.x);
    let ridge = P.cam.y * (1.0 - depth) - 1.0 + f32(k) * -1.5 + 3.0 * noise(vec2f(x * 0.08 + f32(k) * 17.0, 0.0)) + 1.2 * noise(vec2f(x * 0.3, 3.0));
    let hill = select(vec3f(0.55, 0.62, 0.72), vec3f(0.42, 0.5, 0.45), k == 1);
    c = mix(c, vec4f(hill, 1), smoothstep(px, -px, p.y - ridge));
  }
  // the ground, from the field: its depth gives it layers, its edge grass
  let d = sdf(p);
  if (d < px) {
    let depth = -d;
    var dirt = mix(vec3f(0.52, 0.36, 0.22), vec3f(0.36, 0.24, 0.16), smoothstep(0.2, 2.5, depth));
    dirt *= 0.85 + 0.25 * noise(p * 3.0) + 0.1 * noise(p * 11.0);
    // strata, following the surface
    dirt *= 1.0 - 0.12 * smoothstep(0.4, 0.5, fract(depth * 1.4 + noise(p * 0.5) * 0.4));
    // stones
    let stone = smoothstep(0.7, 0.74, noise(p * 2.6 + 13.0));
    dirt = mix(dirt, vec3f(0.55, 0.53, 0.5) * (0.8 + 0.3 * noise(p * 9.0)), stone * smoothstep(0.3, 0.6, depth));
    // grass on the rim
    let grass = smoothstep(0.16 + 0.06 * noise(p * 20.0), 0.06, depth);
    dirt = mix(dirt, vec3f(0.35, 0.6, 0.25) * (0.85 + 0.3 * noise(p * 15.0)), grass);
    c = mix(c, vec4f(dirt, 1), smoothstep(px, -px, d));
  }
  // checkpoints and the finish
  for (var k = 0; k < 4; k++) {
    if (P.flags[k] > -1e5) {
      c = flag(p, vec2f(P.flags[k], P.flagsY[k]), px, select(0.0, 1.0, f32(k) <= P.passed), c);
    }
  }
  c = flag(p, P.finish, px, 2.0, c);
  c = bike(p, px, c);
  return c;
}

// ---------------------------------------------------------------- mud, drawn

struct Mote {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) shade: f32,
  @location(2) alpha: f32,
}

@vertex
fn mote(@builtin(vertex_index) v: u32) -> Mote {
  let i = v / 6u;
  let a = motes[i * 2u];
  let b = motes[i * 2u + 1u];
  let corner = array(vec2f(-1, -1), vec2f(1, -1), vec2f(-1, 1), vec2f(-1, 1), vec2f(1, -1), vec2f(1, 1))[v % 6u];
  let size = vec2f(P.size);
  let world = a.xy + corner * b.y;
  let screen = (world - P.cam) * P.scale;
  var o: Mote;
  o.pos = vec4f(screen.x / size.x * 2.0, screen.y / size.y * 2.0, 0, 1);
  if (b.x <= 0.0) {
    o.pos = vec4f(2, 2, 0, 1);
  }
  o.uv = corner;
  o.shade = b.z;
  o.alpha = clamp(b.x, 0.0, 1.0);
  return o;
}

@fragment
fn mud(i: Mote) -> @location(0) vec4f {
  let r = length(i.uv);
  if (r > 1.0) {
    discard;
  }
  let col = mix(vec3f(0.42, 0.28, 0.16), vec3f(0.6, 0.45, 0.3), i.shade);
  return vec4f(col * (1.0 - 0.3 * r), i.alpha);
}
