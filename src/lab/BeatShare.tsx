import { useEffect, useRef, useState } from 'react'
import { beatLink, beatMessage, type Beat } from './beat'

/**
 * "Copy a beat-my-run link": the sentence and the link, onto the clipboard, ready to paste into a
 * comment or a chat. A browser that refuses the clipboard (an insecure page, a denied permission)
 * gets the text in a box, selected, to copy by hand.
 */
export function BeatShare({ beat }: { beat: Beat }) {
  const [state, setState] = useState<'idle' | 'copied' | 'manual'>('idle')
  const box = useRef<HTMLTextAreaElement | null>(null)
  const text = beatMessage(beat, beatLink(beat, `${location.origin}${location.pathname}`))
  useEffect(() => setState('idle'), [text])
  useEffect(() => {
    if (state === 'manual') box.current?.select()
  }, [state])
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setState('copied')
    } catch {
      setState('manual')
    }
  }
  return (
    <div className="beat-share">
      <button className="btn btn-ghost" onClick={copy}>
        🔗 Copy a “beat my run” link
      </button>
      {state === 'copied' && (
        <span className="muted" role="status">
          Copied — paste it in a comment or a chat.
        </span>
      )}
      {state === 'manual' && (
        <label className="beat-manual">
          <span className="muted">This browser would not copy it — select it and copy:</span>
          <textarea ref={box} readOnly rows={3} value={text} onFocus={(e) => e.target.select()} />
        </label>
      )}
    </div>
  )
}
