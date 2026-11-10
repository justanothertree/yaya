/**
 * A Circuit cell the server refused for a reason it can name — a total below the day's sessions, or
 * a save made against figures that moved while it was being typed (OPEN-DECISIONS §19g).
 *
 * ⚠️ ITS OWN CLASS SO THE STORE CAN SAY THE REASON. Every other failed write reads as "check your
 * connection", because most of them are; these are not, and the reason is the fix — "sessions count
 * 12 on that day — lower them in Chronicle" tells somebody exactly where to go.
 */
export class CellRefused extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CellRefused'
  }
}
