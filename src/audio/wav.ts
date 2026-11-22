/**
 * Samples to a file.
 *
 * ⚠️ ONE COPY OF THIS SUM. It was written for the debug capture in recordDebug, and the
 * stem bouncer needs exactly the same forty-four bytes — two hand-written WAV headers is two
 * places for an off-by-one in a chunk length, which makes a file some players open and others
 * refuse for no visible reason.
 */
/**
 * WAV is a 44-byte header and then the samples — no library needed. One channel, or several of
 * the same length, interleaved (left, right, left, right…) as the format keeps them.
 */
export function toWav(data: Float32Array | readonly Float32Array[], rate: number): Blob {
  const chans = data instanceof Float32Array ? [data] : data
  const ch = chans.length
  const frames = chans[0]?.length ?? 0
  const bytes = frames * ch * 2
  const buf = new ArrayBuffer(44 + bytes)
  const v = new DataView(buf)
  const str = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i))
  }
  str(0, 'RIFF')
  v.setUint32(4, 36 + bytes, true)
  str(8, 'WAVEfmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true) // PCM
  v.setUint16(22, ch, true)
  v.setUint32(24, rate, true)
  v.setUint32(28, rate * ch * 2, true)
  v.setUint16(32, ch * 2, true)
  v.setUint16(34, 16, true)
  str(36, 'data')
  v.setUint32(40, bytes, true)
  let at = 44
  for (let i = 0; i < frames; i++)
    for (let c = 0; c < ch; c++) {
      // clamp before converting, so a sample past full scale wraps to silence rather than to
      // the opposite polarity — which would write a click that was never in the audio
      const s = Math.max(-1, Math.min(1, chans[c][i]))
      v.setInt16(at, s < 0 ? s * 0x8000 : s * 0x7fff, true)
      at += 2
    }
  return new Blob([buf], { type: 'audio/wav' })
}
