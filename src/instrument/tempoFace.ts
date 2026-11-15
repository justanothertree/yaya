/**
 * What the speed, length and snap button reads — all three, so BPM is never out of sight behind it.
 *
 * ⚠️ THE SNAP WORDS ARE SnapPicker's OWN: 0 is Off and anything else is 1/n, which is what its
 * buttons say inside the sheet. Two spellings of one setting an inch apart would be two settings.
 */
export function tempoFace(bpm: number, bars: number, quantize: number): string {
  return `${bpm} BPM · ${bars} bar${bars === 1 ? '' : 's'} · snap ${quantize ? `1/${quantize}` : 'off'}`
}
