# The connection ceiling worked from the first deploy — 2026-08-26

Three deploys went into fixing a bug that did not exist. This is what actually happened, because
the wrong version of it was written into the code comments first and would have misled the next
person to touch that file.

## The claim, and the truth

The per-address connection ceiling shipped in `2a43249` and was reported as **not live**, on the
evidence that 35 connections from one machine, against a ceiling of 30, were all accepted. Two
further commits "fixed" it. Then the relay was asked to log its own decisions:

```
[relay][addr] pid=85 key="<the caller>" perAddr=30/30 global=30/240 tracked=1 ACCEPT
[relay][addr] pid=85 key="<the caller>" perAddr=31/30 global=31/240 tracked=1 REFUSE
```

One pid, `perAddr` climbing 1→40, ACCEPT through 30 and REFUSE from 31. It had been working
correctly the entire time, including in `2a43249`.

## Why it looked broken

**The verification ran on the client side and the signal never gets there.** The refusal is
`ws.close(4029, …)`, and Render's proxy completes the WebSocket handshake with the caller itself
and does not pass our close through. Measured: sockets the server had already refused reported
`open` and then **no close and no error for twelve seconds**.

So a refused connection and an accepted one are indistinguishable from outside. The test asked
the only question the proxy refuses to answer, got the same answer every time, and each "fix"
was confirmed broken by the same blind instrument.

## What the two intervening commits were actually worth

- `e6c49d7` moved the key from the rightmost `x-forwarded-for` entry to the leftmost, on a theory
  that Render appended a varying hop. **Render sends a single entry containing the client address
  and nothing else**, so both readings were always the same value and the change was a no-op. The
  same commit's `ws` 8.18 → 8.21.3 bump (a high-severity memory-exhaustion advisory on the
  process's own unauthenticated parser) and the global `CONN_BURST_GLOBAL` backstop were real.
- `db519ec` and `f988dd2` added the diagnostics. They cost two deploys and are the only reason
  any of this is known.

## The lesson, stated plainly

⚠️ **A check whose pass and fail look identical from where you are standing is not a check.**
Verify from the side that makes the decision. The relay knows exactly what it did; it simply was
never asked, for three rounds, while its behaviour was inferred from a socket that a proxy in the
middle had already decided to keep open.

The near-miss underneath it: had the ceiling genuinely been broken, the same instrument would have
reported it fixed the moment anything changed the timing.

## What changed as a result

- **A refused client is now told.** Close code 4029 was chosen as "a code a real client can act
  on" and it never arrives; ordinary data frames do. A `{type:'error',code:'rate-limited'}` frame
  is sent before the close. This reverses the original decision to stay silent — borrowed from
  the chat limiter, where saying nothing to a flooder is right. The trade is different here: a
  flooder learns nothing they could not measure anyway, while someone on a shared address gets a
  socket that never works and never says why.
- **The decisions are logged.** Eight lines per process start, plus every refusal, always. `pid`
  is on each line: an in-memory counter bounds nothing across instances, so if this relay is ever
  scaled past one process the lines will say so immediately — several pids each counting to 30.
- **The comments were corrected.** They asserted the ceiling "silently did nothing" and had "been
  wrong twice", which is now known to be false. Comments are this codebase's memory; leaving that
  version in place would have been the most expensive part of the whole episode.
