/**
 * Chat screen: professional bubbles, typing indicator, auto-scroll,
 * AssistantMessage rendering for assistant turns.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useNavigation, router } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { api, type ChatMessage, type ChatResponse, type ConversationMessageItem } from '../../../api/client';
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
  const base = { id: m.id, text: m.content, createdAt: Date.parse(m.createdAt) };
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

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token, lang } = useAuth();
  const rtl = lang === 'ar';
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [streamActive, setStreamActive] = useState(false);
  const [error, setError] = useState('');
  const [conversationId, setConversationId] = useState<string | undefined>(id === 'new' ? undefined : id);
  const listRef = useRef<FlatList>(null);
  const navigation = useNavigation();

  // "New chat" action reachable from the chat screen header.
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

  // Reset per-conversation state when navigating between conversations
  // (documented "adjust state during render" pattern — no effect needed).
  const [activeId, setActiveId] = useState(id);
  if (activeId !== id) {
    setActiveId(id);
    setMessages([]);
    setConversationId(id === 'new' ? undefined : id);
  }

  // Load the conversation's messages from the backend (per-account, server-scoped).
  useEffect(() => {
    if (id === 'new' || !token) return;
    let alive = true;
    api.conversations
      .messages(token, id, { limit: 100 })
      .then((res) => {
        if (!alive) return;
        setError('');
        setMessages(res.messages.map((m) => toChatMessage(m, id)));
        setConversationId(id);
      })
      .catch(() => {
        if (alive) setError(t(lang, 'chat.errLoad'));
      });
    return () => {
      alive = false;
    };
  }, [id, token, lang]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || sending || !token) return;
    setInput('');
    setError('');
    const userMsg: ChatMessage = { id: nextId(), role: 'user', text, createdAt: Date.now() };
    const withUser = [...messages, userMsg];
    // Placeholder assistant message, filled in live as SSE tokens arrive.
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
      const chat: ChatResponse = {
        answer: streamed,
        citations: meta.citations,
        confidence: meta.confidence,
        disclaimer: meta.disclaimer,
        agentUsed: meta.agentUsed,
        safetyVerdict: meta.safetyVerdict,
        conversationId: meta.conversationId,
        escalated: meta.escalated,
      };
      const finalText = streamed;
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, text: finalText, chat } : m)),
      );
      // The backend persists the exchange server-side; no local cache needed.
    } catch {
      // Streaming failed or unsupported — fall back to the non-streaming endpoint.
      try {
        const res = await api.chat(token, { message: text, conversationId });
        setConversationId(res.conversationId);
        const assistantMsg: ChatMessage = {
          id: assistantId,
          role: 'assistant',
          text: res.answer,
          createdAt: Date.now(),
          chat: res,
        };
        setMessages([...withUser, assistantMsg]);
      } catch {
        setError(t(lang, 'chat.error'));
        setMessages(withUser);
      }
    } finally {
      setSending(false);
      setStreamActive(false);
    }
  }, [input, sending, token, messages, conversationId, lang]);

  const renderItem = ({ item }: { item: ChatMessage }) => {
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
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
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
            name={rtl ? 'send' : 'send'}
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
  errorWrap: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  list: { padding: spacing.md, gap: spacing.sm, flexGrow: 1 },
  bubble: { maxWidth: '92%', borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.sm },
  userBubble: { alignSelf: 'flex-end', backgroundColor: colors.bubbleUser, borderBottomRightRadius: 4 },
  userBubbleRtl: { borderBottomRightRadius: radius.lg, borderBottomLeftRadius: 4 },
  userText: { color: colors.bubbleUserText, fontSize: fontSize.md, fontFamily: fontFamily.regular },
  assistantBubble: { alignSelf: 'stretch', backgroundColor: colors.bubbleAssistant, borderBottomLeftRadius: 4 },
  assistantText: { color: colors.text, fontSize: fontSize.md, fontFamily: fontFamily.regular },
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
