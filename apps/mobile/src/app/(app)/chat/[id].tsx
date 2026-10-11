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
  api,
  getMessagesCached,
  type ChatMessage,
  type ChatResponse,
  type ConversationMessageItem,
} from '../../../api/client';
import { useAuth } from '../../../auth/AuthContext';
import { t } from '../../../i18n';
import { colors, fontFamily, fontSize, radius, spacing } from '../../../theme';
import { AssistantMessage } from '../../../components/AssistantMessage';
import { ErrorBanner } from '../../../components/ui';

let msgSeq = 0;
const nextId = () => `local-${Date.now()}-${msgSeq++}`;

function TypingBubble() {
  return (
    <View style={[styles.bubble, styles.assistantBubble]}>
      <View style={styles.typingRow}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={styles.typingDot} />
        ))}
      </View>
    </View>
  );
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
      disclaimer: '',
      agentUsed: m.agentUsed ?? '',
      safetyVerdict: 'PASS',
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
  const [offline, setOffline] = useState(false);
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
    setConversationId(id === 'new' ? undefined : id);
  }

  const scope = user?.id ?? 'anon';

  const reloadMessages = useCallback(
    async (cid: string) => {
      if (!token) return;
      try {
        const { data, fromCache } = await getMessagesCached(token, scope, cid);
        setMessages(data.messages.map((m) => toChatMessage(m, cid)));
        setOffline(fromCache);
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

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || sending || !token) return;
    setInput('');
    setError('');
    const userMsg: ChatMessage = { id: nextId(), role: 'user', text, createdAt: Date.now() };
    const withUser = [...messages, userMsg];
    const assistantId = nextId();
    const placeholder: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      text: '',
      createdAt: Date.now(),
    };
    setMessages([...withUser, placeholder]);
    setSending(true);
    setStreamActive(false);
    try {
      let streamed = '';
      const meta = await api.chatStream(token, { message: text, conversationId }, (tok) => {
        streamed += tok;
        const snapshot = streamed;
        setStreamActive(true);
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, text: snapshot } : m)),
        );
      });
      setConversationId(meta.conversationId);
      // Reload to sync backend ids (needed for pin) and persisted citations.
      await reloadMessages(meta.conversationId);
    } catch {
      try {
        const res = await api.chat(token, { message: text, conversationId });
        setConversationId(res.conversationId);
        await reloadMessages(res.conversationId);
      } catch {
        setError(t(lang, 'chat.error'));
        setMessages(withUser);
      }
    } finally {
      setSending(false);
      setStreamActive(false);
    }
  }, [input, sending, token, messages, conversationId, lang, reloadMessages]);

  const regenerate = useCallback(async () => {
    if (sending || !token || !conversationId) return;
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
  }, [sending, token, conversationId, lang, reloadMessages]);

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
      return (
        <View style={[styles.bubble, styles.userBubble, rtl && styles.userBubbleRtl]}>
          <Text style={styles.userText}>{item.text}</Text>
        </View>
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
          <Text style={styles.offlineText}>{t(lang, 'common.offline')}</Text>
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
        ListFooterComponent={sending && !streamActive ? <TypingBubble /> : null}
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
