import { describe, expect, it } from 'vitest'
import { KNOBS, hopMs, listen, type Bus, type Rider } from './bus'
import {
  ABOUT_TO_LEAVE,
  ALL_OFF,
  GATE_SHUT,
  HOPPED_OFF,
  JUST_FOR_FUN,
  NO_STAR_NOT_ON_BUS,
  PENDING,
  SHARING_OFF,
  STALLED,
  arrivedWords,
  busLine,
  capReachedWords,
  diceChoseWords,
  faceCard,
  finaleWords,
  followEndedWords,
  followOffWords,
  missedWords,
  gameWords,
  guideGoneWords,
  heading,
  leavingSaid,
  hopWords,
  leavingWords,
  lineWith,
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
  startedAtOnceWords,
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

/** a bus as `me` holds it: Ann's tour, three riders, nothing happened yet, its last state just in */
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
    stateAt: NOW,
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
    expect(saidOf(mine, v)).toBe(startedAtOnceWords(v, BO))
    expect(startedAtOnceWords(v, BO)).toBe(
      "More than one tour started at once; this one is Bo's. Press Take me there at the first stop to ride.",
    )
  })
  it('however many tours started at once, nothing said to a starter counts them wrong', () => {
    const NUMBER: Record<string, number> = { two: 2, three: 3, four: 4, five: 5 }
    const counted = (s: string) => {
      const m = /\b(two|three|four|five)\s+tours?\b/i.exec(s)
      return m ? NUMBER[m[1].toLowerCase()] : null
    }
    /* every order the other tours can reach a starter in */
    const orders = (xs: string[]): string[][] =>
      xs.length <= 1
        ? [xs]
        : xs.flatMap((x, i) => orders(xs.filter((_, j) => j !== i)).map((o) => [x, ...o]))
    for (const n of [2, 3, 4]) {
      const starters = [BO, ANN, CY, DEE].slice(0, n)
      /* each starter's own fresh tour; the lower starter's wins (bus.ts's beats) */
      const tourOf = (starter: string): Partial<Bus> => ({
        tour: `tour000${starters.indexOf(starter) + 1}`,
        from: starter,
        seq: 1,
        riders: [rider(starter)],
      })
      for (const me of starters) {
        const said: string[] = []
        for (const order of orders(starters.filter((s) => s !== me))) {
          let held = me
          for (const s of order) {
            if (s > held) continue
            const v = view(me, tourOf(s))
            const words = saidOf(busFor(me, tourOf(held)), v)
            if (words) said.push(words)
            held = s
          }
        }
        if (me !== BO) expect(said.length).toBeGreaterThan(0)
        for (const s of said) expect([n, me, s, counted(s)]).toEqual([n, me, s, counted(s) && n])
      }
    }
  })
})

describe('the roll (§1.2, 3)', () => {
  const faces = ['fourrow', 'swarm', 'paint'] as [string, string, string]
  /* the guide's own roll, as the state that carried it showed (bus.ts's guideRolled) */
  const rolled = { phase: 'choose' as const, faces, guideRolled: true }
  it('the guide picks from three cards; everybody else is told what was rolled', () => {
    const ann = view(ANN, rolled)
    expect(text(ann)).toBe('You rolled. Pick the next stop:')
    expect(labels(ann)).toEqual(['Go to Four in a row', 'Go to Swarm', 'Go to Paint'])
    expect(faceCard(ann, 'fourrow').kind).toBe('a game for two at a table')
    expect(faceCard(ann, 'swarm').kind).toBe('a toy to look at')
    expect(faceCard(view(ANN, {}, { stars: true }), 'fourrow').star).toBe(
      '⭐ win a game here for a star',
    )
    expect(faceCard(view(ANN, {}, { stars: true }), 'paint').star).toBe('no star here')
    expect(text(view(BO, rolled))).toBe(
      'Ann rolled Four in a row, Swarm and Paint and is choosing…',
    )
    expect(text(view(BO, { ...rolled, faces: ['secret', 'swarm', 'paint'] }))).toBe(
      "Ann rolled a toy that isn't in your Lab, Swarm and Paint and is choosing…",
    )
    expect(saidOf(busFor(ANN), view(ANN, rolled))).toBe('You rolled. Pick the next stop:')
  })
  it('a roll somebody made for an idle guide is never said to be the guide’s own', () => {
    /* Bo idled past freeAt; the roll came after it, so anybody on the bus may have made it */
    const late = { ...rolled, guide: 1, guideRolled: false }
    expect(text(view(BO, late))).toBe('Somebody rolled for you. Pick the next stop:')
    expect(saidOf(busFor(BO, { guide: 1 }), view(BO, late))).toBe(
      'Somebody rolled for you. Pick the next stop:',
    )
    expect(text(view(ANN, late, { rolled: true }))).toBe(
      'You rolled Four in a row, Swarm and Paint for Bo, and Bo is choosing…',
    )
    expect(text(view(DEE, late))).toBe(
      'Somebody rolled Four in a row, Swarm and Paint for Bo, and Bo is choosing…',
    )
    /* Bo's own roll after idling is still his, said so by his own browser */
    expect(text(view(BO, late, { rolled: true }))).toBe('You rolled. Pick the next stop:')
    /* known to be the guide's own: the plan's sentences */
    const own = { ...rolled, guide: 1 }
    expect(text(view(BO, own))).toBe('You rolled. Pick the next stop:')
    expect(text(view(DEE, own))).toBe('Bo rolled Four in a row, Swarm and Paint and is choosing…')
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
    /* each answer carries the departure and the toy it was drawn for: stop 2, Four in a row */
    expect(busLine(view(BO, ready()))).toEqual({
      text: '🚌 Four in a row in 12 s',
      buttons: [{ act: 'take', label: 'Take me there', n: 2, toy: 'fourrow' }],
    })
    const going = view(BO, ready({ due: NOW + 6000 }), { consent: yes() })
    expect(busLine(going)).toEqual({
      text: "🚌 You're going to Four in a row in 6 s",
      buttons: [{ act: 'stay', label: 'Stay here', n: 2, toy: 'fourrow' }],
    })
  })
  it('a yes for another toy at the same departure is not a yes to this one', () => {
    /* Bo said yes to Four in a row for stop 2, and that window was skipped; now it is Hex */
    const stale = { consent: yes() }
    const bo = view(BO, ready({ toy: 'hex' }), stale)
    expect(text(bo)).toBe('Next stop: Hex. Going? The bus leaves in 12 s.')
    expect(labels(bo)).toEqual(['🚌 Take me there', 'Not this one'])
    expect(busLine(bo)).toEqual({
      text: '🚌 Hex in 12 s',
      buttons: [{ act: 'take', label: 'Take me there', n: 2, toy: 'hex' }],
    })
    /* and nobody is counted going who is not: Bo's stale yes is not one of the two */
    const going = view(BO, ready({ toy: 'hex', ready: [0, 2], no: [1] }), stale)
    expect(text(going)).toBe("You're staying here this stop. 2 going.")
  })
  it('a press the bus moved past says so', () => {
    expect(missedWords(view(BO), 'hex')).toBe(
      "Too late for Hex: the bus had moved on, so you're staying here.",
    )
    expect(missedWords(view(BO), 'secret')).toBe(
      "Too late for a toy that isn't in your Lab: the bus had moved on, so you're staying here.",
    )
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
    /* a departure heard after its count ran out is not "leaving in 0 seconds" (seen on the dev
       call): it has gone, and what is said is what the line shows */
    expect(saidOf(prev, view(ANN, left({ leaveAt: NOW }), { consent }))).toBe(
      'The bus already left for Four in a row.',
    )
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
    /* Come too carries the stop it was drawn for: stop 1, Four in a row */
    expect(phaseLine(dee)?.buttons).toEqual([
      { act: 'come', label: 'Come too', n: 1, toy: 'fourrow' },
    ])
  })
  it('a yes kept from a window that was skipped is not a yes to the stop the bus went to', () => {
    /* Dee said yes to Four in a row for stop 1; that window was skipped, and the bus went to Hex */
    const stale = { consent: { tour: 'tour0001', n: 1, toy: 'fourrow', leaves: null } }
    const dee = view(DEE, left({ stops: [stop('hex')] }), stale)
    expect(text(dee)).toBe('The bus is leaving for Hex with 3 riders.')
    expect(labels(dee)).toEqual(['Come too'])
    const counting = view(DEE, left({ stops: [stop('hex')] }), { ...stale, hopAt: NOW + 900 })
    expect(text(counting)).toBe('The bus is leaving for Hex with 3 riders.')
  })
  it('an offer stands until the next stop, and gives way to a turn', () => {
    /* Bo stayed in his game at stop 1 and was offered; the turn then passed to him */
    const offer = { key: 'tour0001:1', toy: 'fourrow', why: 'seat' as const }
    const stayed = left({ leaveAt: NOW - 9000, openAt: NOW - 1, freeAt: NOW + KNOBS.IDLE_MS })
    expect(lineWith(view(CY, stayed), offer)?.text).toBe(
      "The bus went to Four in a row. You're in a game here, so you stayed.",
    )
    const bo = view(BO, stayed)
    expect(lineWith(bo, offer)?.text).toBe('Your turn to roll.')
    expect(lineWith(bo, offer)?.buttons.map((x) => x.label)).toEqual(['🎲 Roll'])
    /* about another stop, or already there: the phase line */
    expect(lineWith(view(CY, stayed), { ...offer, key: 'tour0001:2' })?.text).toBe(
      text(view(CY, stayed)),
    )
    expect(lineWith(view(CY, stayed, { myToy: 'fourrow' }), offer)?.text).toBe(
      text(view(CY, stayed, { myToy: 'fourrow' })),
    )
    /* past the stop's own phase the offer is done: the next roll, the next window, the end */
    const choosing = view(CY, {
      ...stayed,
      phase: 'choose',
      faces: ['hex', 'swarm', 'paint'],
      guideRolled: true,
    })
    expect(lineWith(choosing, offer)?.text).toBe('Bo rolled Hex, Swarm and Paint and is choosing…')
    const unlisted = view(CY, { ...stayed, phase: 'ready', toy: 'secret', due: NOW + 9000 })
    expect(lineWith(unlisted, offer)?.text).toBe(
      "Next stop: a toy that isn't in your Lab, so you'll sit this one out.",
    )
    const ended = view(CY, { ...stayed, phase: 'end' })
    expect(lineWith(ended, offer)?.text).toBe(text(ended))
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
    const hold = at({ openAt: NOW - 1, holdUntil: NOW - 1 + KNOBS.HOLD_MAX_MS, busy: [2, 0] })
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
  it('the first window skipped: the turn has passed before any stop, and every line says whose', () => {
    const passed = { guide: 1 }
    expect(text(view(BO, passed))).toBe('Your turn to roll.')
    expect(labels(view(BO, passed))).toEqual(['🎲 Roll'])
    /* Ann started it, and is told whose turn it is now rather than that she rolls first */
    expect(text(view(ANN, passed))).toBe("The party tour hasn't made a stop yet. Bo rolls next.")
    expect(text(view(DEE, passed))).toBe("The party tour hasn't made a stop yet. Bo rolls next.")
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
    /* busy in the order the sits reached the host; said in turn order (found on the dev call) */
    const held = view(BO, { ...last, busy: [2, 0] }, { myToy: 'hex' })
    expect(text(held)).toBe(
      'Ann and Cy are still playing Hex. The finale waits for their game, up to 5 more minutes.',
    )
    expect(labels(held)).toEqual(['🏁 Finale anyway'])
    expect(text(view(CY, last, { myToy: 'hex' }))).toBe('Bo opens the finale.')
    expect(labels(view(CY, last, { myToy: 'hex' }))).toEqual([])
    expect(labels(view(CY, { ...last, freeAt: NOW - 1 }, { myToy: 'hex' }))).toEqual(['🏁 Finale'])
  })
  it('the last stop during its dwell: no Finale yet, because the host would refuse it', () => {
    /* found on the dev call: the guide pressed 🏁 Finale the moment they landed and nothing
       happened — the host refuses `fin` until the dwell is over, as it does a roll */
    const dwell = view(BO, { ...last, openAt: NOW + 1000 }, { myToy: 'hex' })
    expect(text(dwell)).toBe(
      "That was the last stop. You open the finale once everyone's had a moment at Hex.",
    )
    expect(labels(dwell)).toEqual([])
    expect(text(view(CY, { ...last, openAt: NOW + 1000 }, { myToy: 'hex' }))).toBe(
      'Bo opens the finale.',
    )
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
    expect(SHARING_OFF).toBe(
      'You stopped sharing, so the party tour is hidden. Your place on the bus is kept.',
    )
    /* nobody on the bus here: Dee alone on the Lab, as tick has it whenever quietSince runs */
    const alone = { present: new Set([DEE]) }
    const quiet = { quietSince: NOW - 5000 }
    expect(text(view(DEE, quiet, alone))).toBe('The bus is waiting for Ann.')
    const gone = view(DEE, { quietSince: NOW - KNOBS.ABANDON_MS }, alone)
    expect(text(gone)).toBe('Nobody on the bus is here right now.')
    expect(labels(gone)).toEqual(['🚌 Start a party tour'])
    expect(busLine(gone)).toBeNull()
  })
  it('a tour nobody is driving says so, with Start, in every phase (bus.ts’s liveness bound)', () => {
    expect(STALLED).toBe('The bus has stalled: nobody is driving it.')
    /* given up while nobody was here, and Ann back on a page that holds nothing: she is here, so
       "Nobody on the bus is here" would be untrue */
    const back = view(DEE, { quietSince: NOW - KNOBS.ABANDON_MS })
    expect(text(back)).toBe(STALLED)
    expect(labels(back)).toEqual(['🚌 Start a party tour'])
    /* no state that moved it on, heard here for STALL_MS, Ann here — whatever its own deadline
       says: ten minutes off between stops, a few seconds off in a roll or a window, or long gone */
    const phases: [string, Partial<Bus>][] = [
      ['between stops', { stops: [stop('lamps')], due: NOW + KNOBS.TOUR_IDLE_MS }],
      ['a roll', { phase: 'choose', faces: ['fourrow', 'hex', 'chess'], due: NOW + 4000 }],
      ['a window', { phase: 'ready', toy: 'fourrow', ready: [0], due: NOW + 4000 }],
      ['a window long out', { phase: 'ready', toy: 'fourrow', ready: [0], due: NOW - 60_000 }],
    ]
    const quiet = (over: Partial<Bus>, ms: number) =>
      view(DEE, { readyAt: (over.due ?? NOW) - KNOBS.READY_MS, ...over, stateAt: NOW - ms })
    for (const [what, over] of phases) {
      const dead = quiet(over, KNOBS.STALL_MS)
      expect([what, text(dead)]).toEqual([what, STALLED])
      expect([what, labels(dead)]).toEqual([what, ['🚌 Start a party tour']])
      expect([what, busLine(dead)]).toEqual([what, null])
      /* a moment before, the tour as it was: no Start, and not the stalled line */
      const nearly = quiet(over, KNOBS.STALL_MS - 1)
      expect([what, text(nearly) === STALLED]).toEqual([what, false])
      expect([what, labels(nearly)?.includes('🚌 Start a party tour')]).toEqual([what, false])
    }
    /* a window long out with a state heard a second ago is the bus as somebody drives it: not by due */
    expect(text(quiet(phases[3][1], 1000))).toBe(
      'Next stop: Four in a row. The bus is about to leave… Press Take me there to come along.',
    )
    /* nobody on the bus here either: the plainer sentence, which is true */
    expect(
      text(view(DEE, quiet(phases[0][1], KNOBS.STALL_MS).bus, { present: new Set([DEE]) })),
    ).toBe('Nobody on the bus is here right now.')
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
      /* stalled: nothing heard of it for STALL_MS (bus.ts's liveness bound) */
      {
        phase: 'ready',
        toy: 'fourrow',
        ready: [],
        readyAt: NOW - 60_000,
        due: NOW - 30_000,
        stateAt: NOW - KNOBS.STALL_MS,
      },
      { stops: [stop('fourrow')], stateAt: NOW - KNOBS.STALL_MS },
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

describe('a count that has run out with no departure heard', () => {
  /*
   * A host gone silent mid-window stays on the Lab until the party's sweep, so for 10–15 s nothing
   * arrives: the window's time is up on every screen and the bus has not left. Swept through the
   * whole window and past it, for every viewer the window has, the line never says the bus leaves
   * in a time that has already passed — and once it is out, it says one thing and holds it, so a
   * screen reader reading it hears it once, not a new sentence every second.
   */
  const yes = { tour: 'tour0001', n: 2, toy: 'fourrow', leaves: null }
  const viewers: [string, string, Partial<View>, Partial<Bus>][] = [
    ['the guide, going', ANN, { consent: yes }, {}],
    ['a rider asked', BO, {}, {}],
    ['a non-rider invited', DEE, {}, {}],
    ['a rider going, with the host gone quiet', BO, { consent: yes }, { ready: [0, 1] }],
  ]
  it('never "0 s", and one sentence from the moment it is out until the bus moves', () => {
    for (const [who, me, v, over] of viewers) {
      const due = NOW + 3000
      const at = (now: number) =>
        view(
          me,
          {
            phase: 'ready',
            toy: 'fourrow',
            ready: [0],
            readyAt: due - KNOBS.READY_MS,
            due,
            stops: [stop('lamps')],
            ...over,
          },
          { ...v, now },
        )
      const out = new Set<string>()
      const above = new Set<string>()
      for (let now = due - 2750; now <= due + 15_000; now += 250) {
        const line = phaseLine(at(now))!.text
        const top = busLine(at(now))!.text
        const left = Math.ceil((due - now) / 1000)
        if (now < due) {
          /* the count, as it was: a whole second, and never less than one */
          expect([who, now - due, line]).toEqual([
            who,
            now - due,
            expect.stringContaining(`The bus leaves in ${left} s.`),
          ])
          expect([who, now - due, top]).toEqual([
            who,
            now - due,
            expect.stringContaining(` ${left} s`),
          ])
        } else {
          expect([who, now - due, line]).toEqual([
            who,
            now - due,
            expect.stringContaining(ABOUT_TO_LEAVE),
          ])
          out.add(line)
          above.add(top)
        }
        expect([who, now - due, line]).toEqual([
          who,
          now - due,
          expect.not.stringMatching(/\b0 s\b/),
        ])
        expect([who, now - due, top]).toEqual([
          who,
          now - due,
          expect.not.stringMatching(/\b0 s\b/),
        ])
      }
      expect([who, [...out]]).toEqual([who, [expect.any(String)]])
      expect([who, [...above]]).toEqual([who, [expect.stringMatching(/^🚌 .*about to leave…$/)]])
    }
  })
  it('in the words of the plan, a sentence each', () => {
    expect(ABOUT_TO_LEAVE).toBe('The bus is about to leave…')
    const late = (me: string, v: Partial<View> = {}, over: Partial<Bus> = {}) =>
      view(
        me,
        {
          phase: 'ready',
          toy: 'fourrow',
          ready: [0],
          readyAt: NOW - 20_000,
          due: NOW - 5000,
          stops: [stop('lamps')],
          ...over,
        },
        v,
      )
    expect(text(late(ANN, { consent: yes }))).toBe(
      "You're going to Four in a row. 1 going so far. The bus is about to leave…",
    )
    expect(text(late(BO))).toBe('Next stop: Four in a row. Going? The bus is about to leave…')
    expect(text(late(DEE))).toBe(
      'Next stop: Four in a row. The bus is about to leave… Press Take me there to come along.',
    )
    expect(busLine(late(DEE))?.text).toBe('🚌 Four in a row: about to leave…')
    expect(busLine(late(BO, { consent: yes }))?.text).toBe(
      "🚌 You're going to Four in a row: about to leave…",
    )
  })
})

describe('"about to leave", said to a screen reader once (Evan, 27 Nov 2026)', () => {
  /*
   * "Yes, screen readers announce 'About to leave…' once." The window swept at 250 ms well past its
   * end, each moment asked twice (a render that changes nothing), with what the hook keeps handed
   * back each time: the sentences the status region would be given are what is counted.
   *
   * ⚠️ NOT AT THE ZERO ITSELF. Every viewer but the host reaches the zero before the departure does:
   * the state saying the bus left can wait a STATE_GAP_MS in the host's Outbox and then crosses the
   * wire (bus.test.ts's property runs it at up to 150 ms a link). Said at the zero it would be heard
   * at nearly every stop, about a bus that is leaving — so it waits until no departure from a host
   * still sending could be on its way.
   */
  const due = NOW + 3000
  const yes = { tour: 'tour0001', n: 2, toy: 'fourrow', leaves: null }
  const at =
    (me: string, v: Partial<View> = {}, over: Partial<Bus> = {}) =>
    (now: number) =>
      view(
        me,
        {
          phase: 'ready',
          toy: 'fourrow',
          ready: [0],
          readyAt: due - KNOBS.READY_MS,
          due,
          stops: [stop('lamps')],
          ...over,
        },
        { ...v, now },
      )
  /** every sentence said and when, relative to the zero, from just before the window ends to `to` */
  const sweep = (views: (now: number) => View, to = due + 15_000) => {
    let told: string | null = null
    const said: [number, string][] = []
    for (let now = due - 2750; now <= to; now += 250)
      for (let again = 0; again < 2; again++) {
        const r = leavingSaid(told, views(now))
        told = r.told
        if (r.text) said.push([now - due, r.text])
      }
    return said
  }
  const LATEST_DEPARTURE = KNOBS.STATE_GAP_MS + 150
  it('once, to everybody whose line says it, once no departure could still be arriving', () => {
    const viewers: [string, (now: number) => View][] = [
      ['the guide, going', at(ANN, { consent: yes })],
      ['a rider asked', at(BO)],
      ['a non-rider invited', at(DEE)],
      ['a rider going, with the host gone quiet', at(BO, { consent: yes }, { ready: [0, 1] })],
    ]
    for (const [who, views] of viewers) {
      const said = sweep(views)
      expect([who, said.map(([, t]) => t)]).toEqual([who, [ABOUT_TO_LEAVE]])
      /* after a departure held its whole gap and sent over the slowest wire, and soon after that */
      expect([who, said[0][0] > LATEST_DEPARTURE]).toEqual([who, true])
      expect([who, said[0][0] <= 2 * KNOBS.STATE_GAP_MS + 250]).toEqual([who, true])
      /* and the line said the same words when it was: the status never says what the screen does not */
      expect([who, text(views(due + said[0][0]))]).toEqual([
        who,
        expect.stringContaining(said[0][1]),
      ])
    }
  })
  it('never to a viewer whose line does not say it', () => {
    const full = Array.from({ length: KNOBS.MAX_RIDERS }, (_, i) => rider(`r${i}`))
    for (const [who, views] of [
      ['staying here this stop', at(BO, {}, { no: [1] })],
      ['already there', at(DEE, { myToy: 'fourrow' })],
      ['a toy not in your Lab', at(DEE, {}, { toy: 'secret' })],
      ['the bus full', at(DEE, {}, { riders: full })],
    ] as const)
      expect([who, sweep(views)]).toEqual([who, []])
  })
  it('not at all for a window that leaves before its zero, or whose departure arrives in time', () => {
    const left = (when: number) => (now: number) =>
      now < due + when
        ? at(DEE)(now)
        : view(DEE, { phase: 'pick', stops: [stop('lamps'), stop('fourrow')], went: [0] }, { now })
    /* Go now, or everybody answered: gone a second before the zero */
    expect(sweep(left(-1000))).toEqual([])
    /* the departure held its whole gap in the host's Outbox, then the slowest wire */
    expect(sweep(left(LATEST_DEPARTURE))).toEqual([])
  })
  it('a state of the same window heard after the zero does not say it again', () => {
    /* a re-sent state has nought left: `due` and `readyAt` move to when it arrived, the window does not */
    const resent = (now: number) =>
      now < due + 4000
        ? at(DEE)(now)
        : at(DEE, {}, { due: due + 4000, readyAt: due + 4000 - KNOBS.READY_MS, seq: 10 })(now)
    expect(sweep(resent).map(([, t]) => t)).toEqual([ABOUT_TO_LEAVE])
  })
  it('a window of its own each time: the same toy rolled again at the same departure, after a skip', () => {
    /* the skip, the roll and the pick are separate states — the guide's two requests are a second
       apart at the least (ASK_GAP_MS) — so a screen sees the phase leave ready between the two */
    const second = due + 30_000
    /* each a state heard as it began, as the decider's beat would have it (bus.ts's stalled) */
    const views = (now: number) =>
      now < due + 6000
        ? at(DEE)(now)
        : now < second - KNOBS.READY_MS
          ? view(
              DEE,
              {
                phase: 'choose',
                faces: ['fourrow', 'hex', 'chess'],
                stops: [stop('lamps')],
                stateAt: due + 6000,
              },
              { now },
            )
          : at(
              DEE,
              {},
              { due: second, readyAt: second - KNOBS.READY_MS, stateAt: second - KNOBS.READY_MS },
            )(now)
    const said = sweep(views, second + 8000)
    expect(said.map(([, t]) => t)).toEqual([ABOUT_TO_LEAVE, ABOUT_TO_LEAVE])
    expect(said[1][0]).toBeGreaterThan(second - due)
  })
})
