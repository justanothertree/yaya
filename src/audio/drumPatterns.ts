import type { LoopEvent } from './looper'
import { DRUMS } from './synth'

/**
 * Beats to start from.
 *
 * ⚠️ THIS IS THE BLANK-PAGE PROBLEM, not a content feature. Everything else in this room assumes
 * you can already play something: record a take, and if you cannot play a drum part there is
 * nothing to arrange, nothing to build a bassline against, and no reason to come back. Somebody
 * who does not play an instrument needs a bar of something in front of them before any of the
 * rest of it means anything — and once there is, the room's own tools (mute a piece, drag its
 * bars, re-voice it, open the notes) are suddenly all usable.
 *
 * ⚠️ WRITTEN AS GRIDS, because that is what makes adding one a two-line job rather than a
 * programming task. Sixteen characters is one bar of sixteenths, `x` is a hit, everything else is
 * a rest — the same picture a drum machine has shown since 1980, so a pattern can be read,
 * checked and corrected by looking at it. Thirty-two characters is two bars, and any multiple
 * works.
 *
 * ⚠️ AND THEY ARE ORDINARY LAYERS once inserted. No pattern player, no special drum track, no
 * second scheduler: this builds the same events a recorded take has, so every existing control
 * works on it immediately. That is the whole reason not to give patterns a mechanism of their
 * own — a beat you cannot edit is a toy, and a beat that is just a take you did not have to play
 * is a starting point.
 */

/** Which piece each row is, by name — resolved against DRUMS so a typo cannot silently pick one. */
export type Grid = Partial<Record<(typeof DRUMS)[number], string>>

export type DrumPattern = {
  id: string
  name: string
  genre: string
  grid: Grid
}

/**
 * ⚠️ AND THEY ARE SPARSER THAN THE FIRST ATTEMPT. Several were written at sixteenths on every
 * voice — a hat on all sixteen, a closed hat under an open one, a cowbell on every beat — which
 * measured fine and sounded like a wall. Reported as "overbearingly crowded", and it is the
 * predictable failure of writing drums as grids: filling a row is easier than leaving it empty,
 * and every hit you add is one somebody has to hear. A starting point has to leave room for the
 * thing you are about to play over it, so where a pattern could be read at eighths it is.
 *
 * ⚠️ EVERY GENRE EARNS ITS PLACE BY SOUNDING DIFFERENT, not by being named. Ten variations on a
 * backbeat with different labels is a longer list that helps nobody choose. These differ in the
 * thing that actually identifies them: where the kick falls against the snare, and what is
 * keeping time above them.
 */
export const DRUM_PATTERNS: DrumPattern[] = [
  {
    id: 'rock-straight',
    name: 'Straight',
    genre: 'Rock',
    grid: {
      Kick: 'x.......x.......',
      Snare: '....x.......x...',
      'Closed hat': 'x.x.x.x.x.x.x.x.',
    },
  },
  {
    id: 'rock-driving',
    name: 'Driving',
    genre: 'Rock',
    grid: {
      Kick: 'x...x...x...x...',
      Snare: '....x.......x...',
      'Closed hat': 'x.x.x.x.x.x.x.x.',
    },
  },
  {
    id: 'rock-half',
    name: 'Half time',
    genre: 'Rock',
    grid: {
      Kick: 'x.......x.x.....',
      Snare: '........x.......',
      'Closed hat': 'x.x.x.x.x.x.x.x.',
      Crash: 'x...............',
    },
  },
  {
    id: 'pop-four',
    name: 'Four on the floor',
    genre: 'Pop',
    grid: {
      Kick: 'x...x...x...x...',
      Clap: '....x.......x...',
      'Closed hat': '..x...x...x...x.',
    },
  },
  {
    id: 'pop-bounce',
    name: 'Bounce',
    genre: 'Pop',
    grid: {
      Kick: 'x.....x.x.......',
      Clap: '....x.......x...',
      'Closed hat': 'x.x.x.x.x.x.x.x.',
      'Open hat': '..............x.',
    },
  },
  {
    id: 'hiphop-boombap',
    name: 'Boom bap',
    genre: 'Hip hop',
    grid: {
      Kick: 'x.......x.x.....',
      Snare: '....x.......x...',
      'Closed hat': 'x.x.x.x.x.x.x.x.',
    },
  },
  {
    id: 'hiphop-trap',
    name: 'Trap',
    genre: 'Hip hop',
    grid: {
      Kick: 'x.......x..x....',
      Snare: '........x.......',
      /* ⚠️ the rolls are the genre. A trap pattern with even hats is just a slow backbeat —
         the doubled and tripled sixteenths are the thing anybody would name it by. */
      'Closed hat': 'x.x.x.xxx.x.x.x.',
    },
  },
  {
    id: 'house-classic',
    name: 'House',
    genre: 'Dance',
    grid: {
      Kick: 'x...x...x...x...',
      Clap: '....x.......x...',
      /* ⚠️ the OFFBEAT open hat is the genre, and it only reads as one if the downbeats are
         left alone — the closed hat that used to fill them made sixteen hits of metal a bar */
      'Open hat': '..x...x...x...x.',
    },
  },
  {
    id: 'dance-breaks',
    name: 'Breakbeat',
    genre: 'Dance',
    grid: {
      Kick: 'x.....x...x.....',
      Snare: '....x.......x...',
      'Closed hat': 'x.x.x.x.x.x.x.x.',
    },
  },
  {
    id: 'funk-syncopated',
    name: 'Funk',
    genre: 'Funk',
    grid: {
      Kick: 'x..x..x...x..x..',
      Snare: '....x.......x...',
      'Closed hat': 'x.x.x.x.x.x.x.x.',
      Rim: '..x.......x.....',
    },
  },
  {
    id: 'funk-shuffle',
    name: 'Shuffle',
    genre: 'Funk',
    grid: {
      Kick: 'x.....x.....x...',
      Snare: '....x.......x...',
      'Closed hat': 'x..x..x..x..x..x',
    },
  },
  {
    id: 'jazz-ride',
    name: 'Swing',
    genre: 'Jazz',
    grid: {
      /* the ride is the pulse and the kick barely speaks — the opposite weighting to rock, which
         is most of why a rock kit playing jazz notes still sounds like rock */
      Ride: 'x..x.xx..x.xx..x',
      Kick: 'x...............',
      Rim: '....x.......x...',
    },
  },
  {
    id: 'reggae-onedrop',
    name: 'One drop',
    genre: 'Reggae',
    grid: {
      /* ⚠️ NOTHING ON BEAT ONE. That silence is the entire name of this one: the weight lands on
         three instead, and putting a kick at the top turns it back into every other beat here. */
      Kick: '........x.......',
      Rim: '........x.......',
      'Closed hat': '....x...x...x...',
    },
  },
  {
    id: 'latin-bossa',
    name: 'Bossa',
    genre: 'Latin',
    grid: {
      Kick: 'x..x..x...x..x..',
      Rim: '..x.x..x..x.x..x',
      'Closed hat': 'x.x.x.x.x.x.x.x.',
    },
  },
  {
    id: 'latin-samba',
    name: 'Samba',
    genre: 'Latin',
    grid: {
      Kick: 'x..x..x.x..x..x.',
      'Low tom': '....x.......x...',
      'Closed hat': 'x.x.x.x.x.x.x.x.',
      Cowbell: 'x.......x.......',
    },
  },
  {
    id: 'country-train',
    name: 'Train',
    genre: 'Country',
    grid: {
      Kick: 'x.......x.......',
      Snare: '..x...x...x...x.',
      'Closed hat': 'x.x.x.x.x.x.x.x.',
    },
  },
  {
    id: 'metal-double',
    name: 'Double kick',
    genre: 'Metal',
    grid: {
      Kick: 'xxxxxxxxxxxxxxxx',
      Snare: '....x.......x...',
      Crash: 'x.......x.......',
    },
  },
  {
    id: 'metal-gallop',
    name: 'Gallop',
    genre: 'Metal',
    grid: {
      Kick: 'x.xxx.xxx.xxx.xx',
      Snare: '....x.......x...',
      Ride: 'x.x.x.x.x.x.x.x.',
    },
  },
]

/** The genres, in the order they first appear, so the picker groups without a second list. */
export function drumGenres(): string[] {
  const seen: string[] = []
  for (const p of DRUM_PATTERNS) if (!seen.includes(p.genre)) seen.push(p.genre)
  return seen
}

/**
 * ⚠️ MIDDLE C AND UP, because the drum map repeats every octave (see DRUMS) — so the only thing
 * this choice decides is where the pattern SHOWS in the note editor, not what it sounds like.
 * Putting it where the roll already opens means the beat is on screen the moment you look at it.
 */
const BASE = 60

/**
 * A pattern as loop events, at this tempo.
 *
 * ⚠️ Sixteenths, and the take's length comes from the GRID rather than from the loop. A one-bar
 * beat in a four-bar song tiles, which is what the scheduler already does for any take shorter
 * than the loop — so a pattern does not need to know how long the song is, and the same pattern
 * works in a two-bar sketch and a sixteen-bar arrangement.
 */
export function patternEvents(p: DrumPattern, bpm: number): { events: LoopEvent[]; len: number } {
  const step = 60 / bpm / 4
  const steps = Math.max(...Object.values(p.grid).map((row) => (row ? row.length : 0)), 16)
  const events: LoopEvent[] = []
  for (const [piece, row] of Object.entries(p.grid)) {
    const idx = DRUMS.indexOf(piece)
    // a name that is not in the kit is a typo in the table above, and silence is the wrong
    // way to report it — but throwing would take the whole room down over one bad row
    if (idx < 0 || !row) continue
    const midi = BASE + idx
    for (let i = 0; i < row.length; i++) {
      if (row[i] !== 'x') continue
      const t = i * step
      events.push({ t, midi, on: true })
      /* ⚠️ A SHORT, FIXED TAIL. hitDrum ignores note-off entirely — a drum is a one-shot — so
         this length is never heard. It exists because every other part of the system pairs an on
         with an off: the packer, the file reader and the note editor all read takes as notes, and
         an unpaired note-on is the one shape they drop. */
      events.push({ t: t + Math.min(step * 0.9, 0.1), midi, on: false })
    }
  }
  events.sort((a, b) => a.t - b.t)
  return { events, len: steps * step }
}
