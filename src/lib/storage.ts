import type { UserProfile } from "../types/api";

const DB_NAME = "whisperbox-client";
export const DB_VERSION = 2;
const STORE = "session";
const KEY = "current";

export type StoredSession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  user: UserProfile;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
      if (!request.result.objectStoreNames.contains("local-users")) {
        request.result.createObjectStore("local-users", { keyPath: "id" });
      }
      if (!request.result.objectStoreNames.contains("local-messages")) {
        request.result.createObjectStore("local-messages", { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const request = action(transaction.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
}

export async function saveSession(session: StoredSession): Promise<void> {
  await withStore("readwrite", (store) => store.put(session, KEY));
}

export async function getSession(): Promise<StoredSession | null> {
  return (await withStore("readonly", (store) => store.get(KEY))) ?? null;
}

export async function clearSession(): Promise<void> {
  await withStore("readwrite", (store) => store.delete(KEY));
}
