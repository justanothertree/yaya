# A claim on a Circuit person is a request an admin answers (OPEN-DECISIONS §19e)

✅ **APPLIED to production 22 Nov 2026 at 6:39 PM EST** as migration `circuit_claims_need_approval`,
version 20261122233938, with Evan's approval ("Apply both"). Check A matched every text it was
written against; Check B matched all nine texts, the grants, an unchanged owners fingerprint and a
deny-all empty table; production's md5 of what it ran is the record file's body. Live, as a member
in a transaction that rolled back: This is me left the person unclaimed with one pending request,
the asker could not write its days, the admin list said "admin only" to them, and an owner handing
their board on was refused in words while the ordinary save still worked.

Evan's answer of 22 Nov: _"If you build a draft, start with admin approval (unambiguous), and treat
'the person confirms from their own account' as the claimed person confirming in a separate step,
not via claim_person, which cannot confirm itself. Ask before any production SQL. Do not move
anyone's log on an unverified claim."_

## What was wrong: four ways in, not one

§19e named `claim_person`. Counting the write paths to `circuit_people.owner_user_id` found four,
and none checks that the account is the person:

| Door                                       | Today                                                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| **This is me** (`claim_person`)            | any member of a circuit the person is in becomes the owner at once, first come                          |
| **Add me** (`add_self_to_circuit`)         | a typed name adopts an unclaimed person of that name in the circuit                                     |
| **Join with a code** (`_circuit_add_self`) | your first name, which you set yourself, adopts an unclaimed person of that name                        |
| **The table itself**                       | the update policy asks only whether you own the row now, so an owner can set `owner_user_id` to anybody |

Owning a person is owning the whole log: `circuit_can_edit_person` lets the owner edit or delete
every day of it, and the profile readers show it as theirs. The adapter's own comment said the
policies stopped the fourth door; they stop it on INSERT only.

**Measured, not argued.** CI run 45079301551 ran the new test against the functions as they are,
and it named every door: the asker became the owner and could write the person's logs; joining
adopted a same-name person; Add me adopted one; an owner handed their board to another account.

## What the draft does

`docs/applied/2026-11-22-circuit-claims-need-approval.DRAFT.sql`:

- **`circuit_person_claims`**, deny-all like every member table (RLS on, no policy, no grant):
  who asked for which person, through which door, and the answer.
- **The three doors write a request and set no owner.** The rule about who may ask is unchanged
  (an unclaimed person in a circuit you are in), and so is its refusal. Asking twice is one
  request. Add me and joining no longer make a blank board beside the person they matched; once an
  admin says no, or the member withdraws, Add me passes that person over and makes them a board of
  their own.
- **The fourth door is a trigger**: a change of owner from a member's own UPDATE is refused unless
  they are an admin. The board's ordinary save sends the same owner back, and that still works.
- **`admin_decide_person_claim`** is the only new way an owner is set. Approving one request
  declines the others for that person. It refuses a person who has an owner by now, and an asker
  who is suspended. The person row is locked first, so two approvals queue rather than both land.
- **A member** sees their own requests (`my_person_claims`) and can withdraw a pending one. Another
  member's request reads exactly like one that does not exist.
- **The admin** sees what is waiting (`admin_list_person_claims`): whose board, who asked and how,
  how many days it holds, which circuits the two share now, and whether the asker put the person
  into a circuit themselves. Nothing of the log itself.

A declined request is final for that account and that person. If an admin says no by mistake, the
correction is the admin's own direct write, which is unchanged.

**The screens** (same PR): the member's list says Waiting, with Withdraw, or "An admin said no"; Add
me says "Asked to be Linda. An admin will confirm it" when that is what happened; a circuit with a
request waiting does not offer Add me beside it. The admin panel gets a **Circuit claims** tab
whose badge counts what is waiting, and Approve and Decline each ask once more, naming the days
that would change hands. `#dev-admin` shows both lists with invented people. **The screens must
ship after the apply, not before:** before it, "an admin will confirm it" would be untrue.

## Not in it

- **The claimed person confirming from their own account.** A later step of its own, and never
  through `claim_person`. The shape it would take: somebody proposes "this person is @them", and
  @them confirms from their own account. Nothing in this draft assumes it.
- **Links made before this.** They are left exactly as they are. How each was made was never
  recorded, so any of them may have come through one of the four doors. The 20d dry run counted 9
  linked people; that conversion should only ever move logs for a link somebody has verified, and
  is a no for now anyway. A read-only query that lists the links most likely ADOPTED rather than
  made (the person has days logged before its owner's account existed) is below. **Not run**,
  because it reads production.

  ```sql
  select cp.id, cp.name, p.username, u.created_at::date as account_made, min(l.date) as first_day
    from public.circuit_people cp
    join auth.users u on u.id = cp.owner_user_id
    left join public.profiles p on p.user_id = cp.owner_user_id
    join public.circuit_logs l on l.person_id = cp.id
   group by cp.id, cp.name, p.username, u.created_at
  having min(l.date) < u.created_at::date
   order by first_day;
  ```

- **A separate hole found on the way**, not fixed here: `cpg_write` lets a circuit's CREATOR add any
  person id to their own circuit, and `circuit_can_see_person` lets every member of a circuit see
  its people. So a member who knows a person's id can make a circuit and read that person's logs
  whatever their visibility says. With this draft such a person can no longer be CLAIMED that way
  (the admin sees "they added this board to a circuit themselves"), but the read remains.
  **Measured** in db guards run 45081011006: as the seeded stranger, 0 of the friend's private
  board's logs before, 3 after one `create_circuit` and one insert. Drafted on its own, independent
  of this one: `docs/2026-11-22-circuit-creator-staple-plan.md` on branch `circuit/creator-staple`.

## Evidence

- **db guards run 45082980602**, the strictest: production's default grants put back first (CI's
  baseline lacks them, so without this a missing `revoke … from anon` passes). Everything below
  held again, and with two of the draft's revokes deliberately removed the test named both ("anon
  can execute public.my_person_claims()", "anon holds SELECT … on circuit_person_claims").

- **db guards run 45079301551** (the probe branch `circuit/ci-probe-claims`, never merged): the test
  against today's functions fails on all four doors; the draft applies; the test passes ("circuit
  claims: all checks passed"); applying it again is refused by its own guard and changes nothing;
  the rollback restores all three functions byte for byte, drops everything it added and keeps the
  grants; the test then refuses on its own guard; and the standing visibility guards and chronicle
  flow pass with the draft in place.
- **The test**, `supabase/tests/circuit-claims.sql`, runs as the seeded admin and two members in a
  transaction that rolls back. Besides the four doors it asks the privileges (nothing for anon,
  the internal pieces for nobody, the table deny-all, and a member's direct read refused), a
  member's own view, the admin's list and every answer, and that every board that existed before
  the test has the owner it started with.
- **Unit tests** for `src/circuit/claims.ts`, each made to fail once by breaking the code it is
  about.
- **The two lists** in the pane at 375, 820 with the touch rules forced on, and 1440: `mobileAudit`
  reads zero, after naming a planted 16px button and a 600px spill.

## To apply (needs Evan's yes)

1. **Check A**, `docs/2026-11-22-circuit-claims.checks.sql`, read-only on production. Stop if any
   md5 differs; write down `owners`.
2. Apply the draft with `apply_migration`, as `circuit_claims_need_approval`.
3. **Check B**: the nine md5s and grants as listed there; `owners` unchanged; no requests; the table
   deny-all.
4. Record it: the migration file, its `applied.md5` line, the draft moved to `docs/applied/`.
5. Release this PR (the screens) with the usual flow, then look at the live bundle.

Then, on a phone, signed in: a second account presses This is me on an unclaimed person, sees
Waiting, and nothing about the person changes; the admin sees it in Circuit claims and approves it;
the person is theirs.

**Rollback:** `docs/2026-11-22-circuit-claims-need-approval.ROLLBACK.sql`. It does not undo an
approval, and it reopens all four doors, so it is for a fault in the draft itself.
