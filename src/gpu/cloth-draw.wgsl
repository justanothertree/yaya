// The cloth as it is seen: two triangles per square of the grid, built in the vertex shader
// straight from the particles the simulation moved — vertex pulling, no mesh ever uploaded. A
// square with any of its four sides torn is not drawn, which is what a hole is.
//
// Joined after cloth-types.wgsl, so both halves read one uniform.

@group(0) @binding(0) var<uniform> C: Cloth;
@group(0) @binding(1) var<storage, read> pos: array<vec4f>;
@group(0) @binding(2) var<storage, read> broken: array<u32>;

struct Px {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
  @location(1) normal: vec3f,
}

fn at(x: u32, y: u32) -> vec3f {
  return pos[y * C.cols + x].xyz;
}

@vertex
fn sheet(@builtin(vertex_index) v: u32) -> Px {
  let q = v / 6u;
  let qx = q % (C.cols - 1u);
  let qy = q / (C.cols - 1u);
  let corner = array<vec2u, 6>(vec2u(0u, 0u), vec2u(1u, 0u), vec2u(0u, 1u), vec2u(1u, 0u), vec2u(1u, 1u), vec2u(0u, 1u));
  let c = corner[v % 6u];
  let x = qx + c.x;
  let y = qy + c.y;

  var o: Px;
  let nh = (C.cols - 1u) * C.rows;
  let torn = broken[qy * (C.cols - 1u) + qx] + broken[(qy + 1u) * (C.cols - 1u) + qx]
    + broken[nh + qy * C.cols + qx] + broken[nh + qy * C.cols + qx + 1u];
  if (torn > 0u) {
    // every vertex of the square in one place: no area, nothing drawn
    o.clip = vec4f(2.0, 2.0, 2.0, 1.0);
    return o;
  }
  let p = at(x, y);
  // the surface's facing from its neighbours: across × up, so it faces the viewer when flat
  let across = at(min(x + 1u, C.cols - 1u), y) - at(max(x, 1u) - 1u, y);
  let up = at(x, max(y, 1u) - 1u) - at(x, min(y + 1u, C.rows - 1u));
  o.normal = normalize(cross(across, up));
  o.clip = vec4f(p.x / C.aspect, p.y, clamp(0.5 - p.z * 0.2, 0.0, 1.0), 1.0);
  o.uv = vec2f(f32(x) / f32(C.cols - 1u), f32(y) / f32(C.cols - 1u));
  return o;
}

@fragment
fn weave(px: Px) -> @location(0) vec4f {
  var n = normalize(px.normal);
  // two-sided: the back of the cloth is the same weave, a little duller
  let back = n.z < 0.0;
  if (back) {
    n = -n;
  }
  let u = px.uv.x;
  let v = px.uv.y;
  var base: vec3f;
  var sheen = 0.0;
  switch (C.fabric) {
    case 1u: {
      // silk: a deep colour that shifts across the width, and a long soft highlight
      base = mix(vec3f(0.05, 0.35, 0.45), vec3f(0.45, 0.1, 0.45), u);
      sheen = 0.9;
    }
    case 2u: {
      // stripes, as a deckchair
      let band = u32(floor(v * 9.0)) % 4u;
      let bands = array<vec3f, 4>(vec3f(0.9, 0.25, 0.2), vec3f(0.95, 0.9, 0.8), vec3f(0.15, 0.4, 0.75), vec3f(0.95, 0.9, 0.8));
      base = bands[band];
      sheen = 0.15;
    }
    case 3u: {
      // denim: indigo, with the diagonal of a twill weave
      let twill = 0.85 + 0.15 * step(0.5, fract((u + v) * 90.0));
      base = vec3f(0.12, 0.2, 0.42) * twill;
      sheen = 0.1;
    }
    default: {
      // gingham: where a red thread crosses a red thread it is darkest
      let a = step(0.5, fract(u * 12.0));
      let b = step(0.5, fract(v * 12.0));
      base = mix(vec3f(0.97, 0.95, 0.92), vec3f(0.8, 0.12, 0.15), (a + b) * 0.5);
      sheen = 0.2;
    }
  }
  if (back) {
    base *= 0.7;
  }
  let light = normalize(vec3f(-0.4, 0.6, 0.7));
  let diffuse = max(dot(n, light), 0.0);
  let spec = pow(max(dot(reflect(-light, n), vec3f(0.0, 0.0, 1.0)), 0.0), 18.0) * sheen;
  return vec4f(base * (0.35 + 0.75 * diffuse) + vec3f(spec), 1.0);
}
