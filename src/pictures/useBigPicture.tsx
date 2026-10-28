import { useCallback, useState } from 'react'
import { PhotoViewer } from './PhotoViewer'

/**
 * The state and the overlay in one go, so a thumbnail only has to say what to open.
 *
 * ⚠️ ITS OWN FILE, BECAUSE A HOOK BESIDE A COMPONENT BREAKS FAST REFRESH. The repo already
 * knew this — Profile.tsx carries a note about not exporting a plain constant from
 * ProfileBlocks.tsx for the same reason — and this time eslint said so rather than somebody
 * finding out later: `react-refresh/only-export-components`, an ERROR and not a warning.
 *
 * ⚠️ IT EXISTS BECAUSE THERE WERE THREE THUMBNAILS AND ONE VIEWER BETWEEN THEM — the Feed's log
 * card, a rating in MovieRate, and a chronicle sitting. Two of the three could not be enlarged at
 * all; the third could, onto a broken overlay. Three copies of `useState` plus three overlays is
 * how they drift apart again.
 */
export function useBigPicture() {
  const [big, setBig] = useState<{ src: string; alt?: string | null } | null>(null)
  const open = useCallback((src: string, alt?: string | null) => setBig({ src, alt }), [])
  const close = useCallback(() => setBig(null), [])
  return {
    open,
    viewer: big ? <PhotoViewer src={big.src} alt={big.alt} onClose={close} /> : null,
  }
}
