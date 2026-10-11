/**
 * Chat screen: bubbles, typing indicator, auto-scroll, AssistantMessage,
 * message actions (copy / share / pin), regenerate last answer,
 * offline read-through cache.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useNavigation, router } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import {
  ApiError,
  api,
  getMessagesCached,
  listConversationsCached,
  type ChatMessage,
  type ChatResponse,
  type ConversationMessageItem,
  type SafetyVerdictUI,
} from '../../../api/client';
import { useAuth } from '../../../auth/AuthContext';
import { t } from '../../../i18n';
import { colors, fontFamily, fontSize, radius, spacing } from '../../../theme';
import { AssistantMessage } from '../../../components/AssistantMessage';
import { ErrorBanner } from '../../../components/ui';

let msgSeq = 0;
const nextId = () => `local-${Date.now()}-${msgSeq++}`;

function TypingBubble({ label }: { label?: string }) {
  return (
    <View style={[styles.bubble, styles.assistantBubble]}>
      <View style={styles.typingRow}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={styles.typingDot} />
        ))}
      </View>
      {label ? <Text style={styles.typingLabel}>{label}</Text> : null}
    </View>
  );
}

/** M4: map a server pipeline phase to its localized typing-indicator label. */
function phaseLabel(phase: string | null, lang: 'ar' | 'en'): string | undefined {
  switch (phase) {
    case 'preparing':
      return t(lang, 'chat.statusPreparing');
    case 'safety':
      return t(lang, 'chat.statusSafety');
    case 'retrieval':
      return t(lang, 'chat.statusRetrieval');
    case 'generating':
      return t(lang, 'chat.statusGenerating');
    case 'verifying':
      return t(lang, 'chat.statusVerifying');
    default:
      return undefined;
  }
}

function toChatMessage(m: ConversationMessageItem, conversationId: string): ChatMessage {
  const role = m.role === 'USER' ? 'user' : 'assistant';
  const base = {
    id: m.id,
    text: m.content,
    createdAt: Date.parse(m.createdAt),
    backendId: m.id,
    pinned: m.pinned,
  };
  if (role === 'assistant') {
    const chat: ChatResponse = {
      answer: m.content,
      citations: m.citations ?? [],
      confidence: m.confidence ?? 0,
      // M5: disclaimer and verdict come from the persisted server record.
      // Pre-M5 rows have NULLs: no banner (as before) and an honest
      // 'UNKNOWN' verdict instead of a fabricated 'PASS'.
      disclaimer: m.disclaimer ?? '',
      agentUsed: m.agentUsed ?? '',
      safetyVerdict: (m.verdict as SafetyVerdictUI | null) ?? 'UNKNOWN',
      conversationId,
      escalated: false,
    };
    return { ...base, role, chat };
  }
  return { ...base, role };
}

function MessageActions({
  msg,
  lang,
  isLast,
  onCopy,
  onShare,
  onPin,
  onRegenerate,
}: {
  msg: ChatMessage;
  lang: 'ar' | 'en';
  isLast: boolean;
  onCopy: () => void;
  onShare: () => void;
  onPin: () => void;
  onRegenerate: () => void;
}) {
  return (
    <View style={styles.actions}>
      <TouchableOpacity style={styles.actionBtn} onPress={onCopy} hitSlop={10} accessibilityLabel={t(lang, 'msg.copy')}>
        <MaterialIcons name="content-copy" size={18} color={colors.textMuted} />
      </TouchableOpacity>
      <TouchableOpacity style={styles.actionBtn} onPress={onShare} hitSlop={10} accessibilityLabel={t(lang, 'msg.share')}>
        <MaterialIcons name="share" size={18} color={colors.textMuted} />
      </TouchableOpacity>
      {msg.backendId ? (
        <TouchableOpacity style={styles.actionBtn} onPress={onPin} hitSlop={10} accessibilityLabel={msg.pinned ? t(lang, 'msg.unpin') : t(lang, 'msg.pin')}>
          <MaterialIcons
            name="push-pin"
            size={18}
            color={msg.pinned ? colors.primary : colors.textMuted}
          />
        </TouchableOpacity>
      ) : null}
      {isLast ? (
        <TouchableOpacity style={styles.actionBtn} onPress={onRegenerate} hitSlop={10} accessibilityLabel={t(lang, 'msg.regenerate')}>
          <MaterialIcons name="refresh" size={18} color={colors.textMuted} />
          <Text style={styles.actionLabel}>{t(lang, 'msg.regenerate')}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token, user, lang } = useAuth();
  const rtl = lang === 'ar';
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [streamActive, setStreamActive] = useState(false);
  const [error, setError] = useState('');
  /** M4: latest pipeline phase from `event: status` — shown in the typing bubble. */
  const [statusPhase, setStatusPhase] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  /** M7: timestamp of the cached copy being shown (null when online). */
  const [offlineAt, setOfflineAt] = useState<number | null>(null);
  /** Message id currently in edit mode (user-message editing). */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [conversationId, setConversationId] = useState<string | undefined>(id === 'new' ? undefined : id);
  const listRef = useRef<FlatList>(null);
  const navigation = useNavigation();

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity
          onPress={() => router.push('/(app)/chat/new')}
          hitSlop={12}
          accessibilityLabel={t(lang, 'chat.new')}
        >
          <MaterialIcons name="add" size={24} color={colors.navy} />
        </TouchableOpacity>
      ),
    });
  }, [navigation, lang]);

  const [activeId, setActiveId] = useState(id);
  if (activeId !== id) {
    setActiveId(id);
    setMessages([]);
    setOffline(false);
    setOfflineAt(null);
    setEditingId(null);
    setEditDraft('');
    setConversationId(id === 'new' ? undefined : id);
  }

  const scope = user?.id ?? 'anon';

  const reloadMessages = useCallback(
    async (cid: string) => {
      if (!token) return;
      try {
        const { data, fromCache, cachedAt } = await getMessagesCached(token, scope, cid);
        setMessages(data.messages.map((m) => toChatMessage(m, cid)));
        setOffline(fromCache);
        setOfflineAt(fromCache ? (cachedAt ?? null) : null);
        setError('');
      } catch {
        setError(t(lang, 'chat.errLoad'));
      }
    },
    [token, scope, lang],
  );

  useEffect(() => {
    if (id === 'new') return;
    // Intentional data fetch on mount/conversation change.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reloadMessages(id);
  }, [id, reloadMessages]);

  /**
   * After a stream failure, check whether the server already persisted an
   * assistant reply to `text` in conversation `cid`. The pipeline may have
   * completed server-side even though the SSE read failed — in that case we
   * display the existing reply instead of re-sending (which would persist a
   * duplicate user message + answer).
   */
  const serverHasReply = useCallback(
    async (cid: string, text: string): Promise<boolean> => {
      if (!token) return false;
      try {
        const { data } = await getMessagesCached(token, scope, cid);
        const msgs = data.messages;
        const now = Date.now();
        for (let i = msgs.length - 1; i >= 0; i--) {
          const m = msgs[i]!;
          if (
            m.role === 'USER' &&
            m.content === text &&
            now - Date.parse(m.createdAt) < 5 * 60 * 1000
          ) {
            const replied = msgs.slice(i + 1).some((x) => x.role !== 'USER');
            if (replied) {
              setMessages(msgs.map((x) => toChatMessage(x, cid)));
              setOffline(false);
              setOfflineAt(null);
              setError('');
              return true;
            }
            return false;
          }
        }
        return false;
      } catch {
        return false;
      }
    },
    [token, scope],
  );

  /**
   * New-chat case: we don't know the server's conversation id after a stream
   * failure, so look for a reply to `text` in recently created conversations.
   * Returns the conversation id when a reply was found (and displayed).
   */
  const findReplyInRecentConversations = useCallback(
    async (text: string): Promise<string | null> => {
      if (!token) return null;
      try {
        const { data } = await listConversationsCached(token, scope);
        const cutoff = Date.now() - 3 * 60 * 1000;
        for (const c of data.conversations) {
          if (Date.parse(c.createdAt) < cutoff) continue;
          if (await serverHasReply(c.id, text)) return c.id;
        }
        return null;
      } catch {
        return null;
      }
    },
    [token, scope, serverHasReply],
  );

  const doSend = useCallback(
    async (text: string) => {
      if (!token) return;
      setError('');
      const userMsg: ChatMessage = { id: nextId(), role: 'user', text, createdAt: Date.now() };
      const assistantId = nextId();
      const placeholder: ChatMessage = {
        id: assistantId,
        role: 'assistant',
        text: '',
        createdAt: Date.now(),
      };
      setMessages((prev) => [...prev, userMsg, placeholder]);
      setSending(true);
      setStreamActive(false);
      setStatusPhase(null);
      try {
        let streamed = '';
        const meta = await api.chatStream(
          token,
          { message: text, conversationId },
          (tok) => {
            streamed += tok;
            const snapshot = streamed;
            setStreamActive(true);
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, text: snapshot } : m)),
            );
          },
          // Hung connections must not disable the input forever (audit 2.3).
          AbortSignal.timeout(120_000),
          // M4: pipeline phase → live typing-indicator label.
          (phase) => setStatusPhase(phase),
        );
        setConversationId(meta.conversationId);
        // Reload to sync backend ids (needed for pin) and persisted citations.
        await reloadMessages(meta.conversationId);
      } catch (err) {
        const isTimeout = err instanceof Error && err.name === 'TimeoutError';
        // The server pipeline may have completed despite the stream failing.
        // Check for an existing reply FIRST — never re-send blindly.
        let recovered = false;
        if (conversationId) {
          recovered = await serverHasReply(conversationId, text);
        } else {
          const cid = await findReplyInRecentConversations(text);
          if (cid) {
            setConversationId(cid);
            recovered = true;
          }
        }
        if (!recovered) {
          // Genuine failure: drop the placeholder and mark the local message
          // failed (with inline retry) instead of leaving a ghost message.
          setMessages((prev) =>
            prev
              .filter((m) => m.id !== assistantId)
              .map((m) => (m.id === userMsg.id ? { ...m, failed: true } : m)),
          );
          setError(t(lang, isTimeout ? 'chat.errTimeout' : 'chat.error'));
        }
      } finally {
        setSending(false);
        setStreamActive(false);
        setStatusPhase(null);
      }
    },
    [token, conversationId, lang, reloadMessages, serverHasReply, findReplyInRecentConversations],
  );

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || sending || !token) return;
    setInput('');
    await doSend(text);
  }, [input, sending, token, doSend]);

  const retrySend = useCallback(
    async (msg: ChatMessage) => {
      if (sending || !token) return;
      setError('');
      // The original send may have completed server-side after all; check
      // before resending so a retry can never create a duplicate.
      let recovered = false;
      if (conversationId) {
        recovered = await serverHasReply(conversationId, msg.text);
      } else {
        const cid = await findReplyInRecentConversations(msg.text);
        if (cid) {
          setConversationId(cid);
          recovered = true;
        }
      }
      setMessages((prev) => prev.filter((m) => m.id !== msg.id));
      if (!recovered) {
        await doSend(msg.text);
      }
    },
    [sending, token, conversationId, serverHasReply, findReplyInRecentConversations, doSend],
  );

  /** Regenerate core (no sending guard) — reused by the edit flow. */
  const runRegenerate = useCallback(async () => {
    if (!token || !conversationId) return;
    setError('');
    setSending(true);
    try {
      const res = await api.conversations.regenerate(token, conversationId);
      setConversationId(res.conversationId);
      await reloadMessages(res.conversationId);
    } catch {
      setError(t(lang, 'chat.error'));
    } finally {
      setSending(false);
    }
  }, [token, conversationId, lang, reloadMessages]);

  const regenerate = useCallback(() => {
    if (sending) return;
    void runRegenerate();
  }, [sending, runRegenerate]);

  /** Long-press on a persisted user bubble → edit action (same Alert affordance as conversation delete). */
  const startEdit = useCallback(
    (msg: ChatMessage) => {
      if (sending || !msg.backendId || msg.failed) return;
      Alert.alert(t(lang, 'chat.editMessage'), undefined, [
        { text: t(lang, 'chat.cancelEdit'), style: 'cancel' },
        {
          text: t(lang, 'chat.editMessage'),
          onPress: () => {
            setEditingId(msg.id);
            setEditDraft(msg.text);
          },
        },
      ]);
    },
    [sending, lang],
  );

  /**
   * Save an edited user message (ChatGPT-style): the server updates the
   * content and drops every later message; we mirror that locally, then run
   * the same regenerate flow to stream the fresh answer.
   */
  const saveEdit = useCallback(async () => {
    if (!token || !editingId || sending || !conversationId) return;
    const text = editDraft.trim();
    if (!text) {
      setError(t(lang, 'chat.editFailed'));
      return;
    }
    const editedId = editingId;
    setError('');
    setSending(true);
    try {
      const target = messages.find((m) => m.id === editedId);
      if (!target?.backendId) {
        setError(t(lang, 'chat.editFailed'));
        return;
      }
      await api.messages.edit(token, target.backendId, text);
      // Mirror the server: update the edited message, drop everything after it.
      setMessages((prev) => {
        const i = prev.findIndex((m) => m.id === editedId);
        if (i < 0) return prev;
        return prev.slice(0, i + 1).map((m, j) => (j === i ? { ...m, text } : m));
      });
      setEditingId(null);
      setEditDraft('');
      await runRegenerate();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'PINNED_AFTER') {
        Alert.alert(t(lang, 'chat.editBlockedPinned'));
      } else {
        setError(t(lang, 'chat.editFailed'));
      }
    } finally {
      setSending(false);
    }
  }, [token, editingId, editDraft, sending, conversationId, lang, messages, runRegenerate]);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setEditDraft('');
  }, []);

  const copyMsg = useCallback(
    async (text: string) => {
      await Clipboard.setStringAsync(text);
      Alert.alert(t(lang, 'common.copied'));
    },
    [lang],
  );

  const shareMsg = useCallback(async (text: string) => {
    try {
      await Share.share({ message: text });
    } catch {
      /* user dismissed */
    }
  }, []);

  const togglePin = useCallback(
    async (msg: ChatMessage) => {
      if (!token || !msg.backendId) return;
      try {
        const res = await api.messages.pin(token, msg.backendId, !msg.pinned);
        setMessages((prev) =>
          prev.map((m) => (m.id === msg.id ? { ...m, pinned: res.pinned } : m)),
        );
      } catch {
        setError(t(lang, 'msg.pinFailed'));
      }
    },
    [token, lang],
  );

  const lastAssistantIdx = messages.reduce(
    (acc, m, i) => (m.role === 'assistant' && m.text ? i : acc),
    -1,
  );

  const renderItem = ({ item, index }: { item: ChatMessage; index: number }) => {
    if (item.role === 'user') {
      if (editingId === item.id) {
        return (
          <View style={[styles.bubble, styles.userBubble, rtl && styles.userBubbleRtl]}>
            <TextInput
              style={[styles.editInput, { textAlign: rtl ? 'right' : 'left' }]}
              value={editDraft}
              onChangeText={setEditDraft}
              multiline
              maxLength={4000}
              autoFocus
              editable={!sending}
            />
            <View style={styles.editBtnRow}>
              <TouchableOpacity
                style={[styles.editBtn, styles.editBtnPrimary]}
                onPress={() => void saveEdit()}
                disabled={sending}
                hitSlop={10}
                accessibilityLabel={t(lang, 'chat.saveEdit')}
              >
                <Text style={styles.editBtnPrimaryLabel}>{t(lang, 'chat.saveEdit')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.editBtn}
                onPress={cancelEdit}
                disabled={sending}
                hitSlop={10}
                accessibilityLabel={t(lang, 'chat.cancelEdit')}
              >
                <Text style={styles.editBtnLabel}>{t(lang, 'chat.cancelEdit')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      }
      return (
        <TouchableOpacity
          style={[styles.bubble, styles.userBubble, rtl && styles.userBubbleRtl]}
          activeOpacity={0.85}
          onLongPress={() => startEdit(item)}
          delayLongPress={350}
          disabled={sending}
        >
          <Text style={styles.userText}>{item.text}</Text>
          {item.failed ? (
            <TouchableOpacity
              style={styles.retryBtn}
              onPress={() => void retrySend(item)}
              hitSlop={10}
              accessibilityLabel={t(lang, 'common.retry')}
            >
              <MaterialIcons name="refresh" size={16} color={colors.bubbleUserText} />
              <Text style={styles.retryLabel}>{t(lang, 'common.retry')}</Text>
            </TouchableOpacity>
          ) : null}
        </TouchableOpacity>
      );
    }
    return (
      <View style={[styles.bubble, styles.assistantBubble]}>
        {item.chat ? (
          <AssistantMessage chat={item.chat} lang={lang} />
        ) : (
          <Text style={styles.assistantText}>{item.text}</Text>
        )}
        {item.text ? (
          <MessageActions
            msg={item}
            lang={lang}
            isLast={index === lastAssistantIdx}
            onCopy={() => void copyMsg(item.chat?.answer ?? item.text)}
            onShare={() => void shareMsg(item.chat?.answer ?? item.text)}
            onPin={() => void togglePin(item)}
            onRegenerate={() => void regenerate()}
          />
        ) : null}
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      {offline ? (
        <View style={styles.offlineBanner}>
          <MaterialIcons name="cloud-off" size={16} color={colors.warning} />
          <Text style={styles.offlineText}>
            {t(lang, 'common.offline')}
            {offlineAt ? ` ${t(lang, 'common.offlineSavedAt')} ${new Date(offlineAt).toLocaleDateString(lang === 'ar' ? 'ar' : 'en')}` : ''}
          </Text>
        </View>
      ) : null}
      {error ? (
        <View style={styles.errorWrap}>
          <ErrorBanner message={error} onRetry={() => setError('')} retryLabel={t(lang, 'common.cancel')} />
        </View>
      ) : null}
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        ListFooterComponent={
          sending && !streamActive ? <TypingBubble label={phaseLabel(statusPhase, lang)} /> : null
        }
      />
      <View style={styles.composer}>
        <TextInput
          style={[styles.input, { textAlign: rtl ? 'right' : 'left' }]}
          placeholder={t(lang, 'chat.typeMessage')}
          placeholderTextColor={colors.textMuted}
          value={input}
          onChangeText={setInput}
          multiline
          maxLength={2000}
          editable={!sending}
          onSubmitEditing={send}
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!input.trim() || sending) && styles.sendBtnDisabled]}
          onPress={send}
          disabled={!input.trim() || sending}
          activeOpacity={0.8}
        >
          <MaterialIcons
            name="send"
            size={20}
            color="#fff"
            style={rtl ? { transform: [{ scaleX: -1 }] } : undefined}
          />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  offlineBanner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    marginHorizontal: spacing.md, marginTop: spacing.sm, padding: spacing.sm,
    backgroundColor: colors.warningSoft, borderRadius: radius.md,
  },
  offlineText: { fontFamily: fontFamily.medium, fontSize: fontSize.xs, color: colors.warning },
  errorWrap: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  list: { padding: spacing.md, gap: spacing.sm, flexGrow: 1 },
  bubble: { maxWidth: '92%', borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.sm },
  userBubble: { alignSelf: 'flex-end', backgroundColor: colors.bubbleUser, borderBottomRightRadius: 4 },
  userBubbleRtl: { borderBottomRightRadius: radius.lg, borderBottomLeftRadius: 4 },
  userText: { color: colors.bubbleUserText, fontSize: fontSize.md, fontFamily: fontFamily.regular },
  retryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    marginTop: spacing.xs, padding: 6, alignSelf: 'flex-end',
  },
  retryLabel: { fontFamily: fontFamily.medium, fontSize: fontSize.xs, color: colors.bubbleUserText },
  editInput: {
    color: colors.bubbleUserText, fontSize: fontSize.md, fontFamily: fontFamily.regular,
    minHeight: 60, textAlignVertical: 'top',
  },
  editBtnRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, justifyContent: 'flex-end' },
  editBtn: {
    paddingHorizontal: spacing.md, paddingVertical: 8,
    borderRadius: radius.md, borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)',
  },
  editBtnPrimary: { backgroundColor: '#fff', borderColor: '#fff' },
  editBtnLabel: { fontFamily: fontFamily.medium, fontSize: fontSize.sm, color: '#fff' },
  editBtnPrimaryLabel: { fontFamily: fontFamily.medium, fontSize: fontSize.sm, color: colors.bubbleUser },
  assistantBubble: { alignSelf: 'stretch', backgroundColor: colors.bubbleAssistant, borderBottomLeftRadius: 4 },
  assistantText: { color: colors.text, fontSize: fontSize.md, fontFamily: fontFamily.regular },
  actions: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginTop: spacing.sm, paddingTop: spacing.sm,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, padding: 6 },
  actionLabel: { fontFamily: fontFamily.medium, fontSize: fontSize.xs, color: colors.textMuted },
  typingRow: { flexDirection: 'row', gap: 6, paddingVertical: 4 },
  typingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.textMuted, opacity: 0.6 },
  typingLabel: { fontSize: fontSize.xs, fontFamily: fontFamily.regular, color: colors.textMuted, marginTop: 6 },
  composer: {
    flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm,
    padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  input: {
    flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill,
    paddingHorizontal: spacing.md, paddingVertical: 10, fontSize: fontSize.md,
    fontFamily: fontFamily.regular, color: colors.text, maxHeight: 120,
  },
  sendBtn: {
    width: 46, height: 46, borderRadius: 23, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.5 },
});
