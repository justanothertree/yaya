// The Lab's beams puzzle, in one pass: the board, every piece drawn as a distance field in its own
// cell, and every beam as light — a hot core and a wide soft halo, ADDED, so where red and green
// beams cross the crossing reads yellow the way the rules say it does.

struct U {
  // canvas size; where the board's top-left lands, in pixels
  view: vec4f,
  // pixels a cell, board columns, rows, beams
  grid: vec4f,
  // time (s), solved (0..1, how long ago, for a flash), the cell under the pointer (x, y; −1 none)
  live: vec4f,
}

@group(0) @binding(0) var<uniform> u: U;
// (kind, turn or received, colour, flags) per cell — see packCells in beams.ts
@group(0) @binding(1) var<storage, read> cells: array<vec4f>;
// (x0, y0, x1, y1) then (r, g, b, 1) per beam, in cells
@group(0) @binding(2) var<storage, read> beams: array<vec4f>;

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

fn rgb(c: f32) -> vec3f {
  let m = u32(c);
  return vec3f(f32(m & 1u), f32((m >> 1u) & 1u), f32((m >> 2u) & 1u));
}

// distance from p to the segment a–b
fn seg(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let ab = b - a;
  let t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
  return length(p - a - ab * t);
}

fn line_at(d: f32, w: f32, px: f32) -> f32 {
  return 1.0 - smoothstep(w - px, w + px, d);
}

@fragment
fn board(in: Cover) -> @location(0) vec4f {
  let s = u.grid.x;
  let size = u.grid.yz;
  let b = (in.pos.xy - u.view.zw) / s; // the point, in cells
  let px = 1.0 / s; // one pixel, in cells
  var col = vec3f(0.035, 0.035, 0.06);
  let on = b.x >= 0.0 && b.y >= 0.0 && b.x < size.x && b.y < size.y;
  if (on) {
    let c = floor(b);
    let f = b - c - 0.5; // −0.5..0.5 within the cell
    let cell = cells[u32(c.y * size.x + c.x)];
    let kind = u32(cell.x);
    // the floor: a dark tile with a hairline seam
    let edge = 0.5 - max(abs(f.x), abs(f.y));
    col = vec3f(0.07, 0.075, 0.1) + 0.03 * smoothstep(0.0, 0.08, edge);
    col = mix(vec3f(0.12, 0.13, 0.17), col, smoothstep(0.0, px * 1.5, edge));
    let fixed = (u32(cell.w) & 1u) != 0u;
    if (fixed && kind >= 2u && kind <= 4u) {
      col += vec3f(0.06); // a fixed piece sits on a lighter plate
    }
    if (kind == 1u) {
      // a wall: a raised block with a bevel
      let bevel = smoothstep(0.0, 0.12, edge);
      col = mix(vec3f(0.3, 0.3, 0.36), vec3f(0.2, 0.2, 0.25), bevel) * (0.9 + 0.1 * f.y);
    } else if (kind == 2u || kind == 3u) {
      // a mirror or a splitter: a bar along its diagonal, silver, or glass with a dashed silvering
      let dir = select(vec2f(1.0, -1.0), vec2f(1.0, 1.0), cell.y > 0.5) * 0.7071;
      let along = dot(f, dir);
      let across = abs(dot(f, vec2f(-dir.y, dir.x)));
      let inBar = across < 0.06 && abs(along) < 0.4;
      if (inBar) {
        if (kind == 2u) {
          col = mix(vec3f(0.55, 0.6, 0.7), vec3f(0.95), smoothstep(0.06, 0.0, across));
        } else {
          let dash = fract(along * 6.0) < 0.55;
          col = select(vec3f(0.25, 0.4, 0.5), vec3f(0.75, 0.9, 1.0), dash);
        }
      }
    } else if (kind == 4u) {
      // a filter: a square of tinted glass
      let ring = max(abs(f.x), abs(f.y));
      if (ring < 0.32) {
        col = mix(col, rgb(cell.z) * 0.8, 0.55);
        col += rgb(cell.z) * 0.25 * smoothstep(0.32, 0.28, ring) * smoothstep(0.24, 0.3, ring);
      }
    } else if (kind == 5u) {
      // an emitter: a housing, and its lens on the side it shines from
      let box = max(abs(f.x), abs(f.y));
      if (box < 0.36) {
        col = vec3f(0.18, 0.18, 0.22);
        let d = u32(cell.y);
        let face = array<vec2f, 4>(vec2f(1.0, 0.0), vec2f(0.0, 1.0), vec2f(-1.0, 0.0), vec2f(0.0, -1.0))[d];
        let lens = length(f - face * 0.28);
        col = mix(col, rgb(cell.z), smoothstep(0.13, 0.1, lens));
      }
    } else if (kind == 6u) {
      // a target: a ring in the colour it wants; filled with what arrives, bright when it is right
      let r = length(f);
      let want = rgb(cell.z);
      let got = rgb(cell.y);
      let lit = (u32(cell.w) & 2u) != 0u;
      if (r < 0.4) {
        col = vec3f(0.05);
        if (r > 0.3) {
          col = want * select(0.55, 1.0, lit);
        } else if (r < 0.24) {
          col = got * select(0.35, 1.0, lit) + select(vec3f(0.0), vec3f(0.25), lit);
        }
      }
      if (lit) {
        col += want * 0.35 * exp(-r * 6.0) * (0.8 + 0.2 * sin(u.live.x * 4.0));
      }
    }
    // the selected piece, and the cell under the pointer
    if ((u32(cell.w) & 4u) != 0u) {
      col = mix(col, vec3f(1.0, 0.85, 0.3), line_at(abs(edge - 0.04), 0.02, px));
    }
    if (u.live.z >= 0.0 && c.x == u.live.z && c.y == u.live.w) {
      col += vec3f(0.06);
    }
  }
  // the light: every beam's core and halo, added — a beam is light, not paint
  let n = u32(u.grid.w);
  var light = vec3f(0.0);
  for (var i = 0u; i < n; i++) {
    let a = beams[i * 2u];
    let colour = beams[i * 2u + 1u].rgb;
    let d = seg(b, a.xy, a.zw);
    // a faint shimmer runs along each beam, outward from where it started
    let along = length(b - a.xy);
    let run = 0.85 + 0.15 * sin(along * 9.0 - u.live.x * 8.0);
    light += colour * (exp(-pow(d / 0.045, 2.0)) * 1.4 + exp(-d / 0.16) * 0.35) * run;
  }
  col += light;
  // solved: the board breathes once
  let flash = u.live.y;
  if (flash > 0.0 && on) {
    col += vec3f(0.2, 0.18, 0.1) * flash;
  }
  // a gentle tone curve, so where three colours add they read white rather than clipping flat
  col = col / (1.0 + col * 0.35);
  return vec4f(col * 1.3, 1.0);
}
