import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';

async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const port = address.port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test('production server: local route, shared SSE commands, validation and restart', { timeout: 40000 }, async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'lightningtimer-http-'));
  const database = join(directory, 'timers.sqlite');
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  /** @type {import('node:child_process').ChildProcess | undefined} */
  let child;
  let logs = '';
  /** @type {{ close: () => void }[]} */
  const streams = [];

  async function start() {
    child = spawn(process.execPath, ['build/index.js'], {
      env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), ORIGIN: origin,
        DATABASE_PATH: database, SHUTDOWN_TIMEOUT: '1' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    child.stdout?.on('data', (chunk) => { logs += chunk; });
    child.stderr?.on('data', (chunk) => { logs += chunk; });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) throw new Error(logs);
      try {
        const response = await fetch(origin);
        if (response.ok) return;
      } catch { /* Wait for the listening socket. */ }
      await delay(50);
    }
    throw new Error(`Server did not start: ${logs}`);
  }

  async function stop() {
    if (!child || child.exitCode !== null) return;
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    await exited;
  }

  /** @param {string} room */
  async function subscribe(room) {
    const abort = new AbortController();
    const response = await fetch(`${origin}/api/rooms/${room}/events`, { signal: abort.signal });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/event-stream');
    assert.equal(response.headers.get('x-accel-buffering'), 'no');
    assert.ok(response.body);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const stream = {
      async next() {
        while (true) {
          const boundary = buffer.indexOf('\n\n');
          if (boundary >= 0) {
            const message = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            if (message.startsWith('event: state\n')) {
              return JSON.parse(message.split('\ndata: ')[1]);
            }
          } else {
            const { value, done } = await reader.read();
            assert.equal(done, false, 'SSE unexpectedly closed');
            buffer += decoder.decode(value, { stream: true });
          }
        }
      },
      close() { abort.abort(); }
    };
    streams.push(stream);
    return stream;
  }

  /** @param {unknown} command @param {string} [room] @param {Record<string, string>} [headers] */
  async function post(command, room = 'talk', headers = {}) {
    return fetch(`${origin}/api/rooms/${room}`, {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(command)
    });
  }

  t.after(async () => {
    for (const stream of streams) stream.close();
    await stop();
    rmSync(directory, { recursive: true, force: true });
  });

  await start();
  assert.equal(existsSync(database), false, '/ must not access SQLite');
  assert.equal((await fetch(`${origin}/talk`)).status, 200);
  assert.equal((await fetch(`${origin}/foo/bar`)).status, 404);
  assert.equal((await fetch(`${origin}/api`)).status, 404);
  assert.equal((await fetch(`${origin}/bad.name`)).status, 404);
  const clockResponse = await fetch(`${origin}/api/clock`);
  assert.equal(clockResponse.headers.get('cache-control'), 'no-store');
  assert.ok(Math.abs((await clockResponse.json()).serverNow - Date.now()) < 2000);
  assert.equal(existsSync(database), false);

  const a = await subscribe('talk');
  const b = await subscribe('talk');
  assert.equal((await a.next()).status, 'idle');
  assert.equal((await b.next()).revision, 0);
  assert.ok(existsSync(database));

  const started = await (await post({ action: 'start' })).json();
  assert.deepEqual(await a.next(), started);
  assert.deepEqual(await b.next(), started);
  assert.ok(Math.abs(started.started_at - Date.now()) < 2000);
  await delay(100);
  const c = await subscribe('talk');
  const late = await c.next();
  assert.equal(late.started_at, started.started_at);
  assert.equal(late.revision, started.revision);
  c.close();

  const paused = await (await post({ action: 'pause' })).json();
  assert.equal(paused.status, 'paused');
  assert.ok(paused.remaining_ms < 300000);
  assert.deepEqual(await a.next(), paused);
  assert.deepEqual(await b.next(), paused);

  assert.equal((await post({ action: 'duration', value: -1 })).status, 400);
  assert.equal((await post({ action: 'toggle' })).status, 400);
  assert.equal((await post({ action: 'reset' }, 'talk', { Origin: 'https://other.example' })).status, 403);
  assert.equal((await post({ action: 'reset', padding: 'x'.repeat(1024) })).status, 413);
  assert.equal((await post({ action: 'reset' }, 'talk', { 'Content-Type': 'text/plain' })).status, 415);

  a.close();
  b.close();
  await stop();
  await start();
  const reconnected = await subscribe('talk');
  const persisted = await reconnected.next();
  assert.equal(persisted.revision, paused.revision);
  assert.equal(persisted.remaining_ms, paused.remaining_ms);
  const reset = await (await post({ action: 'reset' })).json();
  assert.equal(reset.status, 'idle');
  assert.deepEqual(await reconnected.next(), reset);
  const other = await subscribe('other');
  assert.equal((await other.next()).revision, 0);
});
