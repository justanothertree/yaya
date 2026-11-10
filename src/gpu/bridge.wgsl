// The Lab's bridge builder, in one pass: sky, water and cliffs, the build grid, every member as a
// capsule tinted by how hard it is working, the joints, the cart, and the member being drawn.
// Everything is in metres; the uniform says where a metre lands on the canvas.

struct U {
  // pixels a metre; where x = 0 lands; where y = 0 lands (pixels from the top)
  view: vec4f,
  // span, water depth, members, joints
  scene: vec4f,
  // cart x, cart y, time, building (1) or driving (0)
  live: vec4f,
  // the member being drawn: from (x, y) to (x, y); off when from.x is −999
  ghost: vec4f,
}

@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> members: array<vec4f>;
// (x, y, fixed, selected) per joint
@group(0) @binding(2) var<storage, read> joints: array<vec4f>;

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

fn seg(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let ab = b - a;
  let t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
  return length(p - a - ab * t);
}

fn hash(p: vec2f) -> f32 {
  return fract(sin(dot(floor(p), vec2f(12.9898, 78.233))) * 43758.5453);
}

@fragment
fn scene(in: Cover) -> @location(0) vec4f {
  let s = u.view.x;
  let p = vec2f((in.pos.x - u.view.y) / s, (u.view.z - in.pos.y) / s);
  let px = 1.0 / s;
  let span = u.scene.x;
  let water = u.scene.y;
  // sky, and far hills
  var col = mix(vec3f(0.62, 0.78, 0.92), vec3f(0.3, 0.5, 0.78), clamp(p.y / 7.0, 0.0, 1.0));
  let hill = -1.0 + 0.8 * sin(p.x * 0.35 + 1.0) + 0.4 * sin(p.x * 0.9);
  if (p.y < hill) {
    col = mix(col, vec3f(0.45, 0.6, 0.55), 0.6);
  }
  // water
  if (p.y < -water + 0.08 * sin(p.x * 3.0 + u.live.z * 1.5)) {
    col = mix(vec3f(0.15, 0.35, 0.55), vec3f(0.05, 0.15, 0.3), clamp((-water - p.y) / 2.0, 0.0, 1.0));
  }
  // the cliffs: rock below the road on either side, grass along the top
  let rock = (p.x < 0.0 || p.x > span) && p.y < 0.0;
  if (rock) {
    let n = hash(p * 3.0) * 0.06 + hash(p * 0.7) * 0.05;
    col = vec3f(0.42, 0.36, 0.3) + n;
    if (p.y > -0.25) {
      col = vec3f(0.3, 0.55, 0.25) + n;
    }
  }
  // the build grid: a dot on every metre, while building
  if (u.live.w > 0.5 && !rock && p.y > -water + 0.9 && p.x > -2.5 && p.x < span + 2.5 && p.y < 6.2) {
    let g = abs(p - round(p));
    if (length(g) < 0.05) {
      col = mix(col, vec3f(1.0), 0.45);
    }
  }
  // members: a capsule each — road thick and dark, the rest thinner, strained toward red
  let nm = u32(u.scene.z);
  for (var i = 0u; i < nm; i++) {
    let ab = members[i * 2u];
    let c = members[i * 2u + 1u];
    let state = u32(c.w) & 3u;
    var r = 0.09;
    if ((u32(c.w) & 4u) != 0u) {
      r = 0.14; // road
    }
    let d = seg(p, ab.xy, ab.zw);
    if (d < r + px) {
      let edge = smoothstep(r + px, r - px, d);
      var m = c.rgb * (0.85 + 0.15 * smoothstep(r, 0.0, d));
      if (state == 1u) {
        // broken: what is left is grey and dashed
        let along = dot(p - ab.xy, normalize(ab.zw - ab.xy));
        m = select(vec3f(0.3), vec3f(0.5), fract(along * 3.0) < 0.5);
      }
      if (state == 2u) {
        m = mix(m, vec3f(1.0, 0.85, 0.2), 0.5);
      }
      col = mix(col, m, edge);
    }
  }
  // the member being drawn
  if (u.ghost.x > -900.0) {
    let d = seg(p, u.ghost.xy, u.ghost.zw);
    col = mix(col, vec3f(1.0, 1.0, 1.0), 0.6 * smoothstep(0.06 + px, 0.06 - px, d));
  }
  // joints: a pin each; anchors and joints on the ground are dark squares
  let nj = u32(u.scene.w);
  for (var i = 0u; i < nj; i++) {
    let j = joints[i];
    let q = p - j.xy;
    if (j.z > 0.5) {
      let b = max(abs(q.x), abs(q.y));
      col = mix(col, vec3f(0.15, 0.15, 0.18), smoothstep(0.19 + px, 0.19 - px, b));
    } else {
      let d = length(q);
      col = mix(col, vec3f(0.95, 0.95, 0.9), smoothstep(0.12 + px, 0.12 - px, d));
      col = mix(col, vec3f(0.2), smoothstep(0.05 + px, 0.05 - px, d));
    }
    if (j.w > 0.5) {
      col = mix(col, vec3f(1.0, 0.85, 0.2), smoothstep(0.03 + px, 0.0, abs(length(q) - 0.3)));
    }
  }
  // the cart: a red box on two wheels, sitting on the road
  if (u.live.w < 0.5) {
    let c = vec2f(u.live.x, u.live.y);
    let q = p - c - vec2f(0.0, 0.55);
    if (abs(q.x) < 0.7 && abs(q.y) < 0.3) {
      col = vec3f(0.8, 0.2, 0.15);
    }
    for (var w = -1; w <= 1; w += 2) {
      let wd = length(p - c - vec2f(f32(w) * 0.45, 0.2));
      if (wd < 0.2) {
        col = vec3f(0.12);
      }
    }
  }
  return vec4f(col, 1.0);
}
