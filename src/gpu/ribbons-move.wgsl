// Joined after ribbons-types.wgsl: the heads, moved, and the trail they leave.

@group(0) @binding(1) var<storage, read_write> trail: array<vec4f>;

const GOLDEN = 2.399963;

// mirrors `danceAt` in ribbons.ts
fn dance_at(r: u32, t: f32) -> vec3f {
  let ph = f32(r) * GOLDEN;
  let s = 0.8 + 0.4 * fract(f32(r) * 0.618034);
  switch (U.dance) {
    case 0u: {
      return 1.1 * vec3f(sin(t * s + ph), sin(1.5 * t * s + ph * 1.3), sin(0.5 * t * s + ph * 0.7));
    }
    case 1u: {
      let th = t * 0.6 * s + ph;
      let rho = cos(3.0 * th);
      return vec3f(1.2 * rho * cos(th), 1.2 * rho * sin(th), 0.4 * sin(2.0 * th + ph));
    }
    default: {
      return vec3f(
        0.7 * sin(0.71 * t + ph) + 0.4 * sin(1.93 * t * s + 2.0 * ph),
        0.7 * sin(0.53 * t + 1.7 * ph) + 0.4 * sin(1.37 * t * s + ph),
        0.7 * sin(0.61 * t + 2.3 * ph) + 0.4 * sin(1.71 * t * s),
      );
    }
  }
}

fn lead_offset(r: u32, t: f32) -> vec3f {
  let a = f32(r) * GOLDEN + t * 2.0;
  return vec3f(0.25 * cos(a), 0.25 * sin(a), 0.15 * sin(a * 0.5 + f32(r)));
}

@compute @workgroup_size(64)
fn advance(@builtin(global_invocation_id) id: vec3u) {
  let r = id.x;
  if (r >= U.count) {
    return;
  }
  let t = U.up.w;
  // its dance, drawn towards its place round a leading finger — see `headAt` for why no spring
  let g = dance_at(r, t);
  let n = mix(g, U.lead.xyz + lead_offset(r, t), smoothstep(0.0, 1.0, U.lead.w));
  // how fast it is going, from where it was last frame: wider when it sweeps
  let was = trail[r * U.length + (U.head + U.length - 1u) % U.length].xyz;
  trail[r * U.length + U.head] = vec4f(n, length(n - was) / max(U.dt, 1e-4));
}

