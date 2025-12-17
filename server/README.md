# Snake Multiplayer WS server

A minimal WebSocket relay for the Snake game. It pairs clients by `room`, broadcasts the initial shared seed/settings when two clients are present, and relays `input`, `tick`, and `over` messages between peers.

This server uses native WebSockets via the `ws` package to match the existing client `NetClient` implementation.

## API

Messages are JSON objects:

- Client → Server
  - `{ type: "hello", room: string }` — join a room
  - `{ type: "input", key: 'ArrowUp'|'ArrowDown'|'ArrowLeft'|'ArrowRight' }` — relay input
  - `{ type: "tick", n: number, score: number }` — relay current score and tick count
  - `{ type: "over", reason: 'die'|'quit' }` — notify peer of game end/quit

- Server → Client
  - `{ type: "seed", seed: number, settings: Settings }` — sent when 2 peers are present in a room
  - Echo relays of `input`, `tick`, and `over` from the other peer

`Settings` matches the client shape:

```
{
  grid: 30,
  apples: 2,
  passThroughEdges: true,
  canvasSize: 'medium'
}
```

## Run locally

```
# Windows PowerShell
cd server
npm install
npm start
```

Server listens on `http://localhost:10000`. The WS URL is `ws://localhost:10000`.

In the client, set `VITE_WS_URL=ws://localhost:10000` (e.g., in `.env.local`).

## Deploy to Render

1. Push this `server/` folder as its own repository (recommended), or select the subfolder when creating a new Render Web Service.
2. Render settings:

- Runtime: Node
- Build command: `npm install`
- Start command: `npm start`
- Root directory: `server` (if using a monorepo)

3. Environment variables (multiplayer leaderboard):

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
  These **must** be set on the WebSocket Render service for the server to call the `finalize_round_rpc` Supabase function and persist round results and trophies. If either is missing, rounds are still finalized locally in memory, but no scores are written to Supabase.

4. After deploy, set `VITE_WS_URL` in your site’s environment (build-time) to the `wss://` URL Render provides (e.g., `wss://your-app.onrender.com`).

## Notes

- This server now handles room metadata, restart, seeding, and server-owned Supabase finalization for multiplayer rounds.
- If you prefer Socket.IO, we can swap the client to `socket.io-client` and the server to `socket.io`. The current client uses native WebSockets, so `ws` keeps changes minimal.
