import { useState } from 'react'
import { showToast } from '../circuit/toast'
import { exportMine } from './cloud'

/**
 * Your record, out of the account and into a file.
 *
 * ⚠️ IT EXISTS BECAUSE CHRONICLE IS THE ONE STORE HERE WITH NO LOCAL COPY. Songs, drawings,
 * looks and minions are localStorage mirrored to the account, and the Account page offers all
 * four as a file on the stated grounds that "a file is the copy that survives losing the
 * account". Chronicle deliberately went the other way — a record of your days has to be the same
 * on a phone and a laptop, so there is one copy and it is the server's — and the cost of that
 * decision was the only thing on this site nobody could take out. The thing it replaced kept
 * everything in the browser, where it was yours by accident; this makes it yours on purpose.
 *
 * ⚠️ THE WHOLE FILE COMES FROM ONE RPC. Five calls returning five lists would each pass through
 * a row limit that can truncate quietly, and a download that is missing a year looks exactly
 * like one that is not. See chronicle_export.
 */
export function SaveCopy() {
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
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
      setBusy(false)
    }
  }

  return (
    <div className="chron-keep">
      <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => void save()}>
        {busy ? 'Saving…' : '⬇ Save a copy'}
      </button>
      <span className="muted">
        Everything you have recorded, as a file — the copy that survives losing the account.
      </span>
    </div>
  )
}
