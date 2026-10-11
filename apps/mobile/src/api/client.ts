/**
 * Typed HTTP client for the MedAssist backend.
 * Token storage: expo-secure-store on native, localStorage on web.
 */
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

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
  },

  health: () => request<{ status: string; db: string }>('/health'),
};

export { BASE_URL };
