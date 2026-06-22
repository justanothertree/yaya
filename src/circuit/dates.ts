// Local calendar dates. IMPORTANT: do NOT use new Date().toISOString() for "today" —
// that's UTC, so in the evening (timezones behind UTC) it returns tomorrow's date, which
// then mismatches the local dates the user logs against. These format the *local* date.

/** Local YYYY-MM-DD for a given date. */
export function localISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Today as a local YYYY-MM-DD. */
export function todayISO(): string {
  return localISO(new Date())
}

/** This month as a local YYYY-MM. */
export function todayMonth(): string {
  return todayISO().slice(0, 7)
}
