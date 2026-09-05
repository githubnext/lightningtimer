import { getRoomStore } from '$lib/server/rooms.js';

/** @type {import('./$types').RequestHandler} */
export function GET({ params, request }) {
  const store = getRoomStore();
  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      let unsubscribe = () => {};
      /** @type {ReturnType<typeof setInterval> | undefined} */
      let heartbeat;
      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        request.signal.removeEventListener('abort', cleanup);
        try { controller.close(); } catch { /* Already cancelled. */ }
      };
      /** @param {string} message */
      const send = (message) => {
        if (closed) return;
        // Drop stalled clients instead of accumulating unbounded queued updates.
        if (controller.desiredSize !== null && controller.desiredSize < -10) {
          cleanup();
          return;
        }
        try { controller.enqueue(encoder.encode(message)); } catch { cleanup(); }
      };
      unsubscribe = store.subscribe(params.room, (state) => {
        send(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
      });
      heartbeat = setInterval(() => send('event: heartbeat\ndata: {}\n\n'), 15000);
      request.signal.addEventListener('abort', cleanup, { once: true });
      if (request.signal.aborted) cleanup();
    },
    cancel() { cleanup(); }
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no'
    }
  });
}
