/**
 * Typed HTTP client for the MedAssist backend.
 * Token storage: expo-secure-store on native, localStorage on web.
 */
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';
const TOKEN_KEY = 'medassist_token';
const LANG_KEY = 'medassist_lang';
const HISTORY_KEY = 'medassist_history';

/* ---------------------------------- types --------------------------------- */

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'CLINICIAN' | 'STUDENT' | 'VIEWER';
  preferredLang: 'AR' | 'EN';
  createdAt: string;
}

export interface Citation {
  n: number;
  title: string;
  source: string;
  guidelineYear: number | null;
  url: string | null;
  license: string;
}

export interface ChatResponse {
  answer: string;
  citations: Citation[];
  confidence: number;
  disclaimer: string;
  agentUsed: string;
  safetyVerdict: 'PASS' | 'FLAG' | 'BLOCK';
  conversationId: string;
  escalated: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: number;
  chat?: ChatResponse;
}

export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/* --------------------------------- storage -------------------------------- */

const isWeb = Platform.OS === 'web';

async function kvGet(key: string): Promise<string | null> {
  if (isWeb) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  return SecureStore.getItemAsync(key);
}

async function kvSet(key: string, value: string): Promise<void> {
  if (isWeb) {
    window.localStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function kvDelete(key: string): Promise<void> {
  if (isWeb) {
    window.localStorage.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

export const tokenStore = {
  get: () => kvGet(TOKEN_KEY),
  set: (t: string) => kvSet(TOKEN_KEY, t),
  clear: () => kvDelete(TOKEN_KEY),
};

export const langStore = {
  get: () => kvGet(LANG_KEY),
  set: (l: string) => kvSet(LANG_KEY, l),
};

/** Local conversation history (backend has no list endpoint yet — P5). */
export const historyStore = {
  async get(): Promise<ConversationSummary[]> {
    try {
      const raw = await kvGet(HISTORY_KEY);
      return raw ? (JSON.parse(raw) as ConversationSummary[]) : [];
    } catch {
      return [];
    }
  },
  async set(list: ConversationSummary[]): Promise<void> {
    await kvSet(HISTORY_KEY, JSON.stringify(list.slice(0, 50)));
  },
};

/* ---------------------------------- client -------------------------------- */

async function request<T>(path: string, init: RequestInit = {}, token?: string | null): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers: { ...headers, ...(init.headers as Record<string, string> | undefined) } });
  const data = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
  if (!res.ok) {
    throw new ApiError(res.status, data.error?.message ?? `Request failed (${res.status})`, data.error?.code);
  }
  return data as T;
}

export const api = {
  register: (body: { email: string; name: string; password: string }) =>
    request<{ user: PublicUser }>('/api/v1/auth/register', { method: 'POST', body: JSON.stringify(body) }),

  login: (body: { email: string; password: string }) =>
    request<{ token: string; user: PublicUser }>('/api/v1/auth/login', { method: 'POST', body: JSON.stringify(body) }),

  me: (token: string) => request<{ user: PublicUser }>('/api/v1/auth/me', {}, token),

  chat: (token: string, body: { message: string; conversationId?: string }) =>
    request<ChatResponse>('/api/v1/chat', { method: 'POST', body: JSON.stringify(body) }, token),

  health: () => request<{ status: string; db: string }>('/health'),
};

export { BASE_URL };
