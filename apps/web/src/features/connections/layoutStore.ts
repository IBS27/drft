import type { Group } from "./cluster";

// Group layouts, kept between visits: laying a large map out takes seconds,
// and a group that hasn't changed comes out the same every time. Kept per
// user in IndexedDB (a map's worth is too much for localStorage) and
// forgotten with the rest of the remembered session at sign-out.
//
// Every failure here — private mode, a full disk, no IndexedDB at all — only
// costs the head start: the group is laid out again.
const DB = "drft:connections";
const STORE = "groups";
// Moves when the same group would be laid out differently (anything in
// cluster.ts that changes where dots land): opening at a new version
// empties the store.
const VERSION = 1;

// Groups already laid out this session, by what they hold, so a change to
// one group leaves the others exactly as they were. Holds the current map
// and no more (useGroupLayouts).
export const laidOut = new Map<string, Group>();

let opening: Promise<IDBDatabase> | undefined;

function open(): Promise<IDBDatabase> {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(DB, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (db.objectStoreNames.contains(STORE)) db.deleteObjectStore(STORE);
      db.createObjectStore(STORE);
    };
    request.onsuccess = () => {
      const db = request.result;
      // Sign-out deletes the database; step aside rather than block it.
      db.onversionchange = () => {
        db.close();
        opening = undefined;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("blocked"));
  });
  opening.catch(() => {
    opening = undefined;
  });
  return opening;
}

function finished(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

// A group's key holds its thoughts' words; what's stored is named by a
// digest of it instead, under the user it belongs to.
async function nameOf(userId: string, key: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${userId}:${hex}`;
}

// The kept layouts among `keys`, by key.
export async function readGroups(userId: string, keys: string[]): Promise<Map<string, Group>> {
  const found = new Map<string, Group>();
  try {
    const names = await Promise.all(keys.map((key) => nameOf(userId, key)));
    const store = (await open()).transaction(STORE).objectStore(STORE);
    await Promise.all(
      names.map(
        (name, i) =>
          new Promise<void>((resolve) => {
            const request = store.get(name);
            request.onsuccess = () => {
              // Our own versioned write, so the shape is a Group.
              if (request.result !== undefined) found.set(keys[i], request.result as Group);
              resolve();
            };
            request.onerror = () => resolve();
          }),
      ),
    );
  } catch {
    // Nothing kept, as far as this visit can tell.
  }
  return found;
}

export async function writeGroup(userId: string, key: string, group: Group): Promise<void> {
  try {
    const name = await nameOf(userId, key);
    const transaction = (await open()).transaction(STORE, "readwrite");
    transaction.objectStore(STORE).put(group, name);
    await finished(transaction);
  } catch {
    // It will be laid out again next time.
  }
}

// Lets go of this user's layouts for groups the map no longer has, so the
// store holds one map's worth and no more.
export async function keepOnlyGroups(userId: string, keys: string[]): Promise<void> {
  try {
    const keep = new Set(await Promise.all(keys.map((key) => nameOf(userId, key))));
    const transaction = (await open()).transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    const mine = IDBKeyRange.bound(`${userId}:`, `${userId}:￿`);
    const request = store.getAllKeys(mine);
    request.onsuccess = () => {
      for (const name of request.result) if (!keep.has(String(name))) store.delete(name);
    };
    await finished(transaction);
  } catch {
    // Left for the next visit to tidy.
  }
}

// Sign-out forgets them all (features/auth/rememberedSession). This module
// stays light — no layout code — so forgetting doesn't pull the map into
// the first load.
export function clearGroupLayouts(): void {
  laidOut.clear();
  try {
    opening = undefined;
    window.indexedDB.deleteDatabase(DB);
  } catch {
    // Nothing stored, nothing to clear.
  }
}
