import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const ROOM_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_DURATION_MS = (999 * 60 + 59) * 1000;

/**
 * @typedef {object} TimerState
 * @property {string} room
 * @property {number} duration_ms
 * @property {'idle' | 'running' | 'paused'} status
 * @property {number} remaining_ms Remaining at the last start/resume, or while paused.
 * @property {number | null} started_at UTC Unix epoch milliseconds.
 * @property {number} revision
 * @property {number} updated_at
 * @property {number} last_active_at
 */

/** @param {TimerState} state @param {number} now */
export function remainingTime(state, now) {
  return Math.max(0, state.remaining_ms - (state.status === 'running' ? now - /** @type {number} */ (state.started_at) : 0));
}

export class CommandError extends Error {}

/** @param {unknown} input */
export function validateCommand(input) {
  if (!input || typeof input !== 'object' || !('action' in input)) {
    throw new CommandError('A timer action is required.');
  }
  const { action } = input;
  if (!['start', 'pause', 'reset', 'duration', 'seek'].includes(/** @type {string} */ (action))) {
    throw new CommandError('Unknown timer action.');
  }
  let value = 0;
  if (action === 'duration' || action === 'seek') {
    value = 'value' in input ? /** @type {number} */ (input.value) : NaN;
    if (typeof value !== 'number' || !Number.isFinite(value)
      || (action === 'duration' && (!Number.isInteger(value) || value < 1000 || value > MAX_DURATION_MS))
      || (action === 'seek' && (value < 0 || value > 1))) {
      throw new CommandError('Invalid timer value.');
    }
  }
  return { action, value };
}

/** Single-process store: synchronous transactions finish before any broadcasts. */
export class RoomStore {
  /** @type {Map<string, Set<(state: TimerState) => void>>} */
  subscribers = new Map();

  /** @param {string} path @param {() => number} [clock] */
  constructor(path, clock = Date.now) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.clock = clock;
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS rooms (
        room TEXT PRIMARY KEY,
        duration_ms INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('idle', 'running', 'paused')),
        remaining_ms INTEGER NOT NULL,
        started_at INTEGER,
        revision INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        last_active_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS rooms_last_active ON rooms(last_active_at);
    `);
  }

  /** @param {string} room */
  getOrCreate(room) {
    const now = this.clock();
    this.db.prepare(`INSERT OR IGNORE INTO rooms
      (room, duration_ms, status, remaining_ms, started_at, updated_at, last_active_at)
      VALUES (?, 300000, 'idle', 300000, NULL, ?, ?)`).run(room, now, now);
    return this.get(room);
  }

  /** @param {string} room */
  get(room) {
    return /** @type {TimerState} */ (/** @type {unknown} */ (
      this.db.prepare('SELECT * FROM rooms WHERE room = ?').get(room)
    ));
  }

  /** @param {string} room @param {unknown} input */
  command(room, input) {
    const { action, value } = validateCommand(input);
    const now = this.clock();
    this.db.exec('BEGIN IMMEDIATE');
    let state;
    try {
      state = this.getOrCreate(room);
      const remaining = remainingTime(state, now);
      if (action === 'start') {
        // Explicit start/pause commands are safe if two clients press them together.
        if (state.status !== 'running' || remaining === 0) {
          state.remaining_ms = remaining || state.duration_ms;
          state.started_at = now;
          state.status = 'running';
        }
      } else if (action === 'pause') {
        if (state.status === 'running') {
          state.remaining_ms = remaining;
          state.started_at = null;
          state.status = 'paused';
        }
      } else if (action === 'reset' || action === 'duration') {
        if (action === 'duration') state.duration_ms = value;
        state.remaining_ms = state.duration_ms;
        state.started_at = null;
        state.status = 'idle';
      } else if (action === 'seek') {
        state.remaining_ms = Math.round(state.duration_ms * (1 - value));
        if (state.status === 'running' && remaining > 0) {
          state.started_at = now;
        } else {
          state.started_at = null;
          state.status = value === 0 ? 'idle' : 'paused';
        }
      }
      state.revision += 1;
      state.updated_at = now;
      state.last_active_at = now;
      this.db.prepare(`UPDATE rooms SET duration_ms = ?, status = ?, remaining_ms = ?,
        started_at = ?, revision = ?, updated_at = ?, last_active_at = ? WHERE room = ?`)
        .run(state.duration_ms, state.status, state.remaining_ms, state.started_at,
          state.revision, now, now, room);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    for (const listener of this.subscribers.get(room) || []) listener(state);
    return state;
  }

  /** Sends the initial snapshot and registers the listener without an async gap.
   * @param {string} room @param {(state: TimerState) => void} listener
   */
  subscribe(room, listener) {
    const state = this.getOrCreate(room);
    this.touch(room);
    let listeners = this.subscribers.get(room);
    if (!listeners) this.subscribers.set(room, listeners = new Set());
    listeners.add(listener);
    listener(state);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.subscribers.delete(room);
        // Start the inactivity window when the last viewer leaves, not when they joined.
        this.touch(room);
      }
    };
  }

  /** @param {string} room */
  touch(room) {
    this.db.prepare('UPDATE rooms SET last_active_at = ? WHERE room = ?').run(this.clock(), room);
  }

  cleanup() {
    const cutoff = this.clock() - ROOM_TTL_MS;
    const expired = this.db.prepare(`SELECT room FROM rooms WHERE last_active_at <= ?
      AND (status != 'running' OR started_at + remaining_ms <= ?)`).all(cutoff, cutoff);
    const remove = this.db.prepare('DELETE FROM rooms WHERE room = ?');
    for (const row of expired) {
      const room = String(row.room);
      if (!this.subscribers.has(room)) remove.run(room);
    }
  }

  close() {
    this.db.close();
  }
}
