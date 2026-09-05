/** @typedef {import('./server/room-store.js').TimerState} TimerState */

/**
 * HTTP carries commands; SSE carries complete authoritative snapshots.
 * Time is anchored to performance.now(), not the browser's wall clock.
 * @param {string} room
 * @param {{ onState: (state: TimerState) => void, onConnection: (connected: boolean) => void }} callbacks
 */
export function createSharedTimer(room, callbacks) {
  const endpoint = `/api/rooms/${encodeURIComponent(room)}`;
  /** @type {EventSource | undefined} */
  let source;
  /** @type {TimerState | undefined} */
  let state;
  let serverEpoch = 0;
  let connected = false;
  let clockReady = false;
  let hasSnapshot = false;
  let disposed = false;
  let generation = 0;
  let lastHeard = performance.now();
  /** @type {AbortController | undefined} */
  let clockRequest;
  /** @type {Set<AbortController>} */
  const commands = new Set();
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let retry;

  /** @param {boolean} value */
  function setConnected(value) {
    connected = value;
    callbacks.onConnection(value);
  }

  /** @param {TimerState} snapshot */
  function accept(snapshot) {
    if (state && snapshot.revision < state.revision) return;
    state = snapshot;
    if (clockReady) {
      callbacks.onState(snapshot);
      if (hasSnapshot && !connected) setConnected(true);
    }
  }

  function ready() {
    if (clockReady && hasSnapshot && state) {
      callbacks.onState(state);
      setConnected(true);
    }
  }

  function reconnectSoon() {
    if (disposed) return;
    generation += 1;
    source?.close();
    clockRequest?.abort();
    setConnected(false);
    clearTimeout(retry);
    retry = setTimeout(connect, 2000);
  }

  function connect() {
    if (disposed) return;
    clearTimeout(retry);
    source?.close();
    clockRequest?.abort();
    const currentGeneration = ++generation;
    clockReady = false;
    hasSnapshot = false;
    // A room may have expired while offline. Its first snapshot can have a new revision 0.
    state = undefined;
    lastHeard = performance.now();
    setConnected(false);
    source = new EventSource(`${endpoint}/events`);
    source.addEventListener('heartbeat', () => { lastHeard = performance.now(); });
    source.addEventListener('state', (event) => {
      if (currentGeneration !== generation) return;
      lastHeard = performance.now();
      hasSnapshot = true;
      accept(JSON.parse(event.data));
    });
    source.onopen = async () => {
      lastHeard = performance.now();
      const controller = new AbortController();
      clockRequest = controller;
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const start = performance.now();
        const response = await fetch('/api/clock', { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('Clock request failed.');
        const { serverNow } = await response.json();
        const end = performance.now();
        if (disposed || currentGeneration !== generation) return;
        // Midpoint approximation compensates for clock skew and roughly half the RTT.
        serverEpoch = serverNow - (start + end) / 2;
        clockReady = true;
        ready();
      } catch {
        if (!disposed && currentGeneration === generation) reconnectSoon();
      } finally {
        clearTimeout(timeout);
      }
    };
    source.onerror = () => {
      if (currentGeneration === generation) reconnectSoon();
    };
  }

  // Detect half-open connections, including a server that vanished without a TCP close.
  const watchdog = setInterval(() => {
    if (performance.now() - lastHeard > 45000) {
      lastHeard = performance.now();
      reconnectSoon();
    }
  }, 5000);
  const onVisible = () => {
    if (document.visibilityState === 'visible') connect();
  };
  document.addEventListener('visibilitychange', onVisible);
  connect();

  return {
    /** @param {TimerState} snapshot */
    remaining(snapshot) {
      const elapsed = snapshot.status === 'running'
        ? serverEpoch + performance.now() - /** @type {number} */ (snapshot.started_at)
        : 0;
      // A small clock-estimation error must not display more than the anchor's remaining time.
      return Math.max(0, snapshot.remaining_ms - Math.max(0, elapsed));
    },
    /** @param {string} action @param {number} [value] */
    async send(action, value) {
      if (!connected || disposed) throw new Error('Disconnected. Wait for the room to reconnect.');
      const controller = new AbortController();
      commands.add(controller);
      const currentGeneration = generation;
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        let response;
        try {
          response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, value }),
            signal: controller.signal
          });
        } catch {
          if (currentGeneration === generation) reconnectSoon();
          throw new Error('Could not confirm the change. Reconnecting to check the timer.');
        }
        if (!response.ok) {
          throw new Error('The timer change was rejected. Please try again.');
        }
        let snapshot;
        try {
          snapshot = await response.json();
        } catch {
          if (currentGeneration === generation) reconnectSoon();
          throw new Error('Could not confirm the change. Reconnecting to check the timer.');
        }
        if (!disposed && currentGeneration === generation) accept(snapshot);
      } finally {
        clearTimeout(timeout);
        commands.delete(controller);
      }
    },
    destroy() {
      disposed = true;
      generation += 1;
      source?.close();
      clockRequest?.abort();
      for (const command of commands) command.abort();
      clearTimeout(retry);
      clearInterval(watchdog);
      document.removeEventListener('visibilitychange', onVisible);
    }
  };
}
