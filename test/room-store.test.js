import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { CommandError, MAX_DURATION_MS, remainingTime, RoomStore, ROOM_TTL_MS } from '../src/lib/server/room-store.js';
import { match } from '../src/params/room.js';

function fixture() {
  let now = Date.UTC(2026, 0, 1);
  const store = new RoomStore(':memory:', () => now);
  return { store, now: () => now, advance: (/** @type {number} */ ms) => { now += ms; } };
}

test('start, pause, resume and finish use server time without tick writes', (t) => {
  const { store, now, advance } = fixture();
  t.after(() => store.close());
  assert.equal(store.getOrCreate('talk').duration_ms, 300000);
  const running = store.command('talk', { action: 'start' });
  assert.equal(running.started_at, now());
  const writes = store.db.prepare('SELECT total_changes() AS n').get()?.n;
  advance(12345);
  assert.equal(remainingTime(store.get('talk'), now()), 287655);
  assert.equal(store.db.prepare('SELECT total_changes() AS n').get()?.n, writes);
  const paused = store.command('talk', { action: 'pause' });
  assert.equal(paused.remaining_ms, 287655);
  assert.equal(paused.started_at, null);
  advance(50000);
  assert.equal(remainingTime(store.get('talk'), now()), 287655);
  const resumed = store.command('talk', { action: 'start' });
  assert.equal(resumed.started_at, now());
  assert.equal(resumed.remaining_ms, 287655);
  advance(300000);
  assert.equal(remainingTime(store.get('talk'), now()), 0);
  assert.equal(store.get('talk').revision, resumed.revision);
  const restarted = store.command('talk', { action: 'start' });
  assert.equal(remainingTime(restarted, now()), 300000);
});

test('explicit simultaneous start/pause commands do not toggle twice', (t) => {
  const { store, advance } = fixture();
  t.after(() => store.close());
  const first = store.command('talk', { action: 'start' });
  advance(1000);
  const second = store.command('talk', { action: 'start' });
  assert.equal(first.started_at, second.started_at);
  assert.equal(second.revision, first.revision + 1);
  const paused = store.command('talk', { action: 'pause' });
  advance(1000);
  assert.equal(store.command('talk', { action: 'pause' }).remaining_ms, paused.remaining_ms);
});

test('duration, reset and seek preserve the intended running/paused states', (t) => {
  const { store, now, advance } = fixture();
  t.after(() => store.close());
  store.command('talk', { action: 'duration', value: 60000 });
  let state = store.command('talk', { action: 'seek', value: 0.25 });
  assert.equal(state.status, 'paused');
  assert.equal(state.remaining_ms, 45000);
  store.command('talk', { action: 'start' });
  advance(2000);
  state = store.command('talk', { action: 'seek', value: 0.5 });
  assert.equal(state.status, 'running');
  assert.equal(state.started_at, now());
  assert.equal(state.remaining_ms, 30000);
  state = store.command('talk', { action: 'seek', value: 1 });
  assert.equal(remainingTime(state, now()), 0);
  state = store.command('talk', { action: 'seek', value: 0.5 });
  assert.equal(state.status, 'paused');
  state = store.command('talk', { action: 'reset' });
  assert.equal(state.status, 'idle');
  assert.equal(state.remaining_ms, 60000);
  store.command('talk', { action: 'start' });
  state = store.command('talk', { action: 'duration', value: 120000 });
  assert.equal(state.status, 'idle');
  assert.equal(state.started_at, null);
  assert.equal(state.remaining_ms, 120000);
});

test('subscriptions get initial state, committed updates, and room isolation', (t) => {
  const { store } = fixture();
  t.after(() => store.close());
  /** @type {import('../src/lib/server/room-store.js').TimerState[]} */
  const a = [];
  /** @type {import('../src/lib/server/room-store.js').TimerState[]} */
  const b = [];
  /** @type {import('../src/lib/server/room-store.js').TimerState[]} */
  const other = [];
  const leaveA = store.subscribe('talk', (state) => {
    assert.equal(store.get('talk').revision, state.revision);
    a.push(state);
  });
  const leaveB = store.subscribe('talk', (state) => b.push(state));
  const leaveOther = store.subscribe('other', (state) => other.push(state));
  store.command('talk', { action: 'start' });
  assert.deepEqual(a, b);
  assert.equal(a.length, 2);
  assert.equal(other.length, 1);
  leaveA();
  leaveA();
  store.command('talk', { action: 'pause' });
  assert.equal(a.length, 2);
  assert.equal(b.length, 3);
  leaveB();
  leaveOther();
  assert.equal(store.subscribers.size, 0);
});

test('cleanup expires inactive rooms but preserves viewers and recent running timers', (t) => {
  const { store, advance } = fixture();
  t.after(() => store.close());
  store.getOrCreate('idle');
  store.command('paused', { action: 'seek', value: 0.5 });
  store.command('running', { action: 'start' });
  const leave = store.subscribe('viewed', () => {});
  advance(ROOM_TTL_MS);
  store.cleanup();
  assert.equal(store.get('idle'), undefined);
  assert.equal(store.get('paused'), undefined);
  assert.ok(store.get('running')); // Less than 24h since it finished.
  assert.ok(store.get('viewed'));
  advance(300000);
  store.cleanup();
  assert.equal(store.get('running'), undefined);
  leave();
  advance(ROOM_TTL_MS - 1);
  store.cleanup();
  assert.ok(store.get('viewed'));
  advance(1);
  store.cleanup();
  assert.equal(store.get('viewed'), undefined);
  assert.equal(store.getOrCreate('viewed').revision, 0);
});

test('invalid commands cannot create or change rooms', (t) => {
  const { store } = fixture();
  t.after(() => store.close());
  for (const command of [null, {}, { action: 'toggle' }, { action: 'duration', value: 0 },
    { action: 'duration', value: MAX_DURATION_MS + 1 }, { action: 'duration', value: 1000.1 },
    { action: 'duration', value: '1000' }, { action: 'seek', value: -0.1 },
    { action: 'seek', value: 1.1 }, { action: 'seek', value: NaN }]) {
    assert.throws(() => store.command('talk', command), CommandError);
  }
  assert.equal(store.get('talk'), undefined);
});

test('state persists across a server restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'lightningtimer-'));
  const path = join(directory, 'timers.sqlite');
  const first = new RoomStore(path);
  const state = first.command('talk', { action: 'start' });
  first.close();
  const second = new RoomStore(path);
  try {
    assert.deepEqual(second.get('talk'), state);
  } finally {
    second.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('room names are restricted to one short URL segment', () => {
  for (const name of ['talk', 'Talk_2026-09', 'a'.repeat(64)]) assert.ok(match(name));
  for (const name of ['', 'api', 'foo/bar', 'a'.repeat(65), '../foo', 'hello world', 'favicon.ico']) {
    assert.equal(match(name), false);
  }
});
