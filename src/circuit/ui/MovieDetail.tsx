// Group detail modal — all ratings for one movie, aggregated gut reactions + tag cloud.
// A rating's photograph is drawn here too: see RatingPhoto at the foot of this file.
import { useMemo, useState } from 'react'
import { useCircuit } from '../store'
import { Modal } from './Modal'
import {
  MV_ICONS,
  REC,
  REWATCH,
  SENTIMENT,
  TIPS,
  canRateAs,
  ratersIn,
  scoreColor,
} from './movieMeta'
import { peekPersistedUserId } from '../../finance/auth'
import { useSeenPicture } from '../../pictures/seen'
import { useBigPicture } from '../../pictures/useBigPicture'
import { MovieRate } from './MovieRate'
import { MoviePersonProfile } from './MoviePersonProfile'
import { kindOf, kindsPresent } from '../reviewKinds'
import { circuitStore } from '../store'
import type { Movie, Person } from '../types'

export function MovieDetail({ movie, onClose }: { movie: Movie; onClose: () => void }) {
  const { people } = useCircuit()
  /* tapping a photograph opens it full-size over this dialog — see PhotoViewer's own note on
     why Escape has to be handled in the capture phase to close the photo and not the modal */
  const bigPicture = useBigPicture()
  const [editing, setEditing] = useState<Person | null>(null)
  const [personProfile, setPersonProfile] = useState<Person | null>(null)

  // Raters = people you can see who are either movie-raters or have actually rated this film —
  // not a hardcoded crew list, so a member viewing from another circuit still sees real names.
  const raters = useMemo(() => {
    /* WARNING the movie's OWN circuit, not the one you happen to be filtered to. A film belongs
       to the circle that rated it, so opening it from "all circuits" must still offer that
       circle's people — and anyone who has already rated it is kept whatever their membership
       says now, or leaving a circuit would erase your scores from view. */
    const circle = ratersIn(people, movie.groupId)
    const ids = new Set<string>(circle.map((p) => p.id))
    Object.keys(movie.ratings).forEach((id) => ids.add(id))
    const order = (id: string) => {
      const i = circle.findIndex((p) => p.id === id)
      return i === -1 ? circle.length : i
    }
    /* ⚠️ the same account-vs-person id mismatch the board had: `ids` is account-keyed (from
       ratersIn and from movie.ratings), while people[].id is the circuit_people id, so filtering
       the raw list matched nobody and the detail view showed an average with no raters under it.
       ratersIn('') is every person, account-keyed — the right pool to filter. */
    const everyone = ratersIn(people, '')
    const me = peekPersistedUserId()
    if (me) ids.add(me)
    return everyone.filter((p) => ids.has(p.id)).sort((a, b) => order(a.id) - order(b.id))
  }, [people, movie.ratings, movie.groupId])

  /* only a signed-in member can retag; the demo sandbox has no account to attribute it to */
  const canEdit = !!peekPersistedUserId()
  const scores = raters.map((p) => movie.ratings[p.id]?.score).filter((s): s is number => s != null)
  const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null

  // Sentiment distribution across all raters
  const sentDist = [0, 0, 0, 0, 0]
  raters.forEach((p) => {
    const s = movie.ratings[p.id]?.review?.sentiment
    if (s != null && s >= 0 && s < 5) sentDist[s]++
  })

  // Tips aggregated
  const tipsCounts: Record<string, number> = {}
  raters.forEach((p) => {
    ;(movie.ratings[p.id]?.review?.tips ?? []).forEach(
      (t) => (tipsCounts[t] = (tipsCounts[t] || 0) + 1),
    )
  })
  const tipsList = Object.entries(tipsCounts).sort((a, b) => b[1] - a[1])

  // Tags aggregated
  const tagCounts: Record<string, number> = {}
  raters.forEach((p) => {
    ;(movie.ratings[p.id]?.review?.tags ?? []).forEach(
      (t) => (tagCounts[t] = (tagCounts[t] || 0) + 1),
    )
  })
  const tagList = Object.entries(tagCounts).sort((a, b) => b[1] - a[1])

  const headerLabel = (
    <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
      <span style={{ fontWeight: 800, fontSize: '1.05rem' }}>{movie.title}</span>
      {avg != null && (
        <span
          style={{
            background: scoreColor(avg),
            color: '#fff',
            borderRadius: 6,
            padding: '1px 9px',
            fontSize: '0.88rem',
            fontWeight: 700,
          }}
        >
          {avg.toFixed(1)}
        </span>
      )}
    </span>
  )

  return (
    <>
      <Modal title={headerLabel} onClose={onClose} width={680}>
        {/* Meta row */}
        <div
          style={{
            display: 'flex',
            gap: '0.75rem',
            alignItems: 'center',
            marginBottom: '0.85rem',
            flexWrap: 'wrap',
          }}
        >
          {movie.date && (
            <span className="muted" style={{ fontSize: '0.78rem' }}>
              Watched {movie.date.slice(0, 7)}
            </span>
          )}
          {movie.rt && (
            <span style={{ color: '#fa4242', fontWeight: 700, fontSize: '0.82rem' }}>
              🍅 {movie.rt}
            </span>
          )}
          <span className="muted" style={{ fontSize: '0.78rem' }}>
            {scores.length} of {raters.length} rated
          </span>
          {/**
           * ⚠️ THE CATEGORY WAS WRITE-ONCE, and that is why the board looked like it was only
           * for films. A review has been "a rated thing with a kind" for a while — reviewKinds ships
           * movie, food, beer, drink, restaurant, game, music and other, plus anything somebody
           * types — but the only place a kind could ever be set was the Add sheet. So every review
           * made before kinds existed, and every one where the chip was missed on the way in, was
           * stuck reading as a movie for good, with nothing anywhere to change it.
           *
           * ⚠️ Signed-in only, and the database has the final word: this is one more write that
           * RLS decides on, and a refusal rolls the store back and toasts like any other.
           */}
          {canEdit && (
            <label
              className="muted"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.3rem',
                fontSize: '0.78rem',
              }}
              title="What kind of thing is this?"
            >
              <span aria-hidden>{kindOf(movie.kind).emoji}</span>
              <select
                value={movie.kind ?? 'movie'}
                onChange={(e) => void circuitStore.saveMovie({ ...movie, kind: e.target.value })}
                style={{ fontSize: '0.78rem' }}
              >
                {kindsPresent([movie.kind ?? '']).map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.emoji} {k.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {/* Gut reactions */}
        {sentDist.some((c) => c > 0) && (
          <>
            <div
              className="muted"
              style={{
                fontSize: '0.7rem',
                fontWeight: 700,
                letterSpacing: '0.06em',
                marginBottom: '0.3rem',
              }}
            >
              GUT REACTIONS
            </div>
            <div style={{ display: 'flex', gap: '0.6rem', marginBottom: '0.85rem' }}>
              {SENTIMENT.map(
                (s, i) =>
                  sentDist[i] > 0 && (
                    <span key={i} title={s.l} style={{ fontSize: '1.1rem' }}>
                      {s.e}
                      {sentDist[i] > 1 && (
                        <sup style={{ fontSize: '0.65rem', fontWeight: 700 }}>{sentDist[i]}</sup>
                      )}
                    </span>
                  ),
              )}
            </div>
          </>
        )}

        {/* Tips of the cap */}
        {tipsList.length > 0 && (
          <>
            <div
              className="muted"
              style={{
                fontSize: '0.7rem',
                fontWeight: 700,
                letterSpacing: '0.06em',
                marginBottom: '0.3rem',
              }}
            >
              TIPS OF THE CAP
            </div>
            <div
              style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginBottom: '0.85rem' }}
            >
              {tipsList.map(([tip, count]) => {
                const t = TIPS.find((x) => x.id === tip)
                return t ? (
                  <span
                    key={tip}
                    style={{
                      fontSize: '0.8rem',
                      background: 'var(--b1,rgba(127,127,127,0.1))',
                      borderRadius: 12,
                      padding: '2px 9px',
                    }}
                  >
                    {t.e} {t.l}
                    {count > 1 && <span style={{ opacity: 0.6 }}> ×{count}</span>}
                  </span>
                ) : null
              })}
            </div>
          </>
        )}

        {/* Tags */}
        {tagList.length > 0 && (
          <>
            <div
              className="muted"
              style={{
                fontSize: '0.7rem',
                fontWeight: 700,
                letterSpacing: '0.06em',
                marginBottom: '0.3rem',
              }}
            >
              TAGS
            </div>
            <div
              style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', marginBottom: '0.85rem' }}
            >
              {tagList.map(([tag, count]) => (
                <span
                  key={tag}
                  style={{
                    fontSize: '0.76rem',
                    background: 'var(--b1,rgba(127,127,127,0.1))',
                    borderRadius: 12,
                    padding: '2px 8px',
                  }}
                >
                  #{tag}
                  {count > 1 && <span style={{ opacity: 0.6 }}> ×{count}</span>}
                </span>
              ))}
            </div>
          </>
        )}

        {/* Per-rater cards */}
        <div
          className="muted"
          style={{
            fontSize: '0.7rem',
            fontWeight: 700,
            letterSpacing: '0.06em',
            marginBottom: '0.5rem',
          }}
        >
          RATINGS
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {raters.map((p) => {
            const r = movie.ratings[p.id]
            const rv = r?.review
            const sentItem = rv?.sentiment != null ? SENTIMENT[rv.sentiment] : null
            const rewItem = rv?.rewatch != null ? REWATCH.find((x) => x.v === rv.rewatch) : null
            const recItem = rv?.rec ? REC.find((x) => x.v === rv.rec) : null
            // stack repeated reactions multiplicatively: 🔥🔥🔥 → 🔥×3 (counted here, sized in JSX)
            const vibeCounts = new Map<string, number>()
            for (const id of r?.icons ?? []) {
              const emoji = MV_ICONS.find((x) => x.id === id)?.emoji
              if (emoji) vibeCounts.set(emoji, (vibeCounts.get(emoji) ?? 0) + 1)
            }

            return (
              <div
                key={p.id}
                style={{
                  background: 'var(--b1,rgba(127,127,127,0.07))',
                  borderRadius: 10,
                  padding: '0.55rem 0.7rem',
                  borderLeft: `3px solid ${p.color}`,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.6rem',
                    flexWrap: 'wrap',
                  }}
                >
                  {/* hero gut-reaction emoji, blown up */}
                  <span
                    title={sentItem?.l}
                    style={{ fontSize: '2rem', lineHeight: 1, width: '2rem', textAlign: 'center' }}
                  >
                    {sentItem ? sentItem.e : <span style={{ opacity: 0.25 }}>·</span>}
                  </span>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                    <span
                      onClick={() => setPersonProfile(p)}
                      style={{
                        fontWeight: 700,
                        color: p.color,
                        cursor: 'pointer',
                        fontSize: '0.9rem',
                      }}
                      title={`${p.name}'s rating stats`}
                    >
                      {p.name}
                    </span>
                    {/* vibes + rec + rewatch, blown up; counts kept small as superscripts */}
                    {([...vibeCounts.entries()].length > 0 || recItem || rewItem) && (
                      <span
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.4rem',
                          fontSize: '1.45rem',
                          lineHeight: 1,
                        }}
                      >
                        {[...vibeCounts.entries()].map(([e, n]) => (
                          <span key={e}>
                            {e}
                            {n > 1 && (
                              <sup style={{ fontSize: '0.6rem', fontWeight: 700 }}>×{n}</sup>
                            )}
                          </span>
                        ))}
                        {recItem && <span title={recItem.l}>{recItem.e}</span>}
                        {rewItem && <span title={rewItem.l}>{rewItem.e}</span>}
                      </span>
                    )}
                  </span>
                  <span
                    style={{
                      marginLeft: 'auto',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.45rem',
                    }}
                  >
                    {r?.score != null && (
                      <span
                        style={{
                          background: scoreColor(r.score),
                          color: '#fff',
                          borderRadius: 6,
                          padding: '2px 10px',
                          fontWeight: 700,
                          fontSize: '0.95rem',
                        }}
                      >
                        {r.score}
                      </span>
                    )}
                    {/* only your own — a rating row carries your account id and the policies
                        refuse anybody else's, so offering the button would be offering a
                        failure */}
                    {canRateAs(p.id) && (
                      /* ⚠️ 24 HIGH, BECAUSE 2px OF PADDING ON 0.7rem TEXT IS 17. Measured at 375
                         while checking the photo above it: this and its "Rate" twin were the only
                         two things in the dialog under WCAG 2.5.8's floor, and they are the button
                         somebody taps to write a review. A min-height cannot reflow anything —
                         the row is already taller than this — so it costs the look nothing. */
                      <button
                        className="btn"
                        style={{ fontSize: '0.7rem', padding: '2px 8px', minHeight: 24 }}
                        onClick={() => setEditing(p)}
                      >
                        {r?.score != null ? 'Edit' : 'Rate'}
                      </button>
                    )}
                  </span>
                </div>
                {(rv?.tips ?? []).length > 0 && (
                  <div
                    style={{
                      fontSize: '0.76rem',
                      display: 'flex',
                      gap: '0.4rem',
                      flexWrap: 'wrap',
                      marginTop: '0.3rem',
                    }}
                  >
                    {rv!.tips!.map((tip) => {
                      const t = TIPS.find((x) => x.id === tip)
                      return t ? (
                        <span key={tip} className="muted">
                          {t.e} {t.l}
                        </span>
                      ) : null
                    })}
                  </div>
                )}
                {(rv?.tags ?? []).length > 0 && (
                  <div className="muted" style={{ fontSize: '0.74rem', marginTop: '0.25rem' }}>
                    {rv!.tags!.map((t) => `#${t}`).join(' ')}
                  </div>
                )}
                {rv?.note && (
                  <p
                    className="muted"
                    style={{ fontSize: '0.8rem', fontStyle: 'italic', margin: '0.3rem 0 0' }}
                  >
                    "{rv.note}"
                  </p>
                )}
                {/**
                 * ⚠️ THE ONE PART OF A RATING NOBODY COULD READ. Everything else a person writes
                 * reaches this block — the vibes, the recommend, the rewatch, the tips, the tags
                 * and the note — and the photograph did not, anywhere. It was drawn in exactly
                 * one place: the dialog you use to ATTACH it. So the person who took it had to
                 * reopen their own rating to see it, and nobody else could see it at all.
                 *
                 * The hard half was already built and is why this is three lines. `pictures_i_can_see`
                 * has a `circuit_ratings` branch — a picture is signable by whoever may see the
                 * rating it hangs on, requiring the picture's owner to match the rating's owner so
                 * an id written onto somebody else's row resolves to nothing. The adapter selects
                 * `picture` for every rater, `movieMeta` carries it onto each one. Nothing ever
                 * asked for the URL.
                 */}
                <RatingPhoto id={r?.picture} who={p.name} onPhoto={bigPicture.open} />
                {!r && (
                  <span className="muted" style={{ fontSize: '0.8rem' }}>
                    Not rated yet
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </Modal>
      {/* ⚠️ OUTSIDE the Modal, so the photo is not clipped by the dialog it was opened from —
          PhotoViewer portals to document.body and sits above it at z-index 1600 */}
      {bigPicture.viewer}

      {editing && (
        <MovieRate
          movie={movie}
          personId={editing.id}
          personName={editing.name}
          color={editing.color}
          onClose={() => setEditing(null)}
        />
      )}
      {personProfile && (
        <MoviePersonProfile
          personId={personProfile.id}
          personName={personProfile.name}
          color={personProfile.color}
          viewGroup={movie.groupId ?? ''}
          onClose={() => setPersonProfile(null)}
        />
      )}
    </>
  )
}

/**
 * The photograph somebody hung on their rating, if there is one and you may see it.
 *
 * ⚠️ IT TAKES AN ID AND FETCHES A URL, never a stored link. A URL into private R2 is signed for
 * an hour, so a link kept in a row is one that stops working with nothing to say it has. The id
 * is the durable thing and the link is minted when somebody looks — the same shape as `LogPhoto`
 * in Feed.tsx, which this deliberately mirrors rather than inventing a second way.
 *
 * ⚠️ AND `useSeenPicture` BATCHES. A film with eight raters is one request for eight pictures,
 * not eight requests — `src/pictures/seen.ts` collects the ids asked for in a tick and splits
 * them into calls of sixty, which is the cap the `seen` op enforces on the other side.
 *
 * It renders nothing at all when the id is absent, unresolvable, or belongs to somebody whose
 * rating you cannot see. That last case is the server's answer, not a guess made here.
 */
function RatingPhoto({
  id,
  who,
  onPhoto,
}: {
  id?: string | null
  who?: string | null
  onPhoto: (src: string, alt?: string | null) => void
}) {
  const pic = useSeenPicture(id)
  if (!pic) return null
  /* the alt somebody typed, else whose rating it is — never an empty alt on a real photograph */
  const alt = pic.alt ?? (who ? `${who}'s photo` : 'photo on this rating')
  return (
    <img
      src={pic.thumbUrl}
      alt={alt}
      onClick={(e) => {
        e.stopPropagation()
        onPhoto(pic.url, pic.alt)
      }}
      style={{
        marginTop: 6,
        maxHeight: 120,
        maxWidth: '100%',
        borderRadius: 8,
        cursor: 'zoom-in',
        display: 'block',
      }}
    />
  )
}
