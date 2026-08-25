# Two WebSocket messages could take the whole relay down — 2026-08-25

Found by review, reproduced against the real server, fixed and re-reproduced.

The relay is one process and it is not only multiplayer: it also serves `/ice` (the TURN
credentials every voice call needs), `/usage`, `/relay-config` and `/import-trades`. The socket
is unauthenticated and accepts any origin, so both of these were runnable from any browser
console, and Render restarting the process just meant doing it again.

## 1. One message, process dead

```json
{"type":"hello","room":"r1","create":true}
{"type":"preview","state":{"snake":[null]}}
```

`Array.isArray(msg.state.snake)` was checked; the **elements** were not. `p.x` on a `null`
element throws synchronously inside `ws.on('message')`, which had no `try`/`catch`, so the
exception escaped `emit()` and Node exited.

Measured on the unpatched server: the next connection attempt failed outright and the log ended
in `TypeError: Cannot read properties of null (reading 'x')`. On the patched one the relay stays
up through that message and five more malformed shapes (`[{}]`, `[{x:'a',y:'b'}]`, `[undefined]`,
`[[]]`, `[{x:null,y:1}]`).

Two changes, because one is not enough: the elements are filtered where the body is read, and the
whole handler now runs inside a `try`/`catch`. Validating field by field is a race the relay
loses eventually; a relay must not die of a peer's payload. `process.on('uncaughtException')` and
`unhandledRejection` are the backstop for the several `void somePromise()` call sites whose
callbacks would otherwise reach the default exit.

## 2. One socket could mint rooms forever, and `list` amplified them 478,000×

`hello` reassigned `joinedRoomId` without leaving the previous room, and `close` only ever
cleaned the last one. So the old room kept an entry for a socket that had gone, `clients.size`
could never reach `0`, and it was therefore never deleted — the rooms outlived the connection.

Measured on the unpatched server: **60,000 hellos down one socket in 4.1s** left 59,999 rooms
resident at 186 MB, and `list` — unauthenticated, and it enumerates every room — turned a 15-byte
request into a 7.2 MB response, `JSON.stringify`-ed on the event loop.

Measured after: 3,000 hellos down one socket, then close → **0 rooms resident**, relay alive.

The shipped client never hit this because it opens a fresh socket per room, which is exactly why
it went unnoticed. `MAX_ROOMS` (default 500) is a second ceiling so that neither a bug nor a
stranger can turn room creation into memory exhaustion.

## Still open

No ping/pong heartbeat. A half-open TCP socket pins its room by the same mechanism as #2, with no
malice involved — worth an `isAlive` sweep. WS connection-rate limiting is also still unswept and
remains on the list in `OPEN-DECISIONS.md` §7.
