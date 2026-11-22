/**
 * Where in the song a recording belongs.
 *
 * Evan, 21 Nov 2026: "vocal takes and voice clips always start at the beginning of the song. A
 * take must land exactly where the song's playhead was when I started recording, so I can play
 * the song, listen along, and record over any part (punch in) and have it line up. Account for
 * recording latency so takes aren't late."
 *
 * They always started at the beginning because nothing asked: the recorder never read the
 * transport, and putting a take on the loop called `placeTake(id)` with no position, which is 0.
 *
 * ⚠️ THE PLAYHEAD WHEN THE FIRST SAMPLE WAS TAKEN, LESS THE ROUND TRIP. Somebody singing along
 * sings to what they HEAR, and they hear a moment of the song `outputLatency` after the audio clock
 * reached it; their voice then takes the input path's own latency to reach the recorder. So the
 * sound that arrives at the recorder at audio time T was sung against the song at T − (output +
 * input latency). Placed at the raw playhead, every punch-in would sound that much late.
 *
 * ⚠️ READ WHEN THE RECORDER STARTED, NOT WHEN THE BUTTON WAS PRESSED. The microphone prompt can
 * be open for seconds between the two, and the song plays on meanwhile.
 *
 * Pure, so it can be asked a question without a microphone.
 */

/** What the recorder knew when its first sample was taken. */
export type RecordStart = {
  /** the audio clock when the recorder actually began */
  startedAt: number
  /** output latency plus input latency, in seconds: how far behind the song a voice arrives */
  lag: number
}

/** The song's transport, read as the recording began. */
export type Transport = {
  playing: boolean
  /** where the loop began, on the audio clock (looper.loopOrigin) */
  origin: number
  /** the length of one pass of the song, in seconds */
  len: number
  /** the length of one beat, in seconds */
  beat: number
}

/**
 * Seconds into the song where this recording's first sample belongs, to the millisecond, or null
 * when the song was not playing (there was no playhead to land on).
 *
 * A recording begun in the second pass lands where it was sung in that pass. One begun so close to
 * the top that the round trip reaches back before it lands at 0: its first moments are the end of
 * the pass before, which a placement cannot express.
 */
export function punchIn(r: RecordStart, t: Transport): number | null {
  if (!t.playing || !(t.len > 0) || !Number.isFinite(r.startedAt)) return null
  const sung = r.startedAt - Math.max(0, r.lag) - t.origin
  if (!(sung > 0)) return 0
  const at = sung % t.len
  return Math.round(at * 1000) / 1000
}

/**
 * How far behind the song a voice reaches the recorder, from what the browser reports.
 *
 * `outputLatency` is the time from the audio clock to the speaker; `baseLatency` is only the
 * context's own buffer, so it stands in when the first is not reported (Safari). The input side is
 * the microphone track's own `latency` setting where the browser gives one (Chrome does), and
 * nothing where it does not: a guess there would be a guess. Bounded, because a value past half a
 * second is a broken report, not a latency, and would move the take further than anybody sang.
 */
export function roundTrip(
  ctx: { outputLatency?: number; baseLatency?: number },
  input?: number,
): number {
  const out = Number.isFinite(ctx.outputLatency)
    ? (ctx.outputLatency as number)
    : Number.isFinite(ctx.baseLatency)
      ? (ctx.baseLatency as number)
      : 0
  const inp = Number.isFinite(input) ? (input as number) : 0
  return Math.min(0.5, Math.max(0, out) + Math.max(0, inp))
}

/** Where a kept recording goes: its place in the song, and how much of its start to leave out. */
export type Landing = { at: number; skip: number }

/**
 * Where a recording of `recLen` seconds goes, or null when the song was not playing or nothing of it
 * is left once its pre-roll is taken off.
 *
 * ⚠️ PRESSING RECORD JUST BEFORE THE SONG COMES ROUND IS THE COMMONEST PUNCH-IN, and it is the one
 * the plain playhead gets wrong. Somebody who wants to sing from bar 1 presses 🎤 in the last bar,
 * so the first sample lands in the last moments of the pass, and a take is cut at the end of each
 * pass: placed there it played the breath before the downbeat and none of the singing. So a
 * recording begun in the last beat of a pass that runs on past it lands at the top, with the part
 * before the downbeat left out (`skip`). The same holds for one begun during a count-in, before the
 * first top: what came before the downbeat is left out and it lands on beat one, never late.
 */
export function landing(r: RecordStart, t: Transport, recLen: number): Landing | null {
  const at = punchIn(r, t)
  if (at === null) return null
  const sung = r.startedAt - Math.max(0, r.lag) - t.origin
  let land: Landing
  if (!(sung > 0)) land = { at: 0, skip: -sung }
  else {
    const room = t.len - at
    land =
      room <= t.beat && recLen > room
        ? { at: 0, skip: room }
        : /* a place that rounds to the very end of the pass would play nothing */
          { at: at >= t.len ? 0 : at, skip: 0 }
  }
  land.skip = Math.round(land.skip * 1000) / 1000
  /* nothing sung after the downbeat: nothing to place */
  return land.skip >= recLen ? null : land
}

/**
 * Which of the takes on the loop a new one at [from, to) is sung over, unmuted, so the new one is
 * heard alone where it was recorded and the older attempts stay on the loop, muted, to compare.
 */
export function sungOver(
  placed: readonly { id: string; at: number; dur: number; muted?: boolean }[],
  from: number,
  to: number,
): string[] {
  return placed.filter((t) => !t.muted && t.at < to && t.at + t.dur > from).map((t) => t.id)
}
