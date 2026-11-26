import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from 'react'
import { usePartyHere } from '../../party/whereEveryone'
import { currentRoute, hueFor, party, type PartyHere } from '../../party/party'
import { myPeerId, voiceSession } from '../../voice/voiceSession'
import { cursorMark, type CursorSkin } from '../../ui/cursorSkin'
import { hslToHex } from '../../theme/customTheme'
import { useMediaQuery } from '../../ui/media'
import { labSocial } from './social'
import { sharingNow } from './where'
import { CallChatButton } from './CallChatButton'
import { rescueFocus } from '../../gpu/focusRescue'
import { heldSeat } from './held'
import { hashParam } from '../links'
import {
  followStep,
  placeWords,
  summaryOf,
  surprise,
  tourOf,
  whyWords,
  type FollowStep,
  type Place,
  type Shadow,
} from './tour'

/**
 * The tour strip: everybody on your call, as a token on the Lab's board — who is on which toy,
 * who is with you, who is talking — with Go to open a friend's toy. The decisions are tour.ts's;
 * this only reads the call and draws the answer (docs/2026-11-22-lab-tour.md).
 *
 * ⚠️ IT OWNS ITS SUBSCRIPTIONS SO THE LAB DOES NOT. Who is talking flips several times a second in
 * a lively call, and the Lab above this is a 133-button picker around a toy that may be drawing at
 * 60fps; a speaking flip re-renders this strip and nothing else.
 */

/**
 * The call as one string, so React re-renders only when somebody joins, leaves, is renamed or
 * starts or stops talking — not on every change to the call's state (meters, streams). '' is "not
 * in a call". JSON rather than a delimiter: a name is whatever the other client sent, and a tab or
 * a newline in one would otherwise split a person in two.
 */
const callNow = () => {
  const v = voiceSession.getState()
  return v.inCall ? JSON.stringify(v.peers.map((p) => [p.id, p.name, p.speaking])) : ''
}
const onHash = (fn: () => void) => {
  window.addEventListener('hashchange', fn)
  return () => window.removeEventListener('hashchange', fn)
}
const onVisible = (fn: () => void) => {
  document.addEventListener('visibilitychange', fn)
  return () => document.removeEventListener('visibilitychange', fn)
}
const tabHidden = () => document.visibilityState !== 'visible'
/** viewing a saved match: the address carries `&match=`, and a move would rebuild it without */
const inMatchNow = () => !!hashParam('match')

export function TourStrip({
  current,
  toys,
  onGo,
  following,
  onFollow,
  onLead,
  filter,
  kindOf,
  rollable,
}: {
  /** the toy on your screen */
  current: string
  /** every toy your Lab lists, by id: only these can be gone to */
  toys: ReadonlyMap<string, string>
  /** open a toy, the way the picker does — a choice of your own, so it ends a follow */
  onGo: (toy: string) => void
  /** whom you are following, or null */
  following: string | null
  onFollow: (id: string | null) => void
  /** open a toy WITHOUT ending the follow: the move a follow makes */
  onLead: (toy: string) => void
  /** the kind the Lab's filter brings forward, or 'all', and each toy's kind: for 🎲 */
  filter: string
  kindOf: (toy: string) => string | undefined
  /** the toys listed for everybody — never one the owner hid, even on an admin's screen */
  rollable: readonly string[]
}) {
  const byRoute = usePartyHere()
  const verdict = useSyncExternalStore(labSocial.subscribe, labSocial.get, labSocial.get)
  const sharing = useSyncExternalStore(party.subscribe, sharingNow, sharingNow)
  const call = useSyncExternalStore(voiceSession.subscribe, callNow, callNow)
  const route = useSyncExternalStore(onHash, currentRoute, currentRoute)
  const wide = useMediaQuery('(min-width: 700px)')
  const [open, setOpen] = useState(false)
  const headId = useId()
  const listId = useId()
  /* a Go that goes away while it holds the focus — its friend moved, or stopped sharing — hands
     the focus on within the strip, the way the Lab's toys do (focusRescue.ts) */
  const stopRescue = useRef<(() => void) | null>(null)
  const watch = useCallback((el: HTMLElement | null) => {
    stopRescue.current?.()
    stopRescue.current = el ? rescueFocus(el) : null
  }, [])

  const here = useMemo(() => {
    const by: Record<string, PartyHere> = {}
    for (const p of Object.values(byRoute).flat()) by[p.id] = p
    return by
  }, [byRoute])
  const roster = useMemo(
    () =>
      call
        ? (JSON.parse(call) as [string, string, boolean][]).map(([id, name, speaking]) => ({
            id,
            name,
            speaking,
          }))
        : [],
    [call],
  )
  const tour = useMemo(() => {
    return tourOf({
      inCall: call !== '',
      onLabPage: route === 'lab',
      sharing,
      verdict,
      me: myPeerId(),
      roster,
      here,
      myToy: current,
      openable: (t) => toys.has(t),
    })
  }, [here, roster, call, route, sharing, verdict, current, toys])

  const toyName = (t: string) => toys.get(t) ?? t
  /* names of everybody seen on this call, kept after they go: "Ann left the call" is said about
     somebody who is, by then, no longer on the roster */
  const seenNames = useRef(new Map<string, string>())
  for (const p of roster) seenNames.current.set(p.id, p.name)
  const leaderName = (following && seenNames.current.get(following)) || 'your friend'
  const statusRef = useRef<HTMLParagraphElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const noteRef = useRef<HTMLParagraphElement>(null)
  const heldFocusRef = useRef(false)
  const why = tour?.why
  useLayoutEffect(() => {
    if (why && heldFocusRef.current && document.activeElement === document.body)
      noteRef.current?.focus({ preventScroll: true })
    heldFocusRef.current = false
  }, [why])
  const { step, said, follow } = useFollow({
    inCall: call !== '',
    onLabPage: route === 'lab',
    following,
    onFollow,
    onLead,
    leader: following ? here[following] : undefined,
    onRoster: !!following && roster.some((p) => p.id === following),
    gateOpen: verdict.allowed,
    sharing,
    current,
    toys,
    people: roster.length + 1,
    leaderName,
    statusRef,
  })

  /* what a screen reader hears: the follow starting, moving, offering and stopping — never the
     waits, which change as the leader wanders and would talk over the call. Rendered with the
     sentence as well as the strip, because the gate shutting is one of the things it announces. */
  const live = (
    <p className="sr-only" role="status">
      {said}
    </p>
  )

  /* ⚠️ THE FOCUS SURVIVES THE STRIP TURNING INTO A SENTENCE. A stranger joining shuts the gate, and
     the strip — with the Stop or Follow that had the focus — becomes one line; the focus would fall
     to the top of the page. Whether the strip held it is read as this render begins, while the old
     controls are still there, and the sentence takes it after the change: it says why the strip
     went. */
  heldFocusRef.current = !!wrapRef.current?.contains(document.activeElement)

  if (!tour) return null
  if (tour.why !== null) {
    const words = whyWords(tour.why, tour.names)
    return (
      <div className="lab-tour-wrap" ref={wrapRef}>
        {words && (
          <p className="lab-tour-note" tabIndex={-1} ref={noteRef}>
            {words}
          </p>
        )}
        {live}
      </div>
    )
  }

  const quiet = tour.people.every((p) => p.place.at === 'quiet')
  /* 🎲: a pick like the picker's, so it ends your own follow, and anybody following you comes */
  const dice = (
    <button
      className="btn btn-ghost lab-tour-dice"
      onClick={() => {
        const toy = surprise(rollable, current, kindOf, filter, Math.random)
        if (toy) onGo(toy)
      }}
    >
      🎲 Surprise us
    </button>
  )
  const n = tour.people.length
  const list = (
    <ul className="lab-tour-people" id={listId} hidden={!wide && !open}>
      <li className="lab-tour-one is-me">
        <Token id={tour.me} name="" place={{ at: 'with' }} speaking={false} me />
        <span className="lab-tour-who">
          <b className="lab-tour-name">You</b>
          <span className="lab-tour-at">on {toyName(current)}</span>
        </span>
      </li>
      {tour.people.map((p) => (
        <Chip
          key={p.id}
          p={p}
          toyName={toyName}
          onGo={onGo}
          followed={following === p.id}
          onFollow={() => follow(following === p.id ? null : p.id)}
        />
      ))}
    </ul>
  )

  const row = following && step && (
    <FollowRow
      step={step}
      name={leaderName}
      toyName={toyName}
      onGo={onLead}
      onStop={() => follow(null)}
      statusRef={statusRef}
    />
  )
  if (wide)
    return (
      <div className="lab-tour-wrap" ref={wrapRef}>
        <section className="lab-tour" aria-labelledby={headId} ref={watch}>
          <div className="lab-tour-head">
            <h3 className="fw-h lab-tour-title" id={headId}>
              👥 In the Lab with the call
            </h3>
            <span className="lab-tour-acts">
              {dice}
              <CallChatButton />
            </span>
          </div>
          {quiet && (
            <p className="lab-tour-quiet">
              Nobody else is showing where they are right now. Anyone who isn&apos;t sharing can
              press 🫱 in the call bar.
            </p>
          )}
          {row}
          {list}
          {live}
        </section>
      </div>
    )

  /* ⚠️ A PHONE GETS ONE ROW, NOT ONE ROW PER PERSON: above the kinds and a 133-toy picker, a
     strip of twelve 44px rows would push the toy itself two screens down. The line says where
     everybody is; the list is a press away. A button with aria-expanded rather than a <details>,
     because a closed fold hides its contents where no computed style can see it (CLAUDE.md §2). */
  return (
    <div className="lab-tour-wrap" ref={wrapRef}>
      <section className="lab-tour is-phone" aria-labelledby={headId} ref={watch}>
        <h3 className="sr-only" id={headId}>
          In the Lab with the call
        </h3>
        <div className="lab-tour-sum">
          <span className="lab-tour-stack" aria-hidden>
            {tour.people.slice(0, 4).map((p) => (
              <Token key={p.id} {...p} />
            ))}
            {n > 4 && <span className="lab-tour-more">+{n - 4}</span>}
          </span>
          <span className="lab-tour-line">
            {following ? `👣 Following ${leaderName}` : summaryOf(tour.people, toyName)}
          </span>
          <button
            className="btn btn-ghost lab-tour-toggle"
            aria-expanded={open}
            aria-controls={listId}
            aria-label={open ? 'Hide who is where' : `Show ${n} — who is where in the call`}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? 'Hide' : `Show ${n}`}
          </button>
        </div>
        {row}
        {open && (
          <div className="lab-tour-head">
            <span className="lab-tour-acts">
              {dice}
              <CallChatButton />
            </span>
          </div>
        )}
        {list}
        {live}
      </section>
    </div>
  )
}

function Chip({
  p,
  toyName,
  onGo,
  followed,
  onFollow,
}: {
  p: Shadow
  toyName: (toy: string) => string
  onGo: (toy: string) => void
  followed: boolean
  onFollow: () => void
}) {
  const at = p.place
  return (
    <li className="lab-tour-one">
      <Token {...p} />
      <span className="lab-tour-who">
        <b className="lab-tour-name">{p.name}</b>
        {/* the place ellipses and "talking" never does: it is the half of the talking signal
            that is not colour, so it cannot be the part a narrow chip cuts off */}
        <span className="lab-tour-at">
          <span className="lab-tour-place">{placeWords(at, toyName)}</span>
          {p.speaking && <span className="lab-tour-talking"> · talking</span>}
        </span>
      </span>
      {at.at === 'toy' && (
        <button
          className="btn btn-ghost lab-tour-go"
          aria-label={`Go to ${toyName(at.toy)}, where ${p.name} is`}
          onClick={() => {
            /* ⚠️ GO REMOVES ITSELF: on their toy, they are "with you" and Go is gone. So the focus
               goes first to that toy's button in the picker — pressed now, and still there —
               rather than falling to the top of the page with the button it was on. */
            document
              .querySelector<HTMLElement>(`.lab-picker button[data-toy="${CSS.escape(at.toy)}"]`)
              ?.focus()
            onGo(at.toy)
          }}
        >
          Go
        </button>
      )}
      {/* a name that says what pressing does, rather than aria-pressed AND a name that changes:
          "Follow Ann", then "Stop following Ann" — each holds the word on the button */}
      <button
        className={`btn btn-ghost lab-tour-follow${followed ? ' is-on' : ''}`}
        aria-label={followed ? `Stop following ${p.name}` : `Follow ${p.name}`}
        onClick={onFollow}
      >
        {followed ? 'Following' : 'Follow'}
      </button>
    </li>
  )
}

/** the follow row's words for a wait, an offer or a settled follow */
function rowWords(step: FollowStep, name: string, toyName: (t: string) => string): string {
  if (step.do === 'offer') {
    const why =
      step.why === 'seat'
        ? "You're in a game here, so you stayed."
        : step.why === 'match'
          ? "You're watching a match here, so you stayed."
          : step.why === 'playing'
            ? 'You were playing, so you stayed.'
            : 'You stayed.'
    return `${name} went to ${toyName(step.toy)}. ${why}`
  }
  if (step.do === 'wait')
    switch (step.why) {
      case 'quiet':
        return `Waiting for ${name}: they're not showing where they are right now.`
      case 'away':
        return `${name} is elsewhere on the site. You'll go when they're back on a toy.`
      case 'unsaid':
        return `${name} is in the Lab but isn't saying which toy.`
      case 'unopenable':
        return `${name} is on a toy that isn't in your Lab.`
      case 'settling':
        return `${name} is moving. You'll follow when they settle.`
      case 'crossed':
        return `You and ${name} swapped places. One of you will join the other in a moment.`
      default:
    }
  return `You'll go where ${name} goes. Pick a toy yourself to stop.`
}

function FollowRow({
  step,
  name,
  toyName,
  onGo,
  onStop,
  statusRef,
}: {
  step: FollowStep
  name: string
  toyName: (t: string) => string
  onGo: (toy: string) => void
  onStop: () => void
  statusRef: RefObject<HTMLParagraphElement | null>
}) {
  return (
    <div className="lab-tour-follow-row">
      {/* focusable, so a follow move that takes away the control you were on leaves you here
          rather than on the page (useFollow), and the words you land on say why */}
      <p className="lab-tour-follow-say" ref={statusRef} tabIndex={-1}>
        <b>👣 Following {name}.</b> {rowWords(step, name, toyName)}
      </p>
      <span className="lab-tour-follow-acts">
        {step.do === 'offer' && (
          <button
            className="btn btn-ghost lab-tour-go"
            aria-label={`Go to ${toyName(step.toy)} with ${name}`}
            onClick={() => onGo(step.toy)}
          >
            Go
          </button>
        )}
        <button
          className="btn btn-ghost lab-tour-go"
          aria-label={`Stop following ${name}`}
          onClick={onStop}
        >
          Stop
        </button>
      </span>
    </div>
  )
}

/**
 * Following somebody: tour.ts's followStep, asked again whenever anything it reads changes, and
 * once more when a settle runs out. It moves you through GpuLab's `show` (onLead), which keeps the
 * follow; any toy you pick yourself goes through `pick`, which ends it. Nothing is sent that a
 * pick would not send: a move is one `where`, the same as choosing the toy by hand.
 */
function useFollow(a: {
  inCall: boolean
  /** the Lab is the page: off it, a Lab still open in a canvas window is not touring */
  onLabPage: boolean
  following: string | null
  onFollow: (id: string | null) => void
  onLead: (toy: string) => void
  leader: PartyHere | undefined
  onRoster: boolean
  gateOpen: boolean
  sharing: boolean
  current: string
  toys: ReadonlyMap<string, string>
  people: number
  leaderName: string
  statusRef: RefObject<HTMLParagraphElement | null>
}) {
  const { inCall, onLabPage, following, onRoster, gateOpen, sharing, current, toys, people } = a
  const held = useSyncExternalStore(heldSeat.subscribe, heldSeat.get, heldSeat.get)
  const inMatch = useSyncExternalStore(onHash, inMatchNow, inMatchNow)
  const hidden = useSyncExternalStore(onVisible, tabHidden, tabHidden)
  const [step, setStep] = useState<FollowStep | null>(null)
  const [said, setSaid] = useState('')
  const [tick, setTick] = useState(0)
  /* kept between asks, never rendered: the press itself; the last press inside the toy; the toy
     already offered this move, and the offer as first made (so its reason stays on screen); the
     leader's toy when it last changed, and the last toy they actually named; and the toy your
     last follow move took you away from */
  const first = useRef(false)
  const lastPlay = useRef(-Infinity)
  const offered = useRef<string | null>(null)
  const lastOffer = useRef<Extract<FollowStep, { do: 'offer' }> | null>(null)
  const seen = useRef<{ who: string | null; sub: string | undefined; at: number }>({
    who: null,
    sub: undefined,
    at: 0,
  })
  const lastNamed = useRef<string | undefined>(undefined)
  const left = useRef<{ toy: string; at: number } | null>(null)
  /* whom the last ask was about, and whether the follow it ended was ended here — so a follow
     ended by a toy you picked yourself (GpuLab's pick, or a link) can say so */
  const was = useRef<string | null>(null)
  const endedHere = useRef(false)
  /* the latest callbacks and names, read by the effect without making it re-run on every render */
  const latest = useRef(a)
  latest.current = a

  const leaderRoute = a.leader?.route
  const leaderSub = a.leader?.sub

  /**
   * Pressing or typing inside the toy is playing it, and a follow offers rather than pulls you out.
   *
   * ⚠️ ON THE WINDOW, IN THE CAPTURE PHASE, AND ALWAYS — not on the document and only while
   * following. A toy that takes its keys on the window and stops them there never let them reach a
   * document listener, so its player was "not playing"; and a press made just before pressing
   * Follow is still playing. A key counts unless the focus is on a control outside the toy,
   * because the toys that listen on the window are played with the focus on the page — on the body,
   * or on the <main> the router focuses.
   */
  useEffect(() => {
    if (!inCall) return
    const on = (e: Event) => {
      const t = e.target instanceof Element ? e.target : null
      const f = document.activeElement
      const inToy = !!(t?.closest('.lab-toy') || f?.closest('.lab-toy'))
      const onAControl = !!f?.closest(
        'button, a[href], input, select, textarea, [contenteditable="true"], [role="button"]',
      )
      if (inToy || (e.type === 'keydown' && !onAControl && !!document.querySelector('.lab-toy')))
        lastPlay.current = performance.now()
    }
    window.addEventListener('pointerdown', on, true)
    window.addEventListener('keydown', on, true)
    return () => {
      window.removeEventListener('pointerdown', on, true)
      window.removeEventListener('keydown', on, true)
    }
  }, [inCall])

  useEffect(() => {
    if (!following) {
      if (!inCall) setSaid('')
      else if (was.current && !endedHere.current)
        setSaid("You picked a toy yourself, so you've stopped following.")
      was.current = null
      endedHere.current = false
      setStep(null)
      seen.current = { who: null, sub: undefined, at: 0 }
      lastNamed.current = undefined
      left.current = null
      lastOffer.current = null
      return
    }
    was.current = following
    /* the call is over, or the Lab is no longer the page: the call bar says the first, and a Lab
       left open in a canvas window over another page is not something to steer from out of sight */
    if (!inCall || !onLabPage) {
      endedHere.current = true
      latest.current.onFollow(null)
      return
    }
    const now = performance.now()
    const started = seen.current.who !== following
    if (started || seen.current.sub !== leaderSub)
      seen.current = { who: following, sub: leaderSub, at: now }
    /* ⚠️ A TOY DECLINED STAYS DECLINED UNTIL THE LEADER NAMES ANOTHER. A leader who hides their tab
       goes quiet and comes back on the same toy; that is not a move, and must not turn a toy you
       stayed out of into one you are taken to. */
    if (started || (leaderSub !== undefined && leaderSub !== lastNamed.current)) {
      offered.current = null
      lastOffer.current = null
    }
    if (leaderSub !== undefined) lastNamed.current = leaderSub
    const s = followStep({
      onRoster,
      gateOpen,
      sharing,
      leader: leaderRoute ? { route: leaderRoute, sub: leaderSub } : undefined,
      myToy: current,
      openable: (t) => toys.has(t),
      hidden,
      seated: held === current,
      inMatch,
      first: first.current,
      since: seen.current.at,
      now,
      people,
      lastPlay: lastPlay.current,
      offered: offered.current,
      left: left.current,
      goesFirst: (myPeerId() ?? '') < following,
    })
    /* the press is spent on its first ask, whatever that answered */
    first.current = false
    const { leaderName: name, onFollow, onLead, statusRef } = latest.current
    const toyName = (t: string) => toys.get(t) ?? t
    if (s.do === 'stop') {
      setStep(s)
      setSaid(
        s.why === 'left'
          ? `${name} left the call. You've stopped following.`
          : s.why === 'gate'
            ? "Toys are private in this call now. You've stopped following."
            : "You stopped sharing. You've stopped following.",
      )
      endedHere.current = true
      onFollow(null)
      return
    }
    if (s.do === 'offer') {
      /* an offer made once keeps its first words — "you're in a game here" — when it is asked
         again for a reason that has since gone */
      const shown = s.why === 'offered' && lastOffer.current?.toy === s.toy ? lastOffer.current : s
      setStep(shown)
      if (offered.current !== s.toy) {
        offered.current = s.toy
        lastOffer.current = s
        setSaid(`${name} went to ${toyName(s.toy)}. You stayed.`)
      }
      return
    }
    setStep(s)
    if (s.do === 'go') {
      /* ⚠️ THE FOCUS GOES SOMEWHERE THAT STAYS. A move remounts the toy, so a focused control
         inside it vanishes and the keyboard lands on the page; the follow row is focusable and
         says what just happened. Moved BEFORE the toy changes, so the Lab's focus rescue
         (focusRescue.ts) sees the focus already outside the toy and does not pull it back in.
         Only a KEYBOARD focus, and without scrolling: a mouse or a finger that last touched the
         toy is looking at the stage, and the rescue puts its focus on the new toy there. */
      const f = document.activeElement
      if (f?.closest('.lab-toy') && f.matches(':focus-visible'))
        statusRef.current?.focus({ preventScroll: true })
      left.current = { toy: current, at: now }
      onLead(s.toy)
      setSaid(`Following ${name} to ${toyName(s.toy)}.`)
      return
    }
    if (started) setSaid(`Following ${name}.`)
    if (s.at !== undefined) {
      const t = window.setTimeout(() => setTick((n) => n + 1), Math.max(0, s.at - now) + 5)
      return () => window.clearTimeout(t)
    }
  }, [
    inCall,
    onLabPage,
    following,
    onRoster,
    gateOpen,
    sharing,
    leaderRoute,
    leaderSub,
    current,
    toys,
    hidden,
    held,
    inMatch,
    people,
    tick,
  ])

  /** start or stop following: the press itself goes at once (followStep's `first`) */
  const follow = (id: string | null) => {
    first.current = id !== null
    offered.current = null
    lastOffer.current = null
    if (!id) {
      endedHere.current = true
      setSaid("You've stopped following.")
    }
    a.onFollow(id)
  }
  return { step, said, follow }
}

/**
 * Somebody's token: their colour (hueFor — the colour of their cursor, their ring on the nav and
 * their dot on the picker), their initial, and their cursor's shape in the corner, exactly as
 * PartyCursors draws it. Filled when they are with you, tinted when they are elsewhere, dashed
 * when they are saying nothing; you are a hollow ring. Talking is a ring AND a word in the chip,
 * never colour alone, and it does not move — there is nothing for reduced motion to flatten.
 */
function Token({
  id,
  name,
  skin,
  place,
  speaking,
  me = false,
}: {
  id: string
  name: string
  skin?: CursorSkin
  place: Place
  speaking: boolean
  me?: boolean
}) {
  const h = hueFor(id)
  const mark = skin ? cursorMark(skin, hslToHex({ h, s: 0.85, l: 0.58 })) : null
  const state = me ? 'me' : place.at === 'with' ? 'with' : place.at === 'quiet' ? 'quiet' : 'away'
  return (
    <span
      className={`lab-tour-token is-${state}${speaking ? ' is-talking' : ''}`}
      style={{ ['--h' as string]: h }}
      aria-hidden
    >
      {!me && (name.trim().charAt(0).toUpperCase() || '?')}
      {mark && <img className="lab-tour-skin" src={mark} alt="" width={12} height={12} />}
    </span>
  )
}
