# The Feed: finished, meaningful moments only

**A plan. Nothing has changed and no SQL has run.**

Evan's brief: the Feed should show only finished, meaningful moments, not every activity. Page visits
and browsing stay tracked privately in his own Chronicle but never appear in the Feed. These should
appear: a score or result from a Lab toy, something made or published anywhere on the site, a profile
edit, a rating, and a comment.

## How the Feed is built today

The site Feed (`#feed`, `src/feed/FeedRoom.tsx`) makes one call, `feed_recent`. That function
assembles the Feed on every load from three readers, and **nothing is stored**:

- **`get_member_activity`**, once per member in scope, gives the four non-Chronicle kinds.
- **`chronicle_friends_log`** gives friends' sittings.
- **A block inside `feed_recent`** gives your own sittings.

Each kind has to pass that source's own visibility rule. The client then drops any kind it doesn't
know (`KINDS` in `src/feed/cloud.ts`).

## Every event that reaches it, and the proposal

| #   | On screen                                                          | Kind                              | Source                                  | Proposal                                                                                                             |
| --- | ------------------------------------------------------------------ | --------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 1   | Time spent in a room of the site, e.g. "Chronicle · 15m"           | `sitting` on an **auto** activity | `chronicle_visit` → `chronicle_entries` | **Private-only.** It stays in your own Chronicle ("on the site") and never reaches the Feed or a friend's Chronicle. |
| 2   | A Chronicle sitting you timed or logged, on an activity you shared | `sitting`                         | `chronicle_entries`                     | **Ask** (question 1)                                                                                                 |
| 3   | A Circuit workout day, with points                                 | `circuit_log`                     | `circuit_logs`                          | **Keep**, as a finished result (question 2)                                                                          |
| 4   | A rating                                                           | `rating`                          | `circuit_ratings`                       | **Keep**                                                                                                             |
| 5   | Every game of Snake                                                | `snake_score`                     | `score_history`                         | **Hide all but personal bests** (question 3)                                                                         |
| 6   | A Snake trophy                                                     | `snake_trophy`                    | `trophies`                              | **Keep**                                                                                                             |

Four things on Evan's list have no source in the Feed today:

| Wanted                      | Where it lives now                                                                               | What showing it takes                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| A Lab toy's score or result | Nowhere on the server. Lab bests are kept in the browser.                                        | New storage, plus each toy reporting a finished game                   |
| Something made or published | `member_library` (drawings, songs, pets, looks), visible to its owner only                       | A per-item share switch first, or a decision on what "published" means |
| A profile edit              | `profile_blocks`. Every save re-inserts all blocks, so the newest `created_at` is the last save. | Readable today, through the profile's own visibility rule              |
| A comment                   | `circuit_log_comments` on workouts, and `lab_comments` on Lab experiments                        | Readable today, each through the rule its source already has           |

## How browsing gets into the Feed now

`chronicle_visit` makes one **auto** activity per room (named after it, category "free"). It then
stretches a sitting on it every beat while you are in that room. An auto activity starts at Only me,
and in that state it reaches nobody. But nothing treats it differently from a real activity:

- **The readers:** neither `chronicle_friends_log` nor `feed_recent` excludes `auto`.
- **The sharing panel:** it lists auto activities beside real ones.

So once one is shared, every visit to that room goes to your friends' Feeds, their Chronicle Friends
tabs and your own Feed. That is the only route. The 30 Oct move to sharing levels copied the old
shared switch, and gave nothing a level of its own.

## Where the filter lives

**On the server, in the two functions that read sittings:** `chronicle_friends_log`, and the
own-sittings block of `feed_recent`. Each gains `and not a.auto`.

- **Not the client.** An event carries no auto flag. Filtering in the browser would also still send
  every friend's browsing to your browser, so it would hide it rather than keep it private.
- **Not RLS.** These tables are deny-all, with zero policies. They are read only through
  `SECURITY DEFINER` functions, so a rule about what they return has to live in those functions.
- **The client's list of kinds stays as a second gate.** It drops kinds it doesn't know, and each
  new kind needs a sentence in `FeedRoom.tsx` and `event.ts`.

## Browsing already in the Feed

**It disappears as soon as the filter ships.** The Feed is rebuilt from the last 14–31 days of
entries on every load, so the rule applies to past visits as well as new ones.

- No row is deleted or rewritten. Every visit stays in its owner's Chronicle.
- The site Feed has no comments or kudos of its own, so nothing is left hanging off a hidden row.

## SQL needed

Yes, in steps. Each is a new migration, reviewed as a draft before it runs.

1. **Hide browsing.** Replace `feed_recent` and `chronicle_friends_log` with the `not a.auto` filter.
   That is no table change and no data change, and it is reversible with another
   `create or replace`. Two optional additions: `chronicle_activity_set_visibility` refuses to share
   an auto activity, and the sharing panel stops listing them (a client change).
2. **Snake: bests only.** Change the `snake_score` branch of `get_member_activity`.
3. **Profile edits and comments.** Add new branches that read existing tables through their existing
   rules.
4. **Lab results, and things made or published.** These need new storage or a share column first.
   They are feature work, one PR each.

Before step 1, a read-only count in production of auto activities shared above Only me would show
whose Feeds change. I haven't run it.

## Overlap with #298

They meet at one point. Chronicle's Friends tab reads `chronicle_friends_log` too, so step 1 also
takes browsing out of friends' Chronicle, which "private in his own Chronicle" implies. Otherwise the
two are separate: #298 is layout and needs no SQL, while this needs SQL and its own release. So this
is its own draft PR, cross-linked.

## Questions for Evan

1. **Sittings you timed yourself, on an activity you shared:** keep them in the Feed, or show them
   only in Chronicle's Friends tab?
2. **Circuit workout days:** keep them? They aren't on the list, but they are finished results.
3. **Snake:** every game, or only personal bests and trophies?
4. **"Made or published":** which of these count?
   - a drawing, song, pet or look kept to your library;
   - a photo;
   - your profile page going public;
   - something made in the Lab.

   Library items are private today, so each would need a share switch.

5. **Comments:** on workouts, on Lab experiments, or both? And should the Feed show the words, or
   only "commented on …"?
6. **Lab results:** which toys first? None of them sends a result to the server yet.
7. **Profile edits:** one per person per day, or every save?
8. **Browsing in friends' Chronicle Friends tab:** keep it out of there too? The plan assumes yes.

## Evan's answers, 13 Nov 2026

1. **Sittings you timed, on a shared activity:** keep them in the Feed.
2. **Circuit workout days:** keep.
3. **Snake:** personal bests and trophies only.
4. **"Made":** only things the person explicitly publishes. Nothing gets in automatically.
5. **Comments:** from anywhere, with a short preview of the text.
6. **Lab results:** later, after the Lab score-share work. Start with the toys that already have a
   moment where a game finishes.
7. **Profile edits:** at most once per day.
8. **Browsing:** keep it out of friends' Chronicle too.

Step 1 (browsing hidden from the Feed and the Friends tab) is built as draft SQL in #304, not
applied. The table above still marks the timed sittings as "ask"; answer 1 makes them a keep.

## Progress, 14 Nov 2026

Steps 1 and 2 are live. Step 3 is a draft PR, and nothing of it has run against production.

| Step | PR   | State                                    | What it does                                                                                                          |
| ---- | ---- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 1    | #304 | applied as `feed_hides_browsing`, merged | browsing leaves the Feed and friends' Chronicle Friends tab                                                           |
| 2    | #312 | applied as `card_hides_browsing`, merged | browsing leaves a profile's Chronicle card for everyone but its owner, and leaves the Sharing panel                   |
| 3    | #317 | draft                                    | the Feed shows things made (a song, drawing, pet or look put on your page) and comments, with an 80-character preview |

All three were applied together on a throwaway copy of production's schema and tested as three
seeded members. Steps 1 and 2 then went to production on 14 Nov, one after the other; their records
are `supabase/migrations/20261114121907_feed_hides_browsing.sql` and
`20261114121930_card_hides_browsing.sql`. Still to come: Snake bests only (answer 3), profile edits
once a day (answer 7), and Lab results (answer 6), now that the score-share work has landed in #309.

Answer 4 shaped step 3. The one place a member explicitly publishes something they made is their
profile page, so "made" is the first time a song, drawing, pet or look reaches a page above Only
me. #317 lists that and three other judgement calls for Evan to change.
