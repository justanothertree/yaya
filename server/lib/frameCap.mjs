/**
 * The largest frame the relay reads from a client, in bytes, and the reason it is that size.
 *
 * ws-server.js gives this to `ws` as `maxPayload`, which reads a frame's declared length before
 * its body and closes the socket with 1009 the moment a message would pass it — so a frame over the
 * cap is never buffered at all. Without `maxPayload` the ceiling is `ws`'s own default of 100 MiB,
 * whatever any check further in says. The stub relay imports the same number, so the double's pipe
 * is as wide as the real one.
 *
 * ⚠️ SIZED FROM THE LARGEST REAL MESSAGE, NOT FROM A ROUND NUMBER. That is Snake's `preview`, sent
 * every tick: the sender's whole board state, one `{x, y}` per snake cell and per apple. The apples
 * box goes up to every free cell (by request; sanitizeSettings has no upper bound on apples), so a
 * board full of apples carries a point for every cell. The site's buttons stop at 48 × 48, but the
 * largest board is the largest grid sanitizeSettings accepts: a room set to that is a room the
 * relay keeps, and every honest client in it then sends previews that size, a little over 55 KiB.
 * Every other frame any client sends is a fraction of it: a park creature or boss is held under
 * MAX_LOOK_BYTES, a chat line is 300 characters, and the rest are a handful of numbers.
 *
 * So 64 KiB: more than a tenth above the largest frame an honest client can be made to send, and
 * still a small, fixed cost per socket. scripts/relay-frame-cap.test.mjs builds that preview with
 * the real engine at the largest grid the relay allows and asserts both halves, so a bigger board,
 * a new field on the preview or a tighter cap fails a test rather than a player.
 *
 * ⚠️ AT 32 KiB A REAL FRAME DID NOT FIT, UNTIL 26 Nov 2026. The cap was 32,768 and the Huge board
 * (48 × 48) with the apples box at its own maximum sends a preview of about 35 KiB — so the relay
 * closed that player's socket with 1009 on the first preview of that board, in a room the site's
 * own buttons had set up. The most the client says is "Lobby offline — continuing solo", which is
 * not the reason.
 *
 * ⚠️ A KIND THAT CARRIES A PAYLOAD OF ITS OWN KEEPS ITS OWN CEILING BELOW THIS ONE, measured in
 * what the frame costs on the wire. JSON escaping is part of that cost: a quote is two bytes and a
 * control character is six, so a ceiling on a string's own bytes can be up to six times smaller
 * than the frame that carries it.
 */
export const MAX_MSG_BYTES = 65536
