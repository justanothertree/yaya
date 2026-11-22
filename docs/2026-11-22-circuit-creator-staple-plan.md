# A circuit's creator could add anybody's board to their circuit, and so read it

⛔ **DRAFT, NOT APPLIED.** Found on 22 Nov while drafting §19e (#456). Applying it is Evan's call;
the steps are at the end.

## The hole

`circuit_person_groups` had one policy for every command, `cpg_write`:

> is the admin, **or** owns the person and is in the circuit, **or** created the circuit

The third branch asks nothing about the person. It is right for taking somebody _out_ of your
circuit, which is managing it, and wrong for putting somebody _in_: `circuit_can_see_person` lets
every member of a circuit see the people in it, whatever their own visibility says. So any member
who knows a person's id can call `create_circuit`, insert the person into it, and read every day
they ever logged, a private board included.

The August fix (`docs/2026-08-19-circuit-membership.sql`) closed joining a circuit without a code,
and noted that stapling your OWN board into somebody else's circuit gained no read. It kept the
creator's direct writes for management, and the reverse case, somebody else's board into your
circuit, was not asked.

**Measured, not argued.** db guards run 45081011006, on CI's database built from the schema
baseline, as the seeded stranger, against the friend's private board:

|                                       | the stranger sees          |
| ------------------------------------- | -------------------------- |
| before                                | 0 logs, and not the person |
| after `create_circuit` and one insert | 3 logs, and the person     |

An id is not secret once seen: anybody who was ever in a circuit with the person, a friend before
an unfriending, or anybody who saw the board while it was more visible already has it.

## The fix

`docs/2026-11-22-circuit-creator-staple.DRAFT.sql` splits `cpg_write` into three:

- **`cpg_delete`**: exactly what `cpg_write` allowed, the creator's bypass included. Managing who is
  in your circuit is unchanged.
- **`cpg_insert`**: the admin, or a person you own going into a circuit you are in.
- **`cpg_update`**: the same, of the row before and after, because moving a row is putting a person
  somewhere.

No row is changed or removed. The client never writes this table (it only reads it), and every
add goes through a SECURITY DEFINER function, which RLS does not apply to, so nothing on screen
changes. It refuses to run unless the table's policies are exactly `cpg_select` and `cpg_write`,
and `cpg_write` is the policy it was written against.

**Rows already there.** Whatever was added before stays, and whether anybody ever used this is a
question about production, so it is a query here and **not run**: rows whose board's owner is not
in the circuit and did not add it.

```sql
select g.name as circuit, cp.name as person, cp.visibility, pg.added_by, pg.added_at
  from public.circuit_person_groups pg
  join public.circuit_people cp on cp.id = pg.person_id
  join public.circuit_groups g on g.id = pg.group_id
 where cp.owner_user_id is not null
   and pg.added_by is distinct from cp.owner_user_id
   and not exists (select 1 from public.circuit_group_members gm
                    where gm.group_id = pg.group_id and gm.user_id = cp.owner_user_id)
 order by pg.added_at;
```

## Evidence

`supabase/tests/circuit-creator-staple.sql`, as the seeded admin and two members in a transaction
that rolls back:

- **A**, the hole: the stranger makes a circuit and tries to add the friend's private board. It is
  refused, and the friend's days stay unreadable. Against today's policy this section fails and
  says so.
- **B**, what must still work: a member adds their own board to a circuit they are in; the creator
  takes somebody else's board out of their circuit; the admin adds anybody's.
- **C**, moving a row: not onto a board you do not own, and not by a creator who owns neither.
- **D**, the policies: exactly the four, none for anon.

The CI probe runs it against today's policy (must fail), applies the draft, runs it (must pass),
applies again (must refuse), rolls back (must restore `cpg_write`) and runs the standing guards with
the draft in place. **db guards run 45082980602** did all of it: the control named the hole, the test then passed, the second apply was refused, the rollback restored `cpg_write` exactly, and the standing guards held with the draft in place.

## To apply (needs Evan's yes)

1. Read-only, on production: `select polname, polcmd from pg_policy where polrelid =
'public.circuit_person_groups'::regclass` must be exactly `cpg_select r` and `cpg_write *`.
2. Apply the draft with `apply_migration`, as `circuit_creator_staple`.
3. The same query again: `cpg_delete d`, `cpg_insert a`, `cpg_select r`, `cpg_update w`.
4. Record it: the migration file, its `applied.md5` line, the draft moved to `docs/applied/`.

It is independent of §19e and can go in either order.

**Rollback:** `docs/2026-11-22-circuit-creator-staple.ROLLBACK.sql` puts `cpg_write` back as it was,
which reopens the hole.
