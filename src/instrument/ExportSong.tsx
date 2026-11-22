import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { loopLength, type loopState } from '../audio/looper'
import { songToMidi } from '../audio/midiFile'
import { exportSong, type ExportProgress, type SongExport } from './songExport'
import { bareMime } from '../circuit/chatSongs'
import { exportName, songName, subscribeSongName } from './songName'
import { SendStatus, SendToChat } from './SendToChat'
import { newExport } from './sendOutcome'

/**
 * ⬇ Export song and ⬇ MIDI, in 📁 Songs. Evan, 16 Nov 2026: "renders the full mix (every part,
 * takes, beats, effects, and the sung lyrics) to one file I can play and share from my phone".
 *
 * ⚠️ SHARING IS A SECOND TAP, and that is the browser's rule rather than a choice. The share sheet
 * only opens inside a tap, and a tap stops counting after a few seconds; the song takes as long as
 * it is to record (see songExport.ts), so by the time the file exists the first tap has expired.
 * So the export ends on a Share button, offering the small file first (a phone wants it) and the
 * WAV when the browser will not share that, and downloads are there either way.
 *
 * ⚠️ THE FILES' ADDRESSES ARE MADE ONCE AND LET GO. An object URL holds its file in memory until
 * revoked, and a link that makes one every render keeps a song's worth of audio per render.
 */

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
const mb = (b: Blob) => `${(b.size / 1e6).toFixed(1)} MB`
/** a file for the share sheet, typed without codec details, which some browsers refuse */
const asFile = (b: Blob, name: string) => new File([b], name, { type: bareMime(b.type) })

export function ExportSong({
  loop,
  busy,
  setBusy,
  member,
}: {
  loop: ReturnType<typeof loopState>
  /** the stems are bouncing: one recording of the song at a time */
  busy: boolean
  setBusy: (on: boolean) => void
  /** signed in with a profile: only a member has chats to send a song into */
  member: boolean
}) {
  const [going, setGoing] = useState<ExportProgress | null>(null)
  const [done, setDone] = useState<SongExport | null>(null)
  const [say, setSay] = useState('')
  /** 💬 Send in a chat's picker is open */
  const [sending, setSending] = useState(false)
  const pickerId = useId()
  const stop = useRef<AbortController | null>(null)
  /* the song's kept name and the day, or song- and the day (songName.ts) */
  const kept = useSyncExternalStore(subscribeSongName, songName, songName)
  const name = exportName(kept, new Date())
  const empty = !loop.layers.length && !loop.takes.length

  const urls = useMemo(
    () =>
      done && {
        wav: URL.createObjectURL(done.wav),
        small: done.small ? URL.createObjectURL(done.small.blob) : null,
      },
    [done],
  )
  useEffect(
    () => () => {
      if (!urls) return
      URL.revokeObjectURL(urls.wav)
      if (urls.small) URL.revokeObjectURL(urls.small)
    },
    [urls],
  )
  /* a cancelled export puts the room back, even when the panel closes under it */
  useEffect(() => () => stop.current?.abort(), [])

  const share = useMemo(() => {
    if (!done || typeof navigator === 'undefined' || !navigator.canShare) return null
    const files = [
      ...(done.small ? [asFile(done.small.blob, `${name}.${done.small.ext}`)] : []),
      asFile(done.wav, `${name}.wav`),
    ]
    return files.find((f) => navigator.canShare({ files: [f] })) ?? null
  }, [done, name])

  const go = async () => {
    setDone(null)
    setSay('')
    setSending(false)
    newExport()
    const ctl = new AbortController()
    stop.current = ctl
    setBusy(true)
    setGoing({ at: 0, of: loopLength() + 3 })
    try {
      const got = await exportSong(setGoing, ctl.signal)
      if (got) setDone(got)
      else if (!ctl.signal.aborted) setSay('That did not record. Try once more.')
    } catch {
      setSay('This browser could not record the song.')
    } finally {
      stop.current = null
      setGoing(null)
      setBusy(false)
    }
  }

  const midi = () => {
    const bytes = songToMidi({ ...loop, name: kept ?? undefined })
    const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/midi' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${name}.mid`
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <div className="inst-export">
      <div className="inst-row">
        {going ? (
          <>
            <span className="inst-export-going" role="status">
              Recording {mmss(going.at)} of {mmss(going.of)}
              <progress max={going.of} value={going.at} />
            </span>
            <button className="btn btn-ghost" onClick={() => stop.current?.abort()}>
              Stop
            </button>
          </>
        ) : (
          <button
            className="btn"
            disabled={empty || busy}
            onClick={() => void go()}
            title="Play the song through once and keep it as one file"
          >
            ⬇ Export song
          </button>
        )}
        <button
          className="btn btn-ghost"
          disabled={!loop.layers.length}
          onClick={midi}
          title="Every part's notes, for another music app"
        >
          ⬇ MIDI
        </button>
      </div>
      {!going && !done && !empty && !say && (
        <p className="muted inst-note">Export plays the song once to record it.</p>
      )}
      {say && <p className="muted inst-note">{say}</p>}
      {done && urls && (
        <div className="inst-row inst-export-done">
          {share && (
            <button
              className="btn"
              onClick={() =>
                void navigator.share({ files: [share], title: 'My song' }).catch(() => {
                  /* closed without sharing */
                })
              }
            >
              Share…
            </button>
          )}
          {/* ⚠️ OUTSIDE THE `share` GATE: desktop Firefox has no Web Share, and sending to a chat
              needs nothing from the browser but the small file — which WebKit cannot make, so
              this is hidden there rather than offering to send a WAV (the server keeps none) */}
          {done.small && member && (
            <button
              className={'btn' + (sending ? ' is-on' : '')}
              aria-expanded={sending}
              aria-controls={pickerId}
              onClick={() => setSending((v) => !v)}
            >
              💬 Send in a chat
            </button>
          )}
          {done.small && urls.small && (
            <a className="btn btn-ghost" href={urls.small} download={`${name}.${done.small.ext}`}>
              ⬇ {done.small.ext.toUpperCase()} · {mb(done.small.blob)}
            </a>
          )}
          <a className="btn btn-ghost" href={urls.wav} download={`${name}.wav`}>
            ⬇ WAV · {mb(done.wav)}
          </a>
          <span className="muted">
            {mmss(done.stats.seconds)} · peak {done.stats.peakDb.toFixed(1)} dB
          </span>
        </div>
      )}
      {done?.small && member && (
        <SendToChat
          open={sending}
          id={pickerId}
          blob={done.small.blob}
          fallbackSeconds={done.stats.seconds}
          kept={kept}
          onClose={() => setSending(false)}
        />
      )}
      {/* ⚠️ OUTSIDE THE `done` GATE: a send outlives its export (sendOutcome.ts), so how it went is
          shown whether or not the picker, or the export it was a send of, is still here */}
      {member && <SendStatus />}
    </div>
  )
}
