/**
 * How many Realtime messages this browser sends and receives in a call — the number the social
 * Lab plan put before cursors launch (docs/2026-11-13-lab-social-plan.md, Cost).
 *
 * ⚠️ ONE BROWSER'S VIEW. Supabase meters a message per client it reaches, plus the send, so the
 * whole call's bill is roughly everyone's (sent + received) added up; four people seeing similar
 * figures means about four times one of them. It counts the party (cursors, pages, rooms) and the
 * call's own signalling, because both ride the same channel and the same quota.
 *
 * Pure counting, so meter.test.ts can ask it about rates without a call.
 */
export type Meter = {
  since: number
  sent: number
  received: number
  bytes: number
  byKind: Record<string, number>
}
export const newMeter = (now: number): Meter => ({
  since: now,
  sent: 0,
  received: 0,
  bytes: 0,
  byKind: {},
})
export function countMessage(m: Meter, dir: 'sent' | 'received', kind: string, bytes: number) {
  m[dir]++
  m.bytes += bytes
  m.byKind[kind] = (m.byKind[kind] ?? 0) + 1
}
export function readMeter(m: Meter, now: number) {
  const total = m.sent + m.received
  const secs = (now - m.since) / 1000
  const perMinute = secs >= 1 ? Math.round((total / secs) * 60) : null
  return {
    sent: m.sent,
    received: m.received,
    bytes: m.bytes,
    byKind: { ...m.byKind },
    seconds: Math.round(secs),
    perMinute,
    perHour: perMinute === null ? null : perMinute * 60,
  }
}
export type MeterReading = ReturnType<typeof readMeter>
