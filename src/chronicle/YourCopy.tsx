import { useRef, useState } from 'react'
import { showToast } from '../circuit/toast'
import { exportMine, importMine } from './cloud'

/**
 * Your record, out of the account and back into it.
 *
 * ⚠️ IT EXISTS BECAUSE CHRONICLE IS THE ONE STORE HERE WITH NO LOCAL COPY. Songs, drawings,
 * looks and minions are localStorage mirrored to the account, and the Account page offers all
 * four as a file on the stated grounds that "a file is the copy that survives losing the
 * account". Chronicle deliberately went the other way — a record of your days has to be the same
 * on a phone and a laptop, so there is one copy and it is the server's — and the cost of that
 * decision was the only thing on this site nobody could take out. The thing it replaced kept
 * everything in the browser, where it was yours by accident; this makes it yours on purpose.
 *
 * ⚠️ THE WHOLE FILE COMES FROM ONE RPC, AND GOES BACK THROUGH ONE. Five calls returning five
 * lists would each pass through a row limit that can truncate quietly, and a download missing a
 * year looks exactly like one that is not. See chronicle_export and chronicle_import.
 *
 * ⚠️ AND PUTTING ONE BACK ADDS, NEVER REPLACES, which is why there is no confirmation on it. A
 * control that cannot destroy anything should not ask whether you are sure; the thing people fear
 * about an import is losing what is already there, so the sentence under it says the opposite
 * out loud rather than putting a dialog in the way.
 */
/**
 * ⚠️ IT LIVES ON THE ACCOUNT PAGE NOW, NOT IN CHRONICLE. Reported plainly: "i dont really see a
 * point in these controls they are also a bit confusing". They were a permanent fixture at the
 * bottom of a room people open to press Start — a backup is a thing you think about twice a
 * year, beside the other backup, not something to scroll past every day. Account already held
 * the library's copy and a line saying the chronicle's lived elsewhere; now they are together
 * and that line is gone with the split it described.
 *
 * ⚠️ `onPutBack` IS OPTIONAL BECAUSE THERE IS NOTHING TO REFRESH THERE. In the room it bumped
 * the beat so both halves refetched; on Account the chronicle is not on screen, and the room
 * fetches on mount when you next open it.
 */
export function YourCopy({ onPutBack }: { onPutBack?: () => void } = {}) {
  const [busy, setBusy] = useState<'out' | 'in' | null>(null)
  const file = useRef<HTMLInputElement>(null)

  const save = async () => {
    setBusy('out')
    try {
      const mine = await exportMine()
      /* ⚠️ said out loud, because the failure mode of a silent download is believing you have a
         copy. Nothing else in this room has to be this loud; nothing else is a backup. */
      if (!mine) {
        showToast('That did not save — nothing came back')
        return
      }
      const blob = new Blob([JSON.stringify(mine, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const d = new Date()
      const pad = (n: number) => String(n).padStart(2, '0')
      a.download = `chronicle-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`
      a.click()
      /* the object URL holds the whole file in memory until it is let go of */
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch {
      showToast('That did not save')
    } finally {
      setBusy(null)
    }
  }

  const putBack = async (f: File) => {
    setBusy('in')
    try {
      const doc: unknown = JSON.parse(await f.text())
      const got = await importMine(doc)
      if ('why' in got) {
        /* ⚠️ a refusal comes up from Postgres, where an exception message is written lowercase —
           "not a chronicle file" beside this room's own "That file could not be read" reads as a
           mistake on screen. One place to fix it, rather than two sets of wording to keep level. */
        showToast(got.why.charAt(0).toUpperCase() + got.why.slice(1))
        return
      }
      const added = got.activities + got.entries + got.goals + got.routines + got.plans
      /**
       * ⚠️ COUNTED SEPARATELY, because "added 0" and "that file was already here" are different
       * things to be told and only one of them sounds like a failure. The same distinction the
       * Account page's own restore makes.
       */
      showToast(
        added
          ? `Added ${added} — ${got.entries} sessions, ${got.activities} activities, ${got.goals} goals.`
          : got.skipped
            ? 'Everything in that file was already here'
            : 'There was nothing in that file',
      )
      /**
       * ⚠️ TELL THE ROOM, or it goes on showing what it loaded before the file arrived. Found by
       * doing it: a put-back into an empty account restored seventeen sessions and eleven goals,
       * the file came back byte-identical, and the page still said there was nothing here. The
       * room reads once on mount and after its own edits; an import is an edit it did not make.
       */
      if (added) onPutBack?.()
    } catch {
      showToast('That file could not be read')
    } finally {
      setBusy(null)
      /* so choosing the same file twice in a row still fires a change */
      if (file.current) file.current.value = ''
    }
  }

  return (
    <div className="chron-keep">
      <button
        className="btn btn-ghost"
        type="button"
        disabled={busy !== null}
        onClick={() => void save()}
      >
        {busy === 'out' ? 'Saving…' : '⬇ Save a copy'}
      </button>
      <button
        className="btn btn-ghost"
        type="button"
        disabled={busy !== null}
        onClick={() => file.current?.click()}
      >
        {busy === 'in' ? 'Putting back…' : '⬆ Put one back'}
      </button>
      <input
        ref={file}
        type="file"
        accept="application/json,.json"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void putBack(f)
        }}
      />
      <span className="muted">
        Everything you have recorded, as a file — the copy that survives losing the account. Putting
        one back adds what is missing and leaves everything you already have alone.
      </span>
    </div>
  )
}
