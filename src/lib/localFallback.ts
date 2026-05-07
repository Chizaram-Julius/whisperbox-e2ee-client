import type {
  AuthResponse,
  ConversationSummary,
  LoginRequest,
  MessageResponse,
  RegisterRequest,
  SendMessageRequest,
  TokenResponse,
  UserProfile,
  UserPublicInfo,
} from "../types/api";
import { arrayBufferToBase64 } from "./crypto";
import { DB_VERSION } from "./storage";

const DB_NAME = "whisperbox-client";
const USERS = "local-users";
const MESSAGES = "local-messages";
const ACCESS_PREFIX = "local-access:";
const REFRESH_PREFIX = "local-refresh:";
const TOKEN_TTL_SECONDS = 900;

type LocalUserRecord = UserProfile & {
  password_salt: string;
  password_hash: string;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("session")) {
        request.result.createObjectStore("session");
      }
      if (!request.result.objectStoreNames.contains(USERS)) {
        request.result.createObjectStore(USERS, { keyPath: "id" });
      }
      if (!request.result.objectStoreNames.contains(MESSAGES)) {
        request.result.createObjectStore(MESSAGES, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(storeName: string, mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const request = action(transaction.objectStore(storeName));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
}

async function getAll<T>(storeName: string): Promise<T[]> {
  return withStore<T[]>(storeName, "readonly", (store) => store.getAll());
}

async function put<T>(storeName: string, value: T): Promise<void> {
  await withStore<IDBValidKey>(storeName, "readwrite", (store) => store.put(value));
}

async function passwordDigest(password: string, saltBase64?: string): Promise<{ salt: string; hash: string }> {
  const salt = saltBase64 ? base64ToBytes(saltBase64) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const hash = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: toArrayBuffer(salt), iterations: 150_000, hash: "SHA-256" }, key, 256);
  return { salt: arrayBufferToBase64(toArrayBuffer(salt)), hash: arrayBufferToBase64(hash) };
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function publicProfile(user: LocalUserRecord): UserProfile {
  const { password_hash: _hash, password_salt: _salt, ...profile } = user;
  return profile;
}

function makeAuth(user: UserProfile): AuthResponse {
  return {
    access_token: `${ACCESS_PREFIX}${user.id}:${Date.now() + TOKEN_TTL_SECONDS * 1000}:${crypto.randomUUID()}`,
    refresh_token: `${REFRESH_PREFIX}${user.id}:${crypto.randomUUID()}`,
    token_type: "bearer",
    expires_in: TOKEN_TTL_SECONDS,
    user,
  };
}

export function isLocalAccessToken(token: string | null | undefined): token is string {
  return Boolean(token?.startsWith(ACCESS_PREFIX));
}

export function localUserIdFromToken(token: string): string {
  return token.split(":")[1] ?? "";
}

export async function localRegister(payload: RegisterRequest): Promise<AuthResponse> {
  const username = payload.username.trim().toLowerCase();
  const users = await getAll<LocalUserRecord>(USERS);
  if (users.some((user) => user.username === username)) {
    throw new Error("Username already exists in local fallback mode.");
  }

  const password = await passwordDigest(payload.password);
  const user: LocalUserRecord = {
    id: crypto.randomUUID(),
    username,
    display_name: payload.display_name,
    public_key: payload.public_key,
    wrapped_private_key: payload.wrapped_private_key,
    pbkdf2_salt: payload.pbkdf2_salt,
    created_at: new Date().toISOString(),
    password_salt: password.salt,
    password_hash: password.hash,
  };
  await put(USERS, user);
  return makeAuth(publicProfile(user));
}

export async function localLogin(payload: LoginRequest): Promise<AuthResponse> {
  const users = await getAll<LocalUserRecord>(USERS);
  const user = users.find((candidate) => candidate.username === payload.username.trim().toLowerCase());
  if (!user) throw new Error("Local fallback account not found. Sign up first on this device.");

  const password = await passwordDigest(payload.password, user.password_salt);
  if (password.hash !== user.password_hash) throw new Error("Invalid username or password.");

  return makeAuth(publicProfile(user));
}

export async function localRefresh(refreshToken: string): Promise<TokenResponse> {
  if (!refreshToken.startsWith(REFRESH_PREFIX)) throw new Error("Invalid local refresh token.");
  const userId = refreshToken.split(":")[1];
  return {
    access_token: `${ACCESS_PREFIX}${userId}:${Date.now() + TOKEN_TTL_SECONDS * 1000}:${crypto.randomUUID()}`,
    token_type: "bearer",
    expires_in: TOKEN_TTL_SECONDS,
  };
}

export async function localSearchUsers(query: string, token: string): Promise<UserPublicInfo[]> {
  const currentUserId = localUserIdFromToken(token);
  const needle = query.trim().toLowerCase();
  const users = await getAll<LocalUserRecord>(USERS);
  return users
    .filter((user) => user.id !== currentUserId)
    .filter((user) => user.username.includes(needle) || user.display_name.toLowerCase().includes(needle))
    .slice(0, 20)
    .map((user) => ({ id: user.id, username: user.username, display_name: user.display_name }));
}

export async function localGetPublicKey(userId: string): Promise<string> {
  const users = await getAll<LocalUserRecord>(USERS);
  const user = users.find((candidate) => candidate.id === userId);
  if (!user) throw new Error("Local fallback user not found.");
  return user.public_key;
}

export async function localGetConversations(token: string): Promise<ConversationSummary[]> {
  const currentUserId = localUserIdFromToken(token);
  const users = await getAll<LocalUserRecord>(USERS);
  const messages = await getAll<MessageResponse>(MESSAGES);
  const partners = new Map<string, string>();
  const latest = new Map<string, string>();

  for (const message of messages) {
    if (message.from_user_id !== currentUserId && message.to_user_id !== currentUserId) continue;
    const partnerId = message.from_user_id === currentUserId ? message.to_user_id : message.from_user_id;
    partners.set(partnerId, partnerId);
    if (!latest.get(partnerId) || new Date(message.created_at) > new Date(latest.get(partnerId)!)) latest.set(partnerId, message.created_at);
  }

  return [...partners.keys()]
    .map((partnerId) => {
      const user = users.find((candidate) => candidate.id === partnerId);
      if (!user) return null;
      return { user_id: user.id, username: user.username, display_name: user.display_name, last_message_at: latest.get(user.id) ?? null };
    })
    .filter((conversation): conversation is ConversationSummary => Boolean(conversation))
    .sort((a, b) => new Date(b.last_message_at ?? 0).getTime() - new Date(a.last_message_at ?? 0).getTime());
}

export async function localGetConversationMessages(userId: string, token: string): Promise<MessageResponse[]> {
  const currentUserId = localUserIdFromToken(token);
  const messages = await getAll<MessageResponse>(MESSAGES);
  return messages
    .filter(
      (message) =>
        (message.from_user_id === currentUserId && message.to_user_id === userId) ||
        (message.from_user_id === userId && message.to_user_id === currentUserId),
    )
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

export async function localSendMessage(request: SendMessageRequest, token: string): Promise<MessageResponse> {
  const message: MessageResponse = {
    id: crypto.randomUUID(),
    from_user_id: localUserIdFromToken(token),
    to_user_id: request.to,
    payload: request.payload,
    delivered: true,
    created_at: new Date().toISOString(),
  };
  await put(MESSAGES, message);
  return message;
}
