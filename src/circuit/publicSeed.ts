// Public demo seed: only Evan's slice of the Circuit (pid '2'). The signed-out sandbox
// shows this so visitors can try the app against Evan's real fitness + movie data
// without seeing anyone else in the group, and without touching any real/cloud data
// (the local adapter persists only to the visitor's own browser).
import type { CircuitState } from './types'
import { circuitSeed } from './seed'

const EVAN = '2'

export const publicSeed: CircuitState = {
  people: circuitSeed.people.filter((p) => p.id === EVAN),
  logs: circuitSeed.logs.filter((l) => l.personId === EVAN),
  // keep movies Evan rated, exposing only his rating (others in the group stay hidden)
  movies: circuitSeed.movies
    .filter((m) => m.ratings[EVAN] != null)
    .map((m) => ({ ...m, ratings: { [EVAN]: m.ratings[EVAN] } })),
  // watchlist titles are shared suggestions, but only Evan's votes are shown
  watchlist: circuitSeed.watchlist.map((w) => ({
    ...w,
    votes: (w.votes ?? []).filter((v) => v === EVAN),
  })),
}
