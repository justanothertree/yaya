/**
 * The name you play under.
 *
 * ⚠️ READ-ONLY, AND THAT IS THE POINT. `manager.tsx` owns this key: it derives the name, offers
 * the field you change it in, tracks whether it is auto or custom, and checks it against the
 * claimed-handle rules before a score can be written under it. None of that belongs in a second
 * place, so this does not reimplement any of it — it answers "what is this browser called" for
 * rooms that need a name and have no business inventing one.
 *
 * ⚠️ THE PARK USES THE SAME NAME AS SNAKE ON PURPOSE. It is already the site's word for who you
 * are in a game, already the one people have set, and already the one the relay can vouch for.
 * A separate park name would be a second identity to explain and a second thing to moderate.
 */

const NAME_KEY = 'snake.playerName'
const ID_KEY = 'snake.clientId'

export function readHandle(): string {
  try {
    const stored = localStorage.getItem(NAME_KEY)
    if (stored && stored.trim()) return stored.trim().slice(0, 40)
    /* ⚠️ the same shape manager.tsx settles on for somebody who has never set one, WITHOUT
       writing it: a room that shows a name should not be the thing that decides your name. */
    const cid = localStorage.getItem(ID_KEY) || ''
    return cid ? `Player${cid.slice(-4)}` : 'Player'
  } catch {
    /* a browser with storage switched off still gets to play */
    return 'Player'
  }
}
