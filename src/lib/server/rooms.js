import { env } from '$env/dynamic/private';
import { RoomStore } from './room-store.js';

// Keep one store/subscriber registry across development hot reloads as well.
const globalStore = /** @type {typeof globalThis & { lightningRooms?: RoomStore }} */ (globalThis);

export function getRoomStore() {
  if (!globalStore.lightningRooms) {
    const store = new RoomStore(env.DATABASE_PATH || 'data/timers.sqlite');
    store.cleanup();
    const cleanup = setInterval(() => store.cleanup(), 60 * 60 * 1000);
    cleanup.unref();
    globalStore.lightningRooms = store;
  }
  return globalStore.lightningRooms;
}
