/**
 * Which layer's notes are open: the one asked for, as long as that layer still exists.
 *
 * ⚠️ THE ID OUTLIVED ITS LAYER. Clear all, deleting the open layer, or a peer removing it left
 * `editing` naming nothing — so the editor vanished from the screen while the room still believed
 * it was open, and Undo stayed disabled under "The note editor has its own undo while it is open".
 * The room asks this after every change to the layers and closes what is gone.
 */
export function openEditor(
  editing: string | null,
  layers: readonly { id: string }[],
): string | null {
  return editing !== null && layers.some((l) => l.id === editing) ? editing : null
}
