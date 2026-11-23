import { describe, expect, it } from 'vitest'
import { KNOBS, hopMs, listen, type Bus, type Rider } from './bus'
import {
  ALL_OFF,
  GATE_SHUT,
  HOPPED_OFF,
  JUST_FOR_FUN,
  NO_STAR_NOT_ON_BUS,
  PENDING,
  arrivedWords,
  busLine,
  capReachedWords,
  diceChoseWords,
  faceCard,
  finaleWords,
  followEndedWords,
  followOffWords,
  gameWords,
  guideGoneWords,
  heading,
  hopWords,
  leavingWords,
  offerWords,
  phaseLine,
  podiumWords,
  riderWords,
  saidOf,
  skippedWords,
  startedRow,
  startedWords,
  starLineWords,
  stopLogWords,
  twoStartsWords,
  type View,
} from './busWords'

/*
 * The plan's cast: Ann, Bo, Cy and Dee. Ids sort Bo < Ann < Cy < Dee, and Ann starts the tour, so
 * boarding order (Ann, Bo, Cy) is not id order and no sentence can pass by sorting.
 */
const BO = 'u1'
const ANN = 'u2'
const CY = 'u3'
const DEE = 'u4'
const NAMES: Record<string, string> = { [BO]: 'Bo', [ANN]: 'Ann', [CY]: 'Cy', [DEE]: 'Dee' }
const LAB: Record<string, string> = {
  fourrow: 'Four in a row',
  swarm: 'Swarm',
  paint: 'Paint',
  lamps: 'Lamps',
  chess: 'Chess',
  hex: 'Hex',
}
const NOW = 1_000_000
const rider = (id: string, over: Partial<Rider> = {}): Rider => ({
  id,
  on: true,
  stars: 0,
  played: 0,
  ...over,
})
const stop = (toy: string, over: Partial<Bus['stops'][number]> = {}) => ({
  toy,
  cap: 2 as const,
  games: [] as [number, number, number][],
  won: [] as number[],
  ...over,
})

/** a bus as `me` holds it: Ann's tour, three riders, nothing happened yet */
function busFor(me: string, over: Partial<Bus> = {}): Bus {
  return {
    ...listen(me, 0),
    seq: 9,
    from: BO,
    tour: 'tour0001',
    len: 5,
    riders: [rider(ANN), rider(BO), rider(CY)],
    guide: 0,
    phase: 'pick',
    openAt: NOW,
    freeAt: NOW + KNOBS.IDLE_MS,
    due: NOW + KNOBS.TOUR_IDLE_MS,
    heard: true,
    ...over,
  }
}
function view(me: string, over: Partial<Bus> = {}, v: Partial<View> = {}): View {
  return {
    bus: busFor(me, over),
    now: NOW,
    k: KNOBS,
    name: (id) => NAMES[id] ?? null,
    toy: (id) => LAB[id] ?? null,
    title: (id) => LAB[id] ?? (id === 'secret' ? 'Secret Garden' : null),
    roster: new Set([ANN, BO, CY, DEE]),
    present: new Set([ANN, BO, CY, DEE]),
    subOf: () => 'fourrow',
    myToy: 'swarm',
    seated: false,
    inMatch: false,
    consent: null,
    hopAt: null,
    people: 4,
    ...v,
  }
}
const text = (v: View) => phaseLine(v)?.text
const labels = (v: View) => phaseLine(v)?.buttons.map((b) => b.label)

describe('the tour starts (§1.2, 1–2)', () => {
  it('says who started it, to them and to everybody else', () => {
    expect(startedWords(view(ANN))).toBe(
      'You started a party tour: 5 stops, and everybody takes a turn to roll. You roll first.',
    )
    expect(startedWords(view(BO))).toBe(
      'Ann started a party tour: 5 stops, and everybody takes a turn to roll. Ann rolls first. When the bus picks a stop, press Take me there to come along.',
    )
    expect(startedWords(view(BO, {}, { stars: true }))).toBe(
      'Ann started a party tour: 5 stops, everybody takes a turn to roll, and a star for each game won at a stop. Ann rolls first. When the bus picks a stop, press Take me there to come along.',
    )
    expect(startedRow(view(BO))).toBe("🚌 Ann's party tour · Ann rolls first.")
    expect(heading(view(BO))).toBe('🚌 Party tour · 5 stops')
    expect(labels(view(ANN))).toEqual(['🎲 Roll', 'Hop off'])
    expect(labels(view(BO))).toEqual([])
  })
  it('a tour that lost to another started at the same moment', () => {
    const mine = busFor(ANN, { tour: 'tour0002', riders: [rider(ANN)] })
    const v = view(ANN, { riders: [rider(BO)] })
    expect(saidOf(mine, v)).toBe(twoStartsWords(v, BO))
    expect(twoStartsWords(v, BO)).toBe(
      "Two tours started at once; this one is Bo's. Press Take me there at the first stop to ride.",
    )
  })
})

describe('the roll (§1.2, 3)', () => {
  const faces = ['fourrow', 'swarm', 'paint'] as [string, string, string]
  it('the guide picks from three cards; everybody else is told what was rolled', () => {
    const ann = view(ANN, { phase: 'choose', faces })
    expect(text(ann)).toBe('You rolled. Pick the next stop:')
    expect(labels(ann)).toEqual(['Go to Four in a row', 'Go to Swarm', 'Go to Paint'])
    expect(faceCard(ann, 'fourrow').kind).toBe('a game for two at a table')
    expect(faceCard(ann, 'swarm').kind).toBe('a toy to look at')
    expect(faceCard(view(ANN, {}, { stars: true }), 'fourrow').star).toBe(
      '⭐ win a game here for a star',
    )
    expect(faceCard(view(ANN, {}, { stars: true }), 'paint').star).toBe('no star here')
    expect(text(view(BO, { phase: 'choose', faces }))).toBe(
      'Ann rolled Four in a row, Swarm and Paint and is choosing…',
    )
    expect(text(view(BO, { phase: 'choose', faces: ['secret', 'swarm', 'paint'] }))).toBe(
      "Ann rolled a toy that isn't in your Lab, Swarm and Paint and is choosing…",
    )
    expect(saidOf(busFor(ANN), view(ANN, { phase: 'choose', faces }))).toBe(
      'You rolled. Pick the next stop:',
    )
  })
  it('the dice choose for a guide who does not', () => {
    const v = view(BO, { phase: 'ready', toy: 'fourrow', ready: [] })
    expect(saidOf(busFor(BO, { phase: 'choose', faces }), v)).toBe(
      "Ann didn't choose, so the dice chose Four in a row.",
    )
    expect(diceChoseWords(v, ANN, 'fourrow')).toBe(
      "Ann didn't choose, so the dice chose Four in a row.",
    )
  })
})

describe('the ready check (§1.2, 4–5)', () => {
  /* stop 2 is boarding: Ann picked Four in a row three seconds ago */
  const ready = (over: Partial<Bus> = {}) => ({
    phase: 'ready' as const,
    toy: 'fourrow',
    ready: [0],
    readyAt: NOW - 3000,
    due: NOW + 12_000,
    stops: [stop('lamps')],
    ...over,
  })
  const yes = (n = 2) => ({ tour: 'tour0001', n, toy: 'fourrow', leaves: null })
  it('the guide, whose pick was their yes, gets Go now from five seconds', () => {
    const at0 = view(ANN, ready({ readyAt: NOW, due: NOW + 15_000 }), { consent: yes() })
    expect(text(at0)).toBe("You're going to Four in a row. 1 going so far. The bus leaves in 15 s.")
    expect(labels(at0)).toEqual(['Stay here'])
    const at5 = view(ANN, ready({ readyAt: NOW - 5000, due: NOW + 10_000 }), { consent: yes() })
    expect(labels(at5)).toEqual(['Go now', 'Stay here'])
  })
  it('a rider asked, a non-rider invited, and the yes saying what it costs', () => {
    const bo = view(BO, ready())
    expect(text(bo)).toBe('Next stop: Four in a row. Going? The bus leaves in 12 s.')
    expect(labels(bo)).toEqual(['🚌 Take me there', 'Not this one'])
    const dee = view(DEE, ready())
    expect(text(dee)).toBe(
      'Next stop: Four in a row. The bus leaves in 12 s. Press Take me there to come along.',
    )
    expect(labels(dee)).toEqual(['🚌 Take me there'])
    expect(labels(view(DEE, ready(), { seated: true }))).toEqual(['🚌 Leave my game and go'])
    expect(labels(view(DEE, ready(), { inMatch: true }))).toEqual(['🚌 Leave this match and go'])
  })
  it('nothing to press where there is nothing to do', () => {
    const here = view(DEE, ready(), { myToy: 'fourrow' })
    expect(text(here)).toBe("Next stop: Four in a row. You're already here.")
    expect(labels(here)).toEqual([])
    const lacking = view(DEE, ready({ toy: 'secret' }))
    expect(text(lacking)).toBe(
      "Next stop: a toy that isn't in your Lab, so you'll sit this one out.",
    )
    expect(labels(lacking)).toEqual([])
    const sixteen = Array.from({ length: 16 }, (_, i) => rider(`z${i}`))
    const full = view(DEE, ready({ riders: sixteen }))
    expect(text(full)).toBe('Next stop: Four in a row. The bus is full.')
    expect(labels(full)).toEqual([])
  })
  it('after a yes, and after a no — counts, never names', () => {
    const bo = view(BO, ready({ ready: [0, 1, 2], due: NOW + 9000 }), { consent: yes() })
    expect(text(bo)).toBe("You're going to Four in a row. 3 going so far. The bus leaves in 9 s.")
    expect(labels(bo)).toEqual(['Stay here'])
    /* this browser's own yes counts the moment it is pressed, before the host has heard it */
    const early = view(BO, ready({ ready: [0] }), { consent: yes() })
    expect(text(early)).toContain('2 going so far')
    const cy = view(CY, ready({ ready: [0, 1], no: [2] }))
    expect(text(cy)).toBe("You're staying here this stop. 2 going.")
    expect(labels(cy)).toEqual(['🚌 Take me there after all'])
    /* a no is an answer: the line above the toy stops asking */
    expect(busLine(cy)).toBeNull()
    /* nobody going says so: the count does not vanish at zero */
    expect(text(view(CY, ready({ ready: [], no: [2] })))).toBe(
      "You're staying here this stop. 0 going.",
    )
  })
  it('above the toy, for somebody scrolled down to it', () => {
    expect(busLine(view(BO, ready()))).toEqual({
      text: '🚌 Four in a row in 12 s',
      buttons: [{ act: 'take', label: 'Take me there' }],
    })
    const going = view(BO, ready({ due: NOW + 6000 }), { consent: yes() })
    expect(busLine(going)).toEqual({
      text: "🚌 You're going to Four in a row in 6 s",
      buttons: [{ act: 'stay', label: 'Stay here' }],
    })
  })
  it('following somebody ends when you take the bus, and the bus when you follow', () => {
    expect(followEndedWords('Cy')).toBe("You're on the bus, so you've stopped following Cy.")
    expect(followOffWords('Bo')).toBe('You hopped off the party tour to follow Bo.')
  })
})

describe('the bus leaves (§1.2, 6–7)', () => {
  /* stop 1 just left with Ann, Bo and Cy; the count ends in one second */
  const left = (over: Partial<Bus> = {}) => ({
    stops: [stop('fourrow')],
    went: [0, 1, 2],
    guide: 1,
    leaveAt: NOW + 1000,
    openAt: NOW + 1000 + 2 * 250 + KNOBS.DWELL_MS,
    freeAt: NOW + 1000 + 2 * 250 + KNOBS.DWELL_MS + KNOBS.IDLE_MS,
    ...over,
  })
  it('riders count down to their own hop', () => {
    const consent = { tour: 'tour0001', n: 1, toy: 'fourrow', leaves: null }
    const ann = view(ANN, left(), { consent, hopAt: NOW + 3000 })
    expect(text(ann)).toBe('Off to Four in a row in 3')
    expect(labels(ann)).toEqual(['Stay here'])
    const prev = busFor(ANN, { phase: 'ready', toy: 'fourrow', ready: [0, 1, 2] })
    expect(saidOf(prev, view(ANN, left({ leaveAt: NOW + 3000 }), { consent }))).toBe(
      'Leaving for Four in a row in 3 seconds.',
    )
    expect(leavingWords(ann, 'fourrow', 3000)).toBe('Leaving for Four in a row in 3 seconds.')
    expect(hopWords(ann, 'fourrow')).toBe('🚌 Off to Four in a row!')
    expect(arrivedWords(ann, 'fourrow', ['Ann', 'Bo'])).toBe(
      "You're at Four in a row, with Ann and Bo.",
    )
    expect(arrivedWords(ann, 'fourrow', [])).toBe("You're at Four in a row.")
  })
  it('somebody who did not press sees it go, and may come too until the last rider lands', () => {
    const dee = view(DEE, left())
    expect(text(dee)).toBe('The bus is leaving for Four in a row with 3 riders.')
    expect(labels(dee)).toEqual(['Come too'])
    const landing = NOW + 1000 + 3 * hopMs(4, 'fourrow')
    const after = view(DEE, left(), { ...{}, now: landing })
    expect(text(after)).toBe('The bus left for Four in a row with 3 riders.')
    expect(labels(after)).toEqual(['Catch up'])
    expect(text(view(DEE, left({ went: [0] })))).toBe(
      'The bus is leaving for Four in a row with 1 rider.',
    )
  })
  it('offered, never moved', () => {
    const v = view(BO)
    expect(offerWords(v, 'fourrow', 'seat').text).toBe(
      "The bus went to Four in a row. You're in a game here, so you stayed.",
    )
    expect(offerWords(v, 'fourrow', 'match').text).toBe(
      "The bus went to Four in a row. You're watching a match here, so you stayed.",
    )
    expect(offerWords(v, 'fourrow', 'away').text).toBe(
      'The bus went to Four in a row while you were away.',
    )
    expect(offerWords(v, 'fourrow', 'late').text).toBe('The bus already left for Four in a row.')
    expect(offerWords(v, 'fourrow', 'late').buttons.map((b) => b.label)).toEqual(['Catch up'])
    expect(offerWords(v, 'secret', 'unopenable')).toEqual({
      text: "The bus went to Secret Garden, which isn't in your Lab.",
      buttons: [],
    })
    expect(offerWords(v, 'newer-toy', 'unopenable').text).toBe(
      "The bus went to a toy that isn't in your Lab.",
    )
  })
})

describe('at the stop (§1.2, 8–9)', () => {
  /* everybody landed at Four in a row; Bo rolls next */
  const at = (over: Partial<Bus> = {}) => ({
    stops: [stop('fourrow')],
    went: [0, 1, 2],
    guide: 1,
    leaveAt: NOW - 30_000,
    openAt: NOW + 5000,
    holdUntil: NOW + 5000 + KNOBS.HOLD_MAX_MS,
    freeAt: NOW + 5000 + KNOBS.IDLE_MS,
    ...over,
  })
  const onIt = { myToy: 'fourrow' }
  it('the stop, for everybody there; the next guide is told it is nearly their turn', () => {
    expect(heading(view(CY, at(), onIt))).toBe('🚌 Party tour · stop 1 of 5: Four in a row')
    expect(text(view(CY, at(), onIt))).toBe(
      'Stop 1 of 5: Four in a row. Sit down and play. Bo rolls next.',
    )
    expect(text(view(CY, at({ stops: [stop('lamps'), stop('swarm')] }), { myToy: 'swarm' }))).toBe(
      'Stop 2 of 5: Swarm. Have a look around.',
    )
    const bo = view(BO, at(), onIt)
    expect(text(bo)).toBe("Your turn to roll next, once everyone's had a moment at Four in a row.")
    expect(busLine(bo)?.text).toBe('🚌 Your turn to roll soon')
    const open = view(BO, at({ openAt: NOW - 1 }), onIt)
    expect(text(open)).toBe('Your turn to roll.')
    expect(labels(open)).toEqual(['🎲 Roll'])
    expect(PENDING.roll).toBe('Rolling…')
    expect(PENDING.ready).toBe('Going…')
  })
  it('with stars: who is up next at the table, fewest games first', () => {
    const riders = [rider(ANN, { played: 2 }), rider(BO, { played: 1 }), rider(CY, { played: 0 })]
    expect(text(view(DEE, at({ riders }), { ...onIt, stars: true }))).toBe(
      'Stop 1 of 5: Four in a row. Win a game here for a star. Up next at the table: Cy and Bo.',
    )
    expect(text(view(CY, at({ riders }), { ...onIt, stars: true }))).toBe(
      "Stop 1 of 5: Four in a row. Win a game here for a star. You're up next with Bo: take a seat below.",
    )
  })
  it('the hold: the guide may roll anyway, the players are told to take their time', () => {
    const hold = at({ openAt: NOW - 1, holdUntil: NOW - 1 + KNOBS.HOLD_MAX_MS, busy: [0, 2] })
    const bo = view(BO, hold, onIt)
    expect(text(bo)).toBe(
      'Ann and Cy are still playing Four in a row. The bus waits for their game, up to 5 more minutes.',
    )
    expect(labels(bo)).toEqual(['🎲 Roll anyway'])
    expect(text(view(DEE, hold, onIt))).toBe(
      'The bus waits while Ann and Cy finish their game. Bo rolls next.',
    )
    const ann = view(ANN, hold, onIt)
    expect(text(ann)).toBe('The bus is waiting for your game. Take your time.')
    expect(busLine(ann)?.text).toBe('🚌 The bus waits for your game')
    expect(text(view(BO, { ...hold, holdUntil: NOW + 30_000 }, onIt))).toContain(
      'up to 1 more minute.',
    )
  })
  it('an idle guide: any rider here may roll for them', () => {
    const v = view(CY, at({ openAt: NOW - 50_000, freeAt: NOW - 1 }), onIt)
    expect(labels(v)).toEqual(['🎲 Roll for Bo'])
    expect(labels(view(DEE, at({ openAt: NOW - 50_000, freeAt: NOW - 1 }), onIt))).toEqual([])
  })
  it('the turn passing, and nobody taking the bus', () => {
    const v = view(DEE, at({ guide: 2 }))
    expect(saidOf(busFor(DEE, at()), v)).toBe("Bo isn't here, so it's Cy's turn to roll.")
    expect(guideGoneWords(v, BO, CY)).toBe("Bo isn't here, so it's Cy's turn to roll.")
    const prev = busFor(DEE, { phase: 'ready', toy: 'lamps', stops: [stop('fourrow')] })
    expect(saidOf(prev, view(DEE, at({ guide: 2 })))).toBe(
      "Nobody took the bus to Lamps, so it's Cy's turn.",
    )
    expect(skippedWords(v, 'lamps', CY)).toBe("Nobody took the bus to Lamps, so it's Cy's turn.")
  })
})

describe('a game ends (§1.2, 10)', () => {
  const v = view(DEE)
  it('says who won, once, and what a star it was', () => {
    expect(gameWords(v, 'fourrow', 'win', [ANN], true)).toBe('⭐ Ann won Four in a row!')
    expect(gameWords(view(ANN), 'fourrow', 'win', [ANN], true)).toBe('⭐ You won Four in a row!')
    expect(gameWords(v, 'fourrow', 'win', [ANN, CY], true)).toBe(
      '⭐ Ann and Cy beat the computer at Four in a row: a star each!',
    )
    expect(gameWords(view(ANN), 'fourrow', 'win', [CY, ANN], true)).toBe(
      '⭐ You and Cy beat the computer at Four in a row: a star each!',
    )
    expect(gameWords(v, 'fourrow', 'draw', [], true)).toBe('Four in a row was a draw: no star.')
    expect(gameWords(v, 'fourrow', 'cpu', [], true)).toBe(
      'The computer won Four in a row: no star.',
    )
    expect(NO_STAR_NOT_ON_BUS).toBe("No star for that game: the winner isn't on the bus.")
    expect(capReachedWords(view(DEE, { guide: 1 }), 'fourrow')).toBe(
      "That's all the stars at Four in a row. Bo rolls next.",
    )
    expect(JUST_FOR_FUN).toBe("That game was after this stop's stars, so it was just for fun.")
    expect(starLineWords(v, ANN, 'fourrow')).toBe('🚌 Ann won Four in a row: ⭐ +1 on the tour')
  })
})

describe('the end (§1.2, 12–13)', () => {
  const five = ['fourrow', 'swarm', 'lamps', 'chess', 'hex'].map((t) => stop(t))
  const last = { stops: five, guide: 1, openAt: NOW - 1, holdUntil: NOW + KNOBS.HOLD_MAX_MS }
  it('the last stop: the next guide opens the finale, and it waits for a game too', () => {
    const bo = view(BO, last, { myToy: 'hex' })
    expect(text(bo)).toBe('That was the last stop.')
    expect(labels(bo)).toEqual(['🏁 Finale'])
    const held = view(BO, { ...last, busy: [0, 2] }, { myToy: 'hex' })
    expect(text(held)).toBe(
      'Ann and Cy are still playing Hex. The finale waits for their game, up to 5 more minutes.',
    )
    expect(labels(held)).toEqual(['🏁 Finale anyway'])
    expect(text(view(CY, last, { myToy: 'hex' }))).toBe('Bo opens the finale.')
    expect(labels(view(CY, last, { myToy: 'hex' }))).toEqual([])
    expect(labels(view(CY, { ...last, freeAt: NOW - 1 }, { myToy: 'hex' }))).toEqual(['🏁 Finale'])
  })
  it('the finale: one winner, a tie, and no stars at all — never nothing', () => {
    const won = [
      rider(ANN, { stars: 1 }),
      rider(BO, { stars: 3 }),
      rider(CY, { stars: 1 }),
      rider(DEE, { stars: 0 }),
    ]
    const end = { phase: 'end' as const, stops: five, riders: won }
    expect(heading(view(DEE, end))).toBe('🏁 Party tour over')
    expect(finaleWords(view(DEE, end, { stars: true }))).toBe(
      '🏆 Bo wins the party tour with 3 ⭐!',
    )
    expect(finaleWords(view(BO, end, { stars: true }))).toBe('🏆 You win the party tour with 3 ⭐!')
    expect(podiumWords(view(DEE, end, { stars: true }))).toEqual([
      '🥇 Bo: 3 stars',
      '🥈 Ann and Cy: 1 star each',
      'Also riding: Dee',
    ])
    const tie = [rider(ANN, { stars: 2 }), rider(BO, { stars: 2 }), rider(CY)]
    expect(finaleWords(view(DEE, { ...end, riders: tie }, { stars: true }))).toBe(
      '🏆 Ann and Bo share the win with 2 ⭐ each!',
    )
    const none = [rider(ANN), rider(BO, { stars: null }), rider(CY)]
    expect(finaleWords(view(DEE, { ...end, riders: none }, { stars: true }))).toBe(
      'No stars this time: every stop was just for fun. Thanks for the tour!',
    )
    expect(finaleWords(view(DEE, end))).toBe(
      'That was the tour: Four in a row, Swarm, Lamps, Chess and Hex.',
    )
    expect(finaleWords(view(DEE, { ...end, stops: [] }))).toBe(
      'The tour ended before its first stop.',
    )
    expect(labels(view(DEE, end))).toEqual(['🚌 Another tour', 'Close'])
  })
  it('the stops, with winners where this browser knows them', () => {
    const stops = [
      stop('fourrow', { games: [[3, 0, 1]], won: [0] }),
      stop('swarm'),
      stop('lamps', { games: [[5, 0, 2]], won: [0, 2] }),
      stop('chess', { games: [[8, 1, 2]] }),
    ]
    expect(stopLogWords(view(DEE, { stops }))).toBe(
      'Four in a row: Ann ⭐ · Swarm · Lamps: Ann and Cy ⭐ · Chess: no star',
    )
  })
})

describe('leaving and pausing', () => {
  it('says what happened, and what you can still do', () => {
    expect(HOPPED_OFF).toBe(
      "You've hopped off the party tour. Press Take me there at any stop to hop back on.",
    )
    expect(ALL_OFF).toBe('Everyone got off the bus, so the tour is over.')
    const off = busFor(DEE, { riders: [rider(ANN, { on: false })], phase: 'end' })
    expect(saidOf(busFor(DEE), view(DEE, { riders: off.riders, phase: 'end' }))).toBe(ALL_OFF)
    expect(GATE_SHUT).toBe(
      'Toys are private in this call now, so the party tour is hidden. Your place on the bus is kept.',
    )
    const quiet = { quietSince: NOW - 5000 }
    expect(text(view(DEE, quiet))).toBe('The bus is waiting for Ann.')
    const gone = view(DEE, { quietSince: NOW - KNOBS.ABANDON_MS })
    expect(text(gone)).toBe('Nobody on the bus is here right now.')
    expect(labels(gone)).toEqual(['🚌 Start a party tour'])
  })
})

describe('the scoreboard', () => {
  it('a name, stars, the die, and whether they are still with us', () => {
    const riders = [
      rider(ANN, { stars: 2 }),
      rider(BO, { stars: 1, on: false }),
      rider(CY),
      rider('gone'),
    ]
    const v = view(DEE, { riders, guide: 2 }, { stars: true, roster: new Set([ANN, BO, DEE]) })
    expect(riderWords(v, 0)).toMatchObject({ name: 'Ann', stars: '⭐2', starsSr: '2 stars' })
    expect(riderWords(v, 0).lead).toBe(true)
    expect(riderWords(v, 1)).toMatchObject({
      stars: '⭐1',
      starsSr: '1 star',
      note: '(off the bus)',
    })
    expect(riderWords(v, 2)).toMatchObject({
      rolls: '🎲',
      rollsSr: ', rolls next',
      note: '(left the call)',
    })
    expect(riderWords(v, 3).name).toBe('a friend who left')
    /* nobody crowned at nought */
    const zero = view(DEE, {}, { stars: true })
    expect([0, 1, 2].map((i) => riderWords(zero, i).lead)).toEqual([false, false, false])
  })
})

describe('every phase, every role, has words', () => {
  it('nothing on screen is ever an empty line', () => {
    const roles: [string, Partial<View>][] = [
      [ANN, {}],
      [BO, {}],
      [CY, { myToy: 'fourrow' }],
      [DEE, {}],
      [DEE, { seated: true }],
      [BO, { consent: { tour: 'tour0001', n: 2, toy: 'fourrow', leaves: null } }],
      [BO, { consent: { tour: 'tour0001', n: 1, toy: 'fourrow', leaves: null }, hopAt: NOW + 900 }],
    ]
    const phases: Partial<Bus>[] = [
      {},
      { phase: 'choose', faces: ['fourrow', 'swarm', 'paint'] },
      { phase: 'ready', toy: 'fourrow', ready: [0], readyAt: NOW, due: NOW + 15_000 },
      { phase: 'ready', toy: 'secret', ready: [], readyAt: NOW, due: NOW + 15_000 },
      { phase: 'ready', toy: 'fourrow', ready: [], no: [1, 2], readyAt: NOW, due: NOW + 15_000 },
      { stops: [stop('fourrow')], went: [0, 1, 2], leaveAt: NOW + 500, openAt: NOW + 30_000 },
      { stops: [stop('fourrow')], went: [0, 1, 2], leaveAt: NOW - 9000, openAt: NOW + 9000 },
      { stops: [stop('fourrow')], guide: 1, openAt: NOW - 1, freeAt: NOW + 9 },
      { stops: [stop('fourrow')], guide: 1, openAt: NOW - 1, freeAt: NOW - 1 },
      {
        stops: [stop('fourrow')],
        guide: 1,
        openAt: NOW - 1,
        busy: [0],
        holdUntil: NOW + 99_000,
      },
      { stops: ['a', 'b', 'c', 'd', 'fourrow'].map((t) => stop(t)), guide: 1, openAt: NOW - 1 },
      { phase: 'end', stops: [stop('fourrow')] },
      { phase: 'end' },
      { quietSince: NOW - 1 },
      { quietSince: NOW - KNOBS.ABANDON_MS },
    ]
    let seen = 0
    for (const p of phases)
      for (const [me, over] of roles)
        for (const stars of [false, true]) {
          const v = view(me, p, { ...over, stars })
          const line = phaseLine(v)!
          expect([me, p, line.text.trim().length > 0]).toEqual([me, p, true])
          for (const b of line.buttons) expect(b.label.trim()).not.toBe('')
          expect(heading(v)).not.toBe('')
          const above = busLine(v)
          if (above) expect(above.text.startsWith('🚌')).toBe(true)
          seen++
        }
    expect(seen).toBe(phases.length * roles.length * 2)
    /* and no tour is no line at all: the strip's own Start is the whole of it */
    expect(phaseLine(view(DEE, { tour: '' }))).toBeNull()
  })
})
