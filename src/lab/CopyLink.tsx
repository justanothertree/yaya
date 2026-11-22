import { useEffect, useRef, useState } from 'react'

/**
 * A button that puts a sentence and a link on the clipboard, ready to paste into a comment or a
 * chat — the Lab's one way of sharing something a person made or did. A browser that refuses the
 * clipboard (an insecure page, a denied permission) gets the text in a box, selected, to copy by
 * hand, so sharing never silently fails.
 */
export function CopyLink({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'manual'>('idle')
  const box = useRef<HTMLTextAreaElement | null>(null)
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
        {label}
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
