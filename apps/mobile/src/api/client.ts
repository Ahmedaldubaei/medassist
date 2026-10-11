/**
 * Typed HTTP client for the MedAssist backend.
 * Token storage: expo-secure-store on native, localStorage on web.
 */
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';
const TOKEN_KEY = 'medassist_token';
const LANG_KEY = 'medassist_lang';

/* ---------------------------------- types --------------------------------- */

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'CLINICIAN' | 'STUDENT' | 'VIEWER' | 'USER';
  preferredLang: 'AR' | 'EN';
  emailVerified: boolean;
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
  /** Backend message id (present for persisted messages) — needed for pin. */
  backendId?: string;
  pinned?: boolean;
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

export interface ConversationListItem {
  id: string;
  title: string;
  createdAt: string;
  messageCount: number;
  lastMessage: { role: string; preview: string; createdAt: string } | null;
}

export interface ConversationListResponse {
  conversations: ConversationListItem[];
  nextCursor: string | null;
}

export interface ConversationMessageItem {
  id: string;
  role: 'USER' | 'ASSISTANT' | 'SYSTEM';
  content: string;
  agentUsed: string | null;
  citations: Citation[];
  confidence: number | null;
  pinned: boolean;
  createdAt: string;
}

export interface ConversationMessagesResponse {
  conversationId: string;
  messages: ConversationMessageItem[];
  nextCursor: string | null;
}

export interface ChatStreamMeta {
  citations: Citation[];
  confidence: number;
  disclaimer: string;
  agentUsed: string;
  safetyVerdict: 'PASS' | 'FLAG' | 'BLOCK';
  conversationId: string;
  escalated: boolean;
}

export interface ClinicalCitation {
  title: string;
  source: string;
}

export interface ChecklistStep {
  textAr: string;
  textEn: string;
  citation: ClinicalCitation;
  unavailable?: boolean;
}

export interface ChecklistSummary {
  key: string;
  titleAr: string;
  titleEn: string;
  category: string;
  updatedAt: string;
}

export interface ChecklistDetail extends ChecklistSummary {
  steps: ChecklistStep[];
}

export interface DrugEntry {
  indicationAr: string;
  indicationEn: string;
  dose: string | null;
  route: string | null;
  notesAr: string | null;
  notesEn: string | null;
  perKg: { min: number; max: number; unit: string } | null;
  citation: ClinicalCitation;
}

export interface DrugItem {
  nameAr: string;
  nameEn: string;
  classAr: string | null;
  entries: DrugEntry[];
  updatedAt: string;
}

export interface MessageSearchHit {
  id: string;
  role: string;
  preview: string;
  pinned: boolean;
  createdAt: string;
  conversationId: string;
  conversationTitle: string;
}

export interface PinnedMessage {
  id: string;
  role: string;
  preview: string;
  content: string;
  createdAt: string;
  conversationId: string;
  conversationTitle: string;
}

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

  googleLogin: (body: { idToken: string }) =>
    request<{ token: string; user: PublicUser }>('/api/v1/auth/google', { method: 'POST', body: JSON.stringify(body) }),

  verifyEmail: (token: string) =>
    request<{ ok: boolean }>(`/api/v1/auth/verify-email?token=${encodeURIComponent(token)}`),

  forgotPassword: (email: string) =>
    request<{ ok: boolean }>('/api/v1/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  resetPassword: (token: string, newPassword: string) =>
    request<{ ok: boolean }>('/api/v1/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, newPassword }),
    }),

  me: (token: string) => request<{ user: PublicUser }>('/api/v1/auth/me', {}, token),

  updateMe: (token: string, body: { name?: string; preferredLang?: 'ar' | 'en' }) =>
    request<{ user: PublicUser }>('/api/v1/auth/me', { method: 'PATCH', body: JSON.stringify(body) }, token),

  deleteMe: (token: string) =>
    request<{ ok: boolean }>('/api/v1/auth/me', { method: 'DELETE' }, token),

  chat: (token: string, body: { message: string; conversationId?: string }) =>
    request<ChatResponse>('/api/v1/chat', { method: 'POST', body: JSON.stringify(body) }, token),

  /**
   * Streaming chat (SSE). Calls onToken for each `event: token` chunk and
   * resolves with the final `event: meta` payload. Throws when streaming is
   * unsupported or the stream fails — callers should fall back to `chat()`.
   */
  chatStream: async (
    token: string,
    body: { message: string; conversationId?: string },
    onToken: (text: string) => void,
  ): Promise<ChatStreamMeta> => {
    const res = await fetch(`${BASE_URL}/api/v1/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as {
        error?: { code?: string; message?: string };
      };
      throw new ApiError(
        res.status,
        data.error?.message ?? `Request failed (${res.status})`,
        data.error?.code,
      );
    }
    const reader = res.body?.getReader();
    if (!reader) throw new Error('Streaming not supported on this platform');
    const decoder = new TextDecoder();
    let buf = '';
    let meta: ChatStreamMeta | null = null;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let cut: number;
      while ((cut = buf.indexOf('\n\n')) >= 0) {
        const rawEvent = buf.slice(0, cut);
        buf = buf.slice(cut + 2);
        let event = 'message';
        let data = '';
        for (const line of rawEvent.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) data += line.slice(5).trim();
        }
        if (event === 'token') {
          onToken((JSON.parse(data) as { text: string }).text);
        } else if (event === 'meta') {
          meta = JSON.parse(data) as ChatStreamMeta;
        }
      }
    }
    if (!meta) throw new Error('Stream ended without metadata');
    return meta;
  },

  conversations: {
    list: (token: string, opts?: { limit?: number; cursor?: string }) => {
      const q = new URLSearchParams();
      if (opts?.limit) q.set('limit', String(opts.limit));
      if (opts?.cursor) q.set('cursor', opts.cursor);
      const qs = q.toString();
      return request<ConversationListResponse>(`/api/v1/conversations${qs ? `?${qs}` : ''}`, {}, token);
    },
    messages: (token: string, id: string, opts?: { limit?: number; cursor?: string }) => {
      const q = new URLSearchParams();
      if (opts?.limit) q.set('limit', String(opts.limit));
      if (opts?.cursor) q.set('cursor', opts.cursor);
      const qs = q.toString();
      return request<ConversationMessagesResponse>(
        `/api/v1/conversations/${encodeURIComponent(id)}/messages${qs ? `?${qs}` : ''}`,
        {},
        token,
      );
    },
    remove: (token: string, id: string) =>
      request<{ ok: boolean }>(
        `/api/v1/conversations/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
        token,
      ),
    search: (token: string, q: string) =>
      request<{ messages: MessageSearchHit[] }>(
        `/api/v1/conversations/search?q=${encodeURIComponent(q)}`,
        {},
        token,
      ),
    pinned: (token: string) =>
      request<{ messages: PinnedMessage[] }>('/api/v1/conversations/pinned', {}, token),
    regenerate: (token: string, id: string) =>
      request<ChatResponse>(
        `/api/v1/conversations/${encodeURIComponent(id)}/regenerate`,
        { method: 'POST' },
        token,
      ),
  },

  messages: {
    pin: (token: string, id: string, pinned: boolean) =>
      request<{ ok: boolean; pinned: boolean }>(
        `/api/v1/messages/${encodeURIComponent(id)}/pin`,
        { method: 'PATCH', body: JSON.stringify({ pinned }) },
        token,
      ),
  },

  clinical: {
    checklists: (token: string) =>
      request<{ checklists: ChecklistSummary[] }>('/api/v1/clinical/checklists', {}, token),
    checklist: (token: string, key: string) =>
      request<ChecklistDetail>(
        `/api/v1/clinical/checklists/${encodeURIComponent(key)}`,
        {},
        token,
      ),
    drugs: (token: string, q?: string) =>
      request<{ drugs: DrugItem[] }>(
        `/api/v1/clinical/drugs${q ? `?q=${encodeURIComponent(q)}` : ''}`,
        {},
        token,
      ),
  },

  health: () => request<{ status: string; db: string }>('/health'),
};

export { BASE_URL };

/* --------------------------- offline read-through cache --------------------------- */
/**
 * Tight-scope offline cache: after a successful load of the conversations list
 * or a conversation's messages, the payload is persisted (per user). When the
 * network request fails, the cached copy is served with `fromCache: true` so
 * the UI can show the "offline" banner. No background sync.
 */
const CACHE_PREFIX = 'medassist_cache_v1';

async function cacheSet(scope: string, key: string, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(`${CACHE_PREFIX}:${scope}:${key}`, JSON.stringify(value));
  } catch {
    /* cache is best-effort */
  }
}

async function cacheGet<T>(scope: string, key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(`${CACHE_PREFIX}:${scope}:${key}`);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function listConversationsCached(
  token: string,
  scope: string,
): Promise<{ data: ConversationListResponse; fromCache: boolean }> {
  try {
    const data = await api.conversations.list(token, { limit: 50 });
    await cacheSet(scope, 'conversations', data);
    return { data, fromCache: false };
  } catch (err) {
    const cached = await cacheGet<ConversationListResponse>(scope, 'conversations');
    if (cached) return { data: cached, fromCache: true };
    throw err;
  }
}

export async function getMessagesCached(
  token: string,
  scope: string,
  conversationId: string,
): Promise<{ data: ConversationMessagesResponse; fromCache: boolean }> {
  try {
    const data = await api.conversations.messages(token, conversationId, { limit: 100 });
    await cacheSet(scope, `messages:${conversationId}`, data);
    return { data, fromCache: false };
  } catch (err) {
    const cached = await cacheGet<ConversationMessagesResponse>(scope, `messages:${conversationId}`);
    if (cached) return { data: cached, fromCache: true };
    throw err;
  }
}
