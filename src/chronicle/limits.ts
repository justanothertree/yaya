/**
 * The longest each Chronicle box may be, which is the longest the TABLE will store: the CHECK
 * constraints on chronicle_activities, chronicle_goals and chronicle_routines. limits.test.ts
 * reads each number back out of the schema, so this cannot drift from it quietly.
 *
 * ⚠️ WHY THE BOXES NEED IT: the save functions let the table refuse a value that is too long, and
 * the room shows a refusal word for word, so typing a 61-character activity name showed the member
 * `new row for relation "chronicle_activities" violates check constraint …` (measured in db guards
 * run 42825583418). A box that stops at the limit means the sentence is never reached.
 *
 * `maxLength` counts UTF-16 units while `char_length` counts characters, so an emoji uses two here
 * and one there. That makes the box slightly stricter than the table, never looser, which is the
 * direction that cannot let through something the server refuses.
 */
export const LIMIT = {
  /** an activity's or a routine's name */
  name: 60,
  /** what an activity or a goal counts in */
  unit: 16,
  goalTitle: 120,
  /** the "why, if it helps" line under a goal */
  goalNote: 2000,
  /**
   * A routine step's minutes. The server holds a step at 600, but it read the digits as an
   * integer first, so ten or more of them overflowed. Four digits is any number of minutes that
   * means anything, and nothing a person types into four digits can overflow.
   */
  stepMinsDigits: 4,
} as const
