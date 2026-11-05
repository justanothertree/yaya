// The aquarium: fish that school. Each fish looks at every other fish — separation, alignment,
// cohesion, the three rules of boids — and only schools with its own kind, so three species sort
// themselves into shoals of three colours. Food draws them in; a shark scatters them.
//
// Joined in front of tank-step.wgsl and tank-draw.wgsl by tankEngine.ts.
//
// ⚠️ `Tank` IS PACKED BY HAND IN tank.ts (`TANK`); tank.test.ts lays it out from this source.

struct Tank {
  aspect: f32,
  dt: f32,
  time: f32,
  count: u32,
  shark: vec2f, // where the shark is, in world units
  hunting: f32, // 1 while a finger is the shark, 0 otherwise
  food: u32, // how many pellets are in the water
  size: f32, // a fish's length, in world units
}

// a fish: position in xy, velocity in zw. World: x across ±aspect, y from -1 (top) to 1.
const SPECIES = 3u;

fn species(i: u32) -> u32 {
  return i % SPECIES;
}
