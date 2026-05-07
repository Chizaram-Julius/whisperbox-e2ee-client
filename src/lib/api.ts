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
import { clearSession, getSession, saveSession } from "./storage";
import {
  isLocalAccessToken,
  localGetConversationMessages,
  localGetConversations,
  localGetPublicKey,
  localLogin,
  localRefresh,
  localRegister,
  localSearchUsers,
  localSendMessage,
} from "./localFallback";

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? (import.meta.env.DEV ? "/api" : "https://whisperbox.koyeb.app");
const REFRESH_MARGIN_MS = 45_000;

type ApiOptions = RequestInit & { auth?: boolean; retry?: boolean };

let memoryAccessToken: string | null = null;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function setMemoryAccessToken(token: string | null): void {
  memoryAccessToken = token;
}

export async function getValidAccessToken(): Promise<string | null> {
  const session = await getSession();
  if (!session) return memoryAccessToken;

  if (Date.now() < session.expiresAt - REFRESH_MARGIN_MS) {
    memoryAccessToken = session.accessToken;
    return session.accessToken;
  }

  try {
    const refreshed = isLocalAccessToken(session.accessToken)
      ? await localRefresh(session.refreshToken)
      : await refreshAccessToken(session.refreshToken);
    const nextSession = {
      ...session,
      accessToken: refreshed.access_token,
      expiresAt: Date.now() + refreshed.expires_in * 1000,
    };
    await saveSession(nextSession);
    memoryAccessToken = refreshed.access_token;
    return refreshed.access_token;
  } catch {
    await clearSession();
    memoryAccessToken = null;
    return null;
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  const body = text && contentType.includes("application/json") ? JSON.parse(text) : {};

  if (!response.ok) {
    const detail = body?.detail;
    const message = Array.isArray(detail)
      ? detail.map((item) => item.msg).join(", ")
      : detail || body?.message || text || response.statusText;
    throw new ApiError(message, response.status);
  }

  return body as T;
}

async function request<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");

  if (options.auth !== false) {
    const token = await getValidAccessToken();
    if (!token) throw new Error("Your secure session has expired. Please log in again.");
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });

  if (response.status === 401 && options.auth !== false && options.retry !== false) {
    const session = await getSession();
    if (session) {
      const refreshed = await refreshAccessToken(session.refreshToken);
      await saveSession({
        ...session,
        accessToken: refreshed.access_token,
        expiresAt: Date.now() + refreshed.expires_in * 1000,
      });
      memoryAccessToken = refreshed.access_token;
      return request<T>(path, { ...options, retry: false });
    }
  }

  return parseResponse<T>(response);
}

export async function register(payload: RegisterRequest): Promise<AuthResponse> {
  try {
    return await request<AuthResponse>("/auth/register", {
      method: "POST",
      auth: false,
      body: JSON.stringify(payload),
    });
  } catch (error) {
    if (import.meta.env.DEV && error instanceof ApiError && error.status === 500) {
      return localRegister(payload);
    }
    throw error;
  }
}

export async function login(payload: LoginRequest): Promise<AuthResponse> {
  try {
    return await request<AuthResponse>("/auth/login", {
      method: "POST",
      auth: false,
      body: JSON.stringify(payload),
    });
  } catch (error) {
    if (import.meta.env.DEV && error instanceof ApiError && error.status === 500) {
      return localLogin(payload);
    }
    throw error;
  }
}

export async function getMe(): Promise<UserProfile> {
  return request<UserProfile>("/auth/me");
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  if (refreshToken.startsWith("local-refresh:")) return localRefresh(refreshToken);

  return request<TokenResponse>("/auth/refresh", {
    method: "POST",
    auth: false,
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
}

export async function logout(refreshToken: string): Promise<void> {
  if (refreshToken.startsWith("local-refresh:")) return;

  await request<Record<string, unknown>>("/auth/logout", {
    method: "POST",
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
}

export async function searchUsers(query: string): Promise<UserPublicInfo[]> {
  const token = await getValidAccessToken();
  if (isLocalAccessToken(token)) return localSearchUsers(query, token);

  return request<UserPublicInfo[]>(`/users/search?q=${encodeURIComponent(query)}`);
}

export async function getPublicKey(userId: string): Promise<string> {
  const token = await getValidAccessToken();
  if (isLocalAccessToken(token)) return localGetPublicKey(userId);

  const response = await request<{ public_key: string }>(`/users/${userId}/public-key`);
  return response.public_key;
}

export async function getConversations(): Promise<ConversationSummary[]> {
  const token = await getValidAccessToken();
  if (isLocalAccessToken(token)) return localGetConversations(token);

  try {
    return await request<ConversationSummary[]>("/conversations");
  } catch (error) {
    if (error instanceof ApiError && error.status === 500) {
      return [];
    }
    throw error;
  }
}

export async function getConversationMessages(userId: string, limit = 50, before?: string): Promise<MessageResponse[]> {
  const token = await getValidAccessToken();
  if (isLocalAccessToken(token)) return localGetConversationMessages(userId, token);

  const params = new URLSearchParams({ limit: String(limit) });
  if (before) params.set("before", before);
  return request<MessageResponse[]>(`/conversations/${userId}/messages?${params.toString()}`);
}

export async function sendMessage(payload: SendMessageRequest): Promise<MessageResponse> {
  const token = await getValidAccessToken();
  if (isLocalAccessToken(token)) return localSendMessage(payload, token);

  return request<MessageResponse>("/messages", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
