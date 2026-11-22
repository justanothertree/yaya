import { useCallback, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react'
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
import { placeWords, summaryOf, tourOf, whyWords, type Place, type Shadow } from './tour'

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

export function TourStrip({
  current,
  toys,
  onGo,
}: {
  /** the toy on your screen */
  current: string
  /** every toy your Lab lists, by id: only these can be gone to */
  toys: ReadonlyMap<string, string>
  /** open a toy, the way the picker does */
  onGo: (toy: string) => void
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

  const tour = useMemo(() => {
    const here: Record<string, PartyHere> = {}
    for (const p of Object.values(byRoute).flat()) here[p.id] = p
    const roster = call
      ? (JSON.parse(call) as [string, string, boolean][]).map(([id, name, speaking]) => ({
          id,
          name,
          speaking,
        }))
      : []
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
  }, [byRoute, call, route, sharing, verdict, current, toys])

  if (!tour) return null
  if (tour.why !== null) {
    const words = whyWords(tour.why, tour.names)
    return words ? <p className="lab-tour-note">{words}</p> : null
  }

  const toyName = (t: string) => toys.get(t) ?? t
  const quiet = tour.people.every((p) => p.place.at === 'quiet')
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
        <Chip key={p.id} p={p} toyName={toyName} onGo={onGo} />
      ))}
    </ul>
  )

  if (wide)
    return (
      <section className="lab-tour" aria-labelledby={headId} ref={watch}>
        <div className="lab-tour-head">
          <h3 className="fw-h lab-tour-title" id={headId}>
            👥 In the Lab with the call
          </h3>
          <CallChatButton />
        </div>
        {quiet && (
          <p className="lab-tour-quiet">
            Nobody else is showing where they are right now. Anyone who isn&apos;t sharing can press
            🫱 in the call bar.
          </p>
        )}
        {list}
      </section>
    )

  /* ⚠️ A PHONE GETS ONE ROW, NOT ONE ROW PER PERSON: above the kinds and a 133-toy picker, a
     strip of twelve 44px rows would push the toy itself two screens down. The line says where
     everybody is; the list is a press away. A button with aria-expanded rather than a <details>,
     because a closed fold hides its contents where no computed style can see it (CLAUDE.md §2). */
  return (
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
        <span className="lab-tour-line">{summaryOf(tour.people, toyName)}</span>
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
      {open && (
        <div className="lab-tour-head">
          <CallChatButton />
        </div>
      )}
      {list}
    </section>
  )
}

function Chip({
  p,
  toyName,
  onGo,
}: {
  p: Shadow
  toyName: (toy: string) => string
  onGo: (toy: string) => void
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
    </li>
  )
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
