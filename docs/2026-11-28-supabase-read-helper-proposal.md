# One shared helper for the remaining 91: a proposal (nothing built)

Written 28 Nov 2026, after the serious tiers of the
[Supabase failure audit](2026-11-27-supabase-failure-audit.md) were fixed one by one. **This proposes
a helper; it builds nothing.** The decisions to take are at the end.

## What is left

91 sites in the bug class. At the time of the audit, a failure at each one was shown wrong until the
view reopened (61), or was wrong for that one call only (30). None of them writes the wrong answer back
or keeps it past a reload — those tiers are fixed. What they still do is tell a member something false
about their own data, as if it were true:

| shape                                | count | what it looks like                                    |
| ------------------------------------ | ----- | ----------------------------------------------------- |
| null or `[]` read as an answer       | 62    | `const { data } = await sb.rpc(…); return data ?? []` |
| both (the above, inside a try/catch) | 13    | the catch never runs; the `[]` does                   |
| a write whose result is ignored      | 15    | `void sb.rpc('mark_read', …)`                         |
| try/catch alone                      | 1     | as above, with nothing read                           |

By call: `rpc` 50, `from().select` 9, auth session checks 21 (`getSession`, `getUser`, wrappers), raw
`fetch` 3, other 8. They are spread over about 30 modules; the largest clusters are `src/circuit/ui`
(14), `Profile.tsx` (8), `circuit/social.ts` (7), `park/mapsCloud.ts` (6) and `server/ws-server.js` (6).

Fixing them one at a time, the way the serious ones were, would be 91 small bespoke changes with 91
chances to spell "failed" differently. The serious ones were worth that, because each had a write to
protect. These are worth one shape.

## The proposal: one way to read, one way to show it

### 1. `read()` — a failure stays a failure

```ts
// src/lib/read.ts (proposed)
export type Read<T> = { ok: true; data: T } | { ok: false; why: string; transient: boolean }

/** Await a supabase-js query or rpc; a failure is never turned into data. */
export async function read<T>(
  q: PromiseLike<{ data: T | null; error: unknown; status?: number }>,
  opts?: { none?: T },
): Promise<Read<T>>
```

- **`error` set, or the promise rejects:** `{ ok: false }`.
  - `transient` is true for status 0, 408, 429 and 5xx: the rule `lookRefused` and `outcomeOf` already
    use, in one place.
- **No error and `data === null`:**
  - `{ ok: true, data: opts.none }` when the caller says what "nothing" is — for `.maybeSingle()`, where
    no row is a real answer.
  - `{ ok: false }` otherwise. A list rpc never legitimately returns null.
- **No error:** `{ ok: true, data }`.

It is #471's rule — "only a real answer is believed" — as a type. The caller cannot get `[]` out of
a failure without writing the word `ok`.

For **auth** (21 sites) the same idea, shaped for it: `session()` answering `signed-in | signed-out |
unknown`. "Could not ask" is not "signed out". `readLiveSession` in `finance/auth.ts` already half does
this, so most of the work is making every caller use it.

### 2. `useRead()` — and the screen says so

```ts
// src/lib/useRead.ts (proposed)
function useRead<T>(
  load: () => Promise<Read<T>>,
  deps: unknown[],
): {
  state: 'loading' | 'ok' | 'failed'
  data: T | undefined
  retry: () => void
  retrying: boolean
}
```

- It owns what each of the fixed sites had to build by hand: newest-wins sequencing (Chronicle's
  `latestOnly`), the loading state, and Retry.
- A failed read renders the existing `CouldNotLoad` ("Couldn't load your friends. Retry").
- `data` is `undefined` while not loaded, so an empty state cannot be drawn from an error by accident.

### 3. `write()` — for the 15 ignored results

The same `Read` shape for a write's answer. Each caller then chooses one of two things, on purpose:

- **say it failed** — a refused "mark as read" is worth a line;
- **owe it** — the outbox pattern `library/cloud.ts` now uses: kept on disk, retried with backoff,
  replayed on load. Proposed only where losing the write matters.

### 4. A lint rule, so it stays fixed

An eslint `no-restricted-syntax` rule (no plugin needed) that flags destructuring only `data` from an
awaited `.rpc(`, `.from(` or `.functions.invoke(`. That is the shape behind 75 of the 91 (the 62 that
read null as an answer, and the 13 that do it inside a try/catch). How many it actually flags is a
number to measure when it is written, not one to assume here — some sites reach `data` through a
`.then`, which a selector may not see.

Like `npm run test`'s migration check, it is the rule written somewhere a machine reads. Sites
deliberately exempt (`circuit_manual_sums`, which is not deployed) carry a disable comment with the
reason.

## How it would land

1. **The helpers and the lint rule, with tests that fail first,** using a fake client that answers
   `{data: null, error}`, `{data: null, error: null}` and a rejection. The rule starts at `warn`.
2. **Callers by module, one PR each**, largest first:
   - `circuit/ui` and `circuit/social`;
   - `Profile` and `ProfileBlocks`;
   - `park/mapsCloud`;
   - the auth checks;
   - the rest.

   Each PR changes the read, renders `CouldNotLoad`, and adds a test per module that a failed read is
   not shown as empty.

3. **The relay's 6** (`server/ws-server.js`) use the server's own equivalents (`sureOf` / `standingOf`
   style) rather than the browser helper, and land in their own PR under the Render rule.
4. **The rule goes to `error`** once the count is 0.

About ten PRs. None of them needs a database change.

## What it does not do

- **It does not make a failed write succeed.** The outbox is for writes worth owing; most of the 15 are
  not.
- **It does not replace the bespoke guards** in the fixed sites (CertainChooser, Circuit, Chronicle,
  finance). Those can move onto `useRead` later, but each already has its own failing-first tests, so
  there is no hurry.
- **It does not cover realtime channel status.** That is a different shape — subscribe callbacks — and
  had no wrong-answer findings in the audit.

## Decisions for you

1. Build it in this shape, or keep fixing the remaining sites one by one?
2. Should the lint rule start at `warn`, and when should it become `error`?
3. Owe or say: which of the 15 ignored writes are worth an outbox? The proposed default is "say".
