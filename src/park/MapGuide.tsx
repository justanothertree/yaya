import { MAP_GUIDE } from './mapOf'

/**
 * The park's own measurements, drawn over the paper.
 *
 * ⚠️ IT SAYS HOW BIG THINGS ARE WHILE YOU PLACE THEM. It began as half of the old map
 * tool, beside a panel that reported what the game had made of a drawing after the fact; that
 * panel is gone with the layer-named maker and this outlived it, because the map maker's field
 * is the whole three-screen world and nothing else on it says so. Both
 * halves of "extra tools as UI to help anyone draw the components to make the map", and this is
 * the half that stops the mistake rather than reporting it: every test map built alongside mapOf
 * came out bigger than any landmark the real park has, and nothing on the page could have said
 * so.
 *
 * ⚠️ AN OVERLAY, NEVER INK. It sits in the board beside the canvas and takes no pointer events,
 * so it cannot be drawn on, cannot be exported, and cannot end up in a saved picture — the same
 * bargain .paint-reach already makes. A guide that could become part of the drawing would be a
 * guide nobody dares turn on.
 *
 * ⚠️ AND IT CARRIES NO WORDS. The sentence explaining it lives in the panel with the switch
 * that turned it on, because a caption over the picture is a caption ON the picture: measured
 * on a phone it wrapped to three lines and covered a sixth of the paper, on a board that was
 * only 327 by 245 in the first place. The overlay is geometry; the panel has room to talk.
 *
 * ⚠️ AND EVERY NUMBER IS DERIVED. The thirds come from PARK.across and PARK.down, the creature
 * from PARK_TALL, and the reference place from the five landmarks that exist — see MAP_GUIDE.
 * A guide with its own idea of how big a creature is would be a guide that quietly goes wrong
 * the day anything is tuned.
 */
export function MapGuide() {
  const { cols, rows, creature, place } = MAP_GUIDE
  /* the lines BETWEEN the screens, which is one fewer than there are screens */
  const down = Array.from({ length: cols - 1 }, (_, i) => (i + 1) / cols)
  const along = Array.from({ length: rows - 1 }, (_, i) => (i + 1) / rows)

  return (
    <span className="paint-mapguide" aria-hidden>
      {down.map((x) => (
        <i key={`v${x}`} className="is-v" style={{ left: `${x * 100}%` }} />
      ))}
      {along.map((y) => (
        <i key={`h${y}`} className="is-h" style={{ top: `${y * 100}%` }} />
      ))}
      {/**
       * ⚠️ ONE INSIDE THE OTHER, because the useful fact is the RATIO and two swatches in
       * separate corners leave somebody to compare them by eye across the page. A creature
       * standing in a landmark-sized ring says "this is what a place is for" in one look.
       *
       * ⚠️ AND BOTH ARE ROUND NOW, WHICH THEY WERE NOT. Their width and height are
       * fractions of two DIFFERENT sides — see onPaper — so they are only round on paper the
       * shape of the world, and the field was square. It reads as a warning that the drawing
       * will be stretched, and it was; the fix was to stop stretching it, which is
       * MAP_GUIDE.paper. If these ever look like eggs again, the field is the wrong shape.
       */}
      <span
        className="paint-mapguide-ref"
        style={{ width: `${place.w * 100}%`, height: `${place.h * 100}%` }}
      >
        {/* ⚠️ THE RING IS ITS OWN BOX, not a border on the one being measured against.
            A border eats the content box a percentage child is sized from, so the creature
            came out 1.79% of the page against the 1.83% it should be — two per cent, found
            only because the check measured the painted rectangle rather than trusting the
            sum that drew it. Small here, and the same mistake anywhere else is not. */}
        <u />
        <b
          style={{
            width: `${(creature.w / place.w) * 100}%`,
            height: `${(creature.h / place.h) * 100}%`,
          }}
        />
      </span>
    </span>
  )
}
