/**
 * A short note on what is new in the room, at the top of it until it is closed.
 *
 * Evan, 16 Nov 2026: "A short 'what's new in Instrument' note in the room (dismissible, shown
 * once) listing lyrics, the part menu, copy/paste of notes, and recordings in the parts list."
 *
 * ⚠️ "ONCE" IS UNTIL IT IS CLOSED, NOT ONE VISIT. A note that marks itself read the moment it
 * appears is gone before somebody who came in to play has looked up from the keys. Closing it is
 * the once, and it stays closed.
 *
 * ⚠️ THE STORED VALUE IS THE EDITION, so the next note only has to change `EDITION` and the list:
 * having closed this one does not hide that one. When storage throws (Safari's private mode, a
 * full quota) it shows, and a close lasts for the visit.
 *
 * ⚠️ EACH LINE SAYS WHERE THE THING IS, in the words on its button. "Lyrics are here" with no way
 * to them was the complaint that started this (the words could not be found on a built song).
 */
import { useRef, useState } from 'react'

const KEY = 'inst_news_v1'
const EDITION = '2026-11-16'

export function WhatsNew() {
  const [shown, setShown] = useState(() => {
    try {
      return localStorage.getItem(KEY) !== EDITION
    } catch {
      return true
    }
  })
  const box = useRef<HTMLElement>(null)
  if (!shown) return null
  const close = () => {
    /* the button goes with the note, so a keyboard would be left on the page itself: hand it to
       the next thing in the room instead (▶ Play). Only when it was here — Safari does not focus
       a clicked button, and moving focus somebody did not have would scroll them about */
    const here = box.current?.contains(document.activeElement)
    const next = box.current?.nextElementSibling?.querySelector<HTMLElement>(
      'button:not(:disabled), a[href], input, select, textarea',
    )
    setShown(false)
    if (here) next?.focus({ preventScroll: true })
    try {
      localStorage.setItem(KEY, EDITION)
    } catch {
      /* private mode: closed for this visit */
    }
  }
  return (
    <aside ref={box} className="inst-news" aria-labelledby="inst-news-title">
      <h3 id="inst-news-title" className="inst-news-title">
        New in Instrument
      </h3>
      <ul className="inst-news-list">
        <li>
          <strong>Words to sing.</strong> A line for each bar, then ▶&nbsp;Sing the song.
          🎤&nbsp;Add words is in each part&rsquo;s menu.
        </li>
        <li>
          <strong>A menu for each part.</strong> Tap its name for volume, sound and notes.
        </li>
        <li>
          <strong>Copy and paste notes.</strong> ⬚&nbsp;Select in a part&rsquo;s notes, then ⧉ and
          📋, into any part.
        </li>
        <li>
          <strong>Voice recordings</strong> have a row each in the parts list, with a mute.
        </li>
      </ul>
      <button className="btn btn-ghost inst-news-close" onClick={close}>
        Got it
      </button>
    </aside>
  )
}
