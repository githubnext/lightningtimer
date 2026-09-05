import { error, json } from '@sveltejs/kit';
import { getRoomStore } from '$lib/server/rooms.js';
import { CommandError } from '$lib/server/room-store.js';

/** @type {import('./$types').RequestHandler} */
export async function POST({ params, request, url }) {
  // No authentication, but don't let unrelated websites control rooms via visitors.
  if (request.headers.get('origin') !== url.origin) error(403, 'Same-origin requests only.');
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') {
    error(415, 'Expected JSON.');
  }
  // Read a bounded body even if Content-Length is omitted.
  const reader = request.body?.getReader();
  if (!reader) error(400, 'Missing command.');
  const chunks = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 1024) {
      await reader.cancel();
      error(413, 'Command too large.');
    }
    chunks.push(value);
  }
  let command;
  try {
    command = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    error(400, 'Invalid JSON.');
  }
  try {
    return json(getRoomStore().command(params.room, command), {
      headers: { 'Cache-Control': 'no-store' }
    });
  } catch (cause) {
    if (cause instanceof CommandError) error(400, cause.message);
    throw cause;
  }
}
