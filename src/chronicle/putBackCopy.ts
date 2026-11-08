import type { Putback } from './cloud'

/**
 * What putting a file back says, and how much it added.
 *
 * ⚠️ EVERY KIND A FILE CAN ADD COUNTS, and the sum used to be written out inline where nothing
 * could ask it a question. The marks and the day notes were taught this once; the sets and the
 * exercise links, which came later, were not — so a file that put back only a set said
 * "Everything in that file was already here", which is the wrong one of the two things this is
 * built to tell apart. A goal's weekday schedule is the one kind left out on purpose: it only ever
 * arrives with the goal it belongs to (chronicle_import refuses it for a goal already here), so
 * `goals` already counts it.
 *
 * ⚠️ COUNTED SEPARATELY from `skipped`, because "added 0" and "that file was already here" are
 * different things to be told and only one of them sounds like a failure. The same distinction the
 * Account page's own restore makes.
 */
export function putBackSays(got: Putback): { text: string; added: number } {
  const added =
    got.activities +
    got.entries +
    got.goals +
    got.routines +
    got.plans +
    got.marks +
    got.notes +
    got.sets +
    got.links
  const text = added
    ? `Added ${added} — ${got.entries} sessions, ${got.activities} activities, ${got.goals} goals` +
      `${got.marks ? `, ${got.marks} check-offs` : ''}${got.notes ? `, ${got.notes} notes` : ''}` +
      `${got.sets ? `, ${got.sets} sets` : ''}${got.links ? `, ${got.links} linked exercises` : ''}.`
    : got.skipped
      ? 'Everything in that file was already here'
      : 'There was nothing in that file'
  return { text, added }
}
