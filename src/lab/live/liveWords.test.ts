import { describe, expect, it } from 'vitest'
import {
  ADD_COMPUTER,
  BACK_ON,
  CHOOSE_WHO,
  COMPUTER,
  CONNECTED,
  CONNECTING,
  DOOR_GAVE_UP,
  EMPTY_CHAIR,
  GATE_CLOSED,
  HEADING,
  LOST,
  LOST_ROUND,
  MOVE,
  ON_YOUR_OWN,
  OPEN_LINE,
  REFUSED,
  RELOAD,
  ROUND_BROKE,
  SERVER_DEALING,
  SIT,
  START,
  TAKE_OVER,
  TOGETHER,
  TRY_AGAIN,
  UNREACHABLE,
  VERSUS,
  WAKING_SAID,
  WATCHING_LINE,
  backWords,
  captainGoneWords,
  captainWords,
  chairName,
  computerChair,
  crossingDroppedWords,
  crossingEndedWords,
  hockeyDroppedWords,
  hockeyStandInWords,
  movedWords,
  moveToWords,
  needsCrewWords,
  needsTwoWords,
  needsWellsWords,
  offCallWords,
  refereeFooter,
  refereeWords,
  spadesStandInWords,
  spadesWaitWords,
  stackDroppedWords,
  stackToppedWords,
  startingLine,
  startingSaid,
  trailsDroppedWords,
  wakingWords,
  waitingWords,
  watchingWords,
  type View,
} from './liveWords'

/* the plan's cast, with the dev call's ids; Ann is reading, and Zed is somebody this browser never
   had a name for */
const BO = '00000000-0000-0000-0000-000000000001'
const ANN = '00000000-0000-0000-0000-000000000002'
const CY = '00000000-0000-0000-0000-000000000003'
const ZED = '00000000-0000-0000-0000-0000000000ff'
const NAMES: Record<string, string> = { [BO]: 'Bo', [ANN]: 'Ann', [CY]: 'Cy' }
const v: View = { me: ANN, name: (id) => NAMES[id] ?? null }
/** the same table as Bo reads it */
const bo: View = { ...v, me: BO }

describe('§1.1 where the table sits', () => {
  it('the heading', () => {
    expect(HEADING).toBe('Play together')
  })
  it('who is watching, at 0, 1 and 2: nothing vanishes at zero', () => {
    expect(watchingWords(0)).toBe('Nobody watching')
    expect(watchingWords(1)).toBe('1 watching')
    expect(watchingWords(2)).toBe('2 watching')
  })
})

describe('§1.2 step 1: the table, and the game server waking', () => {
  it('the table line and an empty chair', () => {
    expect(OPEN_LINE).toBe(
      'Friends on this call can play here together. Take a chair to play; anyone else watches.',
    )
    expect(`${EMPTY_CHAIR} · ${SIT}`).toBe('Empty · Sit')
  })
  it('the link line, connecting and then waking', () => {
    expect(CONNECTING).toBe('Connecting to the game server…')
    expect(WAKING_SAID).toBe('Waking the game server. This can take up to a minute.')
    expect(CONNECTED).toBe('Connected to the game server.')
    expect(`${UNREACHABLE} ${TRY_AGAIN} / ${ON_YOUR_OWN}`).toBe(
      "Couldn't reach the game server. Try again / Play on your own",
    )
  })
  it('the waking count, at 0, 1 and 2 seconds and past a minute', () => {
    const lead = 'Waking the game server — up to a minute on the free plan.'
    expect(wakingWords(0)).toBe(`${lead} 0:00`)
    expect(wakingWords(1000)).toBe(`${lead} 0:01`)
    expect(wakingWords(2000)).toBe(`${lead} 0:02`)
    // counted in whole seconds gone: 12.9 s is 0:12
    expect(wakingWords(12_900)).toBe(`${lead} 0:12`)
    expect(wakingWords(59_999)).toBe(`${lead} 0:59`)
    expect(wakingWords(69_000)).toBe(`${lead} 1:09`)
  })
})

describe('step 2: sitting down', () => {
  it('a chair says whether its person is in the game server’s room yet, its mark apart', () => {
    const shown = (c: ReturnType<typeof chairName>) => `${c.name} ${c.mark}`
    expect(shown(chairName(v, BO, false))).toBe('Bo ◌')
    expect(chairName(v, BO, false).sr).toBe('connecting')
    expect(shown(chairName(v, BO, true))).toBe('Bo ●')
    expect(chairName(v, BO, true).sr).toBe('')
    expect(shown(chairName(v, ZED, true))).toBe('A friend ●')
  })
  it('who sets the table, to them and to everybody else', () => {
    expect(captainWords(v, ANN)).toBe(
      'You set this table: you choose the mode and the teams, and you start.',
    )
    expect(captainWords(bo, ANN)).toBe('Ann set this table.')
    expect(captainWords(bo, ZED)).toBe('A friend set this table.')
  })
  it("the captain's controls", () => {
    expect([VERSUS, TOGETHER, ADD_COMPUTER, MOVE, START]).toEqual([
      '⚔️ Versus',
      '🤝 Together',
      '+ 🤖 Computer',
      'Move…',
      '▶ Start',
    ])
  })
})

describe('step 4: starting', () => {
  it('why not yet', () => {
    expect(waitingWords(v, BO)).toBe('Waiting for Bo to connect…')
    expect(waitingWords(v, ANN)).toBe('Waiting for you to connect…')
    expect(waitingWords(v, ZED)).toBe('Waiting for a friend to connect…')
    expect(needsWellsWords('Stackfall')).toBe(
      'Stackfall needs two wells: take a chair, or add a computer.',
    )
    expect(needsCrewWords('Night crossing')).toBe('Night crossing needs a pilot and a keeper.')
    expect(needsTwoWords('Air hockey')).toBe('Air hockey needs two players.')
  })
  it('the countdown on the line, at 0, 1, 2 and 3, its digits apart for aria-hidden', () => {
    const line = (s: number) => {
      const l = startingLine(s)
      return [l.before + l.digits + l.after, l.digits]
    }
    expect(line(3)).toEqual(['Starting in 3…', '3'])
    expect(line(2)).toEqual(['Starting in 2…', '2'])
    expect(line(1)).toEqual(['Starting in 1…', '1'])
    expect(line(0)).toEqual(['Starting…', ''])
  })
  it('the countdown said once, at 0, 1, 2 and 3', () => {
    expect(startingSaid(3)).toBe('Starting in 3 seconds.')
    expect(startingSaid(2)).toBe('Starting in 2 seconds.')
    expect(startingSaid(1)).toBe('Starting in 1 second.')
    expect(startingSaid(0)).toBe('Starting now.')
  })
})

describe('step 5: the captain goes', () => {
  it('left or stood, and who sets the table now', () => {
    expect(captainGoneWords(bo, ANN, 'left', BO)).toBe('Ann left, so you set the table now.')
    expect(captainGoneWords(v, CY, 'left', BO)).toBe('Cy left, so Bo sets the table now.')
    expect(captainGoneWords(v, CY, 'stood', BO)).toBe('Cy stood up, so Bo sets the table now.')
    expect(captainGoneWords(v, ANN, 'stood', BO)).toBe('You stood up, so Bo sets the table now.')
    expect(captainGoneWords(v, ZED, 'left', BO)).toBe('A friend left, so Bo sets the table now.')
  })
  it('with nobody left sitting there is no captain, and the table line says what is true', () => {
    expect(captainGoneWords(v, CY, 'left', null)).toBeNull()
  })
})

describe('step 6: watching', () => {
  it('the line, and a computer’s chair between rounds and during one', () => {
    expect(WATCHING_LINE).toBe("You're watching. Take an empty chair, or a computer's, to play.")
    expect(COMPUTER).toBe('🤖 Computer')
    expect(computerChair(false, false)).toEqual({ text: '🤖 Computer', button: 'Sit' })
    expect(computerChair(true, true)).toEqual({ text: '🤖 Computer', button: TAKE_OVER })
    expect(TAKE_OVER).toBe('Take over')
    expect(computerChair(true, false)).toEqual({ text: '🤖 Computer · next round', button: null })
  })
})

describe('step 7: moving people', () => {
  it('choosing, the chair’s button, and what everybody is told', () => {
    expect(CHOOSE_WHO).toBe('Choose who to move')
    expect(moveToWords(v, BO, 'North')).toEqual({ text: 'Move Bo here', named: 'Move Bo to North' })
    expect(moveToWords(v, BO, null)).toEqual({ text: 'Move Bo here', named: null })
    expect(moveToWords(v, ANN, 'North')).toEqual({
      text: 'Move yourself here',
      named: 'Move yourself to North',
    })
    expect(moveToWords(v, ZED, null)).toEqual({ text: 'Move a friend here', named: null })
    expect(movedWords(bo, ANN, BO, 'North')).toBe('Ann moved you to North.')
    expect(movedWords(v, ANN, BO, 'North')).toBe('You moved Bo to North.')
    expect(movedWords(v, CY, BO, 'North')).toBe('Cy moved Bo to North.')
    expect(movedWords(v, CY, CY, 'North')).toBe('Cy moved to North.')
    expect(movedWords(v, CY, BO, null)).toBe('Cy moved Bo to another chair.')
    expect(movedWords(v, ZED, BO, null)).toBe('A friend moved Bo to another chair.')
  })
})

describe('step 8: somebody drops mid-round, by toy', () => {
  it('Light trails', () => {
    expect(trailsDroppedWords(v, BO)).toBe('Bo dropped. Their rider rides straight on.')
  })
  it('Stackfall', () => {
    expect(stackDroppedWords(v, BO)).toBe('Bo dropped. Their well is paused for 30 s.')
    expect(stackToppedWords(v, BO)).toBe("Bo's well counts as topped out.")
    expect(stackToppedWords(v, ZED)).toBe("A friend's well counts as topped out.")
  })
  it('Air hockey', () => {
    expect(hockeyDroppedWords(v, BO)).toBe('Bo dropped. The game is paused for 20 s.')
    expect(hockeyStandInWords(v, BO)).toBe('A computer is playing for Bo until the game ends.')
  })
  it('Night crossing', () => {
    expect(crossingDroppedWords(v, BO)).toBe('Bo dropped. The crossing waits 30 s for them.')
    expect(crossingEndedWords(v, BO)).toBe("Bo didn't come back, so the crossing ended.")
  })
  it('Spades: the minute before the computer takes the chair, at 0, 1 and 2 seconds and at 42', () => {
    expect(spadesWaitWords(v, BO, 42_000)).toBe(
      'Waiting for Bo. The computer takes their chair in 0:42.',
    )
    expect(spadesWaitWords(v, BO, 60_000)).toBe(
      'Waiting for Bo. The computer takes their chair in 1:00.',
    )
    expect(spadesWaitWords(v, BO, 2000)).toBe(
      'Waiting for Bo. The computer takes their chair in 0:02.',
    )
    // rounded up: with 0.2 s to go, it has not taken the chair yet
    expect(spadesWaitWords(v, BO, 200)).toBe(
      'Waiting for Bo. The computer takes their chair in 0:01.',
    )
    expect(spadesWaitWords(v, BO, 1000)).toBe(
      'Waiting for Bo. The computer takes their chair in 0:01.',
    )
    expect(spadesWaitWords(v, BO, 0)).toBe('Waiting for Bo. The computer is taking their chair.')
    expect(spadesStandInWords(v, BO)).toBe("The computer is playing for Bo until they're back.")
  })
  it('back within the round', () => {
    expect(backWords(v, BO)).toBe('Bo is back.')
  })
})

describe('step 9: the referee', () => {
  it('said on a change, and the footer', () => {
    expect(refereeWords(v, CY)).toBe('Cy is running the game now.')
    expect(refereeWords(v, ANN)).toBe("You're running the game now.")
    expect(refereeFooter(v, ANN)).toBe('Your browser runs this game.')
    expect(refereeFooter(bo, ANN)).toBe("Ann's browser runs this game.")
    expect(refereeFooter(bo, ZED)).toBe("A friend's browser runs this game.")
    expect(SERVER_DEALING).toBe('The game server is dealing.')
  })
})

describe('step 10: the game server drops', () => {
  it('reconnecting, back, and a round lost', () => {
    expect(LOST).toBe('Lost the game server — reconnecting…')
    expect(BACK_ON).toBe('Back on the game server.')
    expect(LOST_ROUND).toBe(
      "The game server didn't come back, so this round was lost. The table is still here.",
    )
  })
})

describe('step 11: the door says no', () => {
  it('every refusal, in the plan’s words', () => {
    expect(REFUSED).toEqual({
      'not-friends': "You can't join this table: somebody at it isn't your friend on the site.",
      'door-unavailable': "Couldn't check who's at this table just now. Trying again…",
      'lab-full':
        'This table already has eight people connected, so you can see the call but not the game.',
      'lab-busy': 'The game server is full right now. Try again in a few minutes.',
      'members-only': 'Sign in to play at a table.',
      'rate-limited': 'Too many connections from here. Waiting a minute before trying again.',
      version: 'Somebody at this table is on a newer version of the Lab. Reload to play together.',
    })
    expect(DOOR_GAVE_UP).toBe("Couldn't check who's at this table.")
    expect(RELOAD).toBe('Reload')
  })
})

describe('steps 12–14', () => {
  it('a stranger joins, somebody on the game but off the call, and a round that throws', () => {
    expect(GATE_CLOSED).toBe('Toys are private in this call now, so the table has closed.')
    expect(offCallWords(v, CY)).toBe("Cy is connected to this game but isn't on the call.")
    expect(offCallWords(v, ZED)).toBe("A friend is connected to this game but isn't on the call.")
    expect(ROUND_BROKE).toBe(
      'Something went wrong in this round, so it stopped. The table is still here.',
    )
  })
})

describe('a name exactly as its owner wrote it', () => {
  /* review of 26 Nov 2026: every name above is three letters or fewer, with nothing in it but
     letters, so escaping an apostrophe or cutting a long name here would have passed. The roster
     cuts a name to 40 (§1); the words never cut, escape or rewrite one */
  const DARCY = '00000000-0000-0000-0000-0000000000da'
  const LONG = '00000000-0000-0000-0000-0000000000aa'
  const long = 'Maximiliana Bartholomew-Featherstonehaugh' // 41: the words pass on what they are given
  const names: View = {
    me: ANN,
    name: (id) => ({ [DARCY]: "D'Arcy", [LONG]: long, [CY]: 'O’Brien & <b>Co</b>' })[id] ?? null,
  }
  it('an apostrophe, a long name, and what would be markup, through every kind of sentence', () => {
    expect(long).toHaveLength(41)
    expect(stackToppedWords(names, DARCY)).toBe("D'Arcy's well counts as topped out.")
    expect(refereeFooter(names, DARCY)).toBe("D'Arcy's browser runs this game.")
    expect(spadesWaitWords(names, DARCY, 41_200)).toBe(
      "Waiting for D'Arcy. The computer takes their chair in 0:42.",
    )
    expect(chairName(names, LONG, true).name).toBe(long)
    expect(waitingWords(names, LONG)).toBe(`Waiting for ${long} to connect…`)
    expect(moveToWords(names, CY, 'North')).toEqual({
      text: 'Move O’Brien & <b>Co</b> here',
      named: 'Move O’Brien & <b>Co</b> to North',
    })
  })
})
