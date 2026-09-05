# Lightning Timer

A focused, full-screen countdown timer for lightning talks, built with SvelteKit and a single Node.js server.

## Local and shared timers

- **`/`** is a local-only timer. It makes no timer API requests and saves only the selected duration in your browser's local storage.
- **`/your-room`** creates or joins a shared timer. Open the same URL on any machine to see and control the same countdown. Shared rooms start at five minutes and do not use local-storage preferences.
- Room names are case-sensitive, 1–64 characters, and may contain letters, digits, hyphens, and underscores. `api` is reserved. Nested page paths such as `/foo/bar` return 404.
- There is **no authentication**: anyone who knows or guesses the URL can change its timer. Rooms are not private.

### Controls

- Start, pause, resume, reset, seek, and change duration from any connected tab.
- Drag the top progress bar to preview a seek locally; releasing it commits the change to everyone. Cancelling a drag discards the shared-room preview.
- Opening settings in a shared room does **not** pause the timer. Applying a duration resets it for everyone. Local timers retain the original pause-on-settings behavior.
- Keyboard shortcuts: `Space` starts/pauses, `R` resets, and `S` opens settings. The focused progress bar supports arrow keys (5 seconds, or 30 with Shift), Home, and End.
- Quick 3, 5, 7, and 10 minute presets; full-screen mode; viewport-filling display.
- Yellow for the last minute, red for the final 15 seconds, and a red background at zero.

Disconnected shared timers continue displaying the last known countdown, with a reconnecting indicator. Shared controls are disabled until a fresh connection and snapshot arrive. Offline commands are never queued or replayed. Full-screen mode and opening settings remain local interactions.

## How synchronization works

The server accepts explicit commands over HTTP POST and broadcasts complete state snapshots over **Server-Sent Events (SSE)**. Each room has a revision counter so late HTTP responses cannot overwrite newer SSE state. Simultaneous commands are applied in server-received order; start and pause are explicit actions, not toggles.

SQLite stores duration, status, remaining time at the last start/resume, the server-generated UTC start timestamp (Unix epoch milliseconds), revision, and activity timestamps. While running:

```text
remaining = max(0, remaining_at_start - (server_now - started_at))
```

Clients estimate the server clock with a timestamped request, then animate using their local monotonic clock. They refresh that estimate and receive a full snapshot when connecting/reconnecting or returning to a visible tab. Slight differences in network latency are acceptable; computer wall-clock differences do not affect the countdown.

**No countdown ticks or SSE heartbeats write to SQLite.** Writes happen for commands and room presence transitions. Completion is derived from the stored time anchor, so timers keep counting across server restarts without scheduled per-timer jobs.

### Ephemeral rooms

SQLite has no native row TTL. Cleanup runs on startup and hourly:

- Rooms become eligible for deletion after 24 hours without viewers or commands.
- Connected rooms are retained; the inactivity clock starts when the last viewer disconnects.
- Running timers are retained until at least 24 hours after their calculated finish time.
- Visiting a deleted room creates a fresh five-minute timer.

Live connections are tracked in memory, not written every few seconds. After an abrupt server stop, cleanup uses the last activity timestamp persisted before the interruption.

## Development

Requires **Node.js 24 or later** (uses the built-in `node:sqlite` module) and **pnpm 11.18.0** (pinned in `package.json`).

```sh
pnpm install --frozen-lockfile
pnpm run dev
```

The database is created lazily when the first room connects, at `data/timers.sqlite` by default. Set `DATABASE_PATH` to override it. The parent directory is created automatically.

## Checks and tests

```sh
pnpm run check
pnpm test                  # Timer state, validation, persistence, subscriptions, cleanup
pnpm run test:integration  # Builds, then tests HTTP/SSE and production-server restart
pnpm exec playwright install chromium
pnpm run test:browser      # Builds, then tests local mode, two clients, clock skew, reconnects
```

Tests use isolated databases, not the application's normal database.

## Production deployment

This application needs **one long-running Node process and persistent local disk**. It is no longer a static site; GitHub Pages deployment has been removed. Multiple workers/replicas are not supported because SSE subscribers are held in process memory.

```sh
pnpm install --frozen-lockfile
pnpm run check
pnpm run build

ORIGIN=https://timer.example.com \
HOST=127.0.0.1 \
PORT=3000 \
DATABASE_PATH=/var/lib/lightningtimer/timers.sqlite \
pnpm start
```

Set `ORIGIN` to the public site origin (scheme and host, no path), especially behind a reverse proxy. Timer commands must come from that same origin. Run the process using your preferred service manager, and ensure its user can write to the database directory. On deployment, preserve that directory and its SQLite WAL/SHM files rather than replacing it with the build output.

The reverse proxy must support long-lived streaming responses and must not buffer SSE. For example, with nginx:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_buffering off;
    proxy_read_timeout 60s;
}
```

SSE endpoints also send `X-Accel-Buffering: no` and a heartbeat every 15 seconds. Use HTTPS in production. For public deployments, optional proxy-level connection and request limits can bound resource use without adding room authentication.
