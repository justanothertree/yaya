// A spiral galaxy, from nothing but each star's own index.
//
// ⚠️ THE ARMS ARE NOT MADE OF STARS. Every star follows an ellipse, and each ellipse is turned a
// little further than the one inside it (`twist` per unit radius). Where neighbouring ellipses
// bunch together, stars crowd, and the crowding is the arm — so the arms hold their shape while
// every star in them keeps moving through. Drawn with stars stuck to the arms instead, the
// faster inner orbits would wind the arms up into a tight coil within a few turns.
//
// No buffers: a star's radius, phase, height and kind come from hashing its index, and where it
// is now is worked out from those and the time. Drawn like the swarm — six vertices a star, no
// instancing (see swarm-draw.wgsl for why).
//
// ⚠️ `Galaxy` IS PACKED BY HAND IN galaxy.ts (`GALAXY`); galaxy.test.ts lays it out from here.

struct Galaxy {
  aspect: f32,
  time: f32, // galactic time: how far every orbit has gone round
  twist: f32, // how much each ellipse is turned per unit of radius — the arms' winding
  tilt: f32, // the view: 0 face on, towards π/2 edge on
  turn: f32, // the view: turned about the galaxy's axis
  size: f32, // a star's half-width in clip units
  glow: f32,
  pulse: f32, // 0..1, the music's loudness: the galaxy breathes with it
  kick: f32, // 1 on a beat, falling away: stars flare
  count: u32,
}

@group(0) @binding(0) var<uniform> G: Galaxy;

fn pcg(v: u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}

fn unit(v: u32) -> f32 {
  return f32(pcg(v) >> 8u) / 16777216.0;
}

struct Star {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
  @location(1) color: vec3f,
}

const CORNERS = array<vec2f, 6>(
  vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
  vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
);
const TAU = 6.2831853;

@vertex
fn star(@builtin(vertex_index) v: u32) -> Star {
  let i = v / 6u;
  var corners = CORNERS;
  let c = corners[v % 6u];
  let h = pcg(i * 7u + 13u);
  let kind = unit(h);

  // the bulge: a dense round core of old yellow stars; the disc: everything else, thinning out
  let bulge = kind < 0.16;
  var r: f32;
  if (bulge) {
    r = 0.09 * sqrt(-log(max(unit(h + 1u), 1e-4))) ;
  } else {
    // ⚠️ AN EXPONENTIAL DISC BY AREA, as real ones are. Two things went wrong on the way here: a
    // disc that stopped at an edge drew its outermost ellipse as a hard bright rim, and one that
    // was exponential in RADIUS piled stars into the middle — the same number per step outward,
    // on ever smaller rings — and burned a white ring round a dark core. Drawing r as the sum of
    // two exponential draws makes the density per AREA fall off smoothly from the centre out.
    r = 0.075 * -log(max(unit(h + 1u) * unit(h + 5u), 1e-6));
  }
  // a flat rotation curve: every star moves at about the same speed, so the inner ones go round
  // far more often — exactly what would wind the arms up if the arms were the stars
  let omega = 0.12 / (r + 0.06);
  let theta = unit(h + 2u) * TAU + G.time * omega;
  // an ellipse, turned further the further out it is
  let squash = select(0.62, 0.92, bulge);
  let e = vec2f(r * cos(theta), r * squash * sin(theta));
  let phi = r * G.twist;
  var p = vec3f(e.x * cos(phi) - e.y * sin(phi), e.x * sin(phi) + e.y * cos(phi), 0.0);
  // a little thickness: the disc is thin, the bulge round
  p.z = (unit(h + 3u) - 0.5) * select(0.025 * (1.0 - r), 0.12 * exp(-r * 10.0), bulge);
  // the galaxy breathes with the music
  p *= 1.0 + 0.07 * G.pulse;

  // the view: turned about the axis, then tilted away from face on
  let ct = cos(G.turn);
  let st = sin(G.turn);
  p = vec3f(p.x * ct - p.y * st, p.x * st + p.y * ct, p.z);
  let cl = cos(G.tilt);
  let sl = sin(G.tilt);
  let seen = vec2f(p.x, p.y * cl - p.z * sl) * 1.9;

  // colour: a warm core, blue-white young stars in the disc, and now and then a pink nebula
  let pink = !bulge && unit(h + 4u) < 0.04;
  var col = mix(vec3f(1.0, 0.86, 0.6), vec3f(0.62, 0.75, 1.0), smoothstep(0.02, 0.3, r));
  if (bulge) {
    // dimmer one by one, because there are so many of them so close: at full brightness the core
    // added up to a flat white disc
    col = vec3f(1.0, 0.82, 0.55) * 0.8;
  }
  var size = G.size * (1.0 + 0.9 * G.kick);
  if (pink) {
    col = vec3f(1.0, 0.35, 0.65) * 0.6;
    size *= 2.6;
  }

  var o: Star;
  o.clip = vec4f((seen.x + c.x * size) / G.aspect, seen.y + c.y * size, 0.0, 1.0);
  o.uv = c;
  o.color = col * G.glow * (1.0 + 0.8 * G.kick);
  return o;
}

@fragment
fn glow(s: Star) -> @location(0) vec4f {
  let r = dot(s.uv, s.uv);
  if (r > 1.0) {
    discard;
  }
  let fall = (1.0 - r) * (1.0 - r);
  return vec4f(s.color * fall, 1.0);
}
