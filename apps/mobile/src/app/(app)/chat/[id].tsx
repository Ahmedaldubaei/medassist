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
import { useLocalSearchParams } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { api, historyStore, type ChatMessage, type ConversationSummary } from '../../../api/client';
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

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token, lang } = useAuth();
  const rtl = lang === 'ar';
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [conversationId, setConversationId] = useState<string | undefined>(id === 'new' ? undefined : id);
  const listRef = useRef<FlatList>(null);

  // Load cached conversation.
  useEffect(() => {
    if (id === 'new') {
      setMessages([]);
      setConversationId(undefined);
      return;
    }
    historyStore.get().then((list) => {
      const conv = list.find((c) => c.id === id);
      if (conv) {
        setMessages(conv.messages);
        setConversationId(conv.id);
      }
    });
  }, [id]);

  const persist = useCallback(
    async (convId: string, msgs: ChatMessage[]) => {
      const list = await historyStore.get();
      const title = msgs.find((m) => m.role === 'user')?.text.slice(0, 60) ?? convId.slice(0, 8);
      const summary: ConversationSummary = {
        id: convId,
        title,
        createdAt: list.find((c) => c.id === convId)?.createdAt ?? Date.now(),
        updatedAt: Date.now(),
        messages: msgs,
      };
      const next = [summary, ...list.filter((c) => c.id !== convId)];
      await historyStore.set(next);
    },
    [],
  );

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || sending || !token) return;
    setInput('');
    setError('');
    const userMsg: ChatMessage = { id: nextId(), role: 'user', text, createdAt: Date.now() };
    const withUser = [...messages, userMsg];
    setMessages(withUser);
    setSending(true);
    try {
      const res = await api.chat(token, { message: text, conversationId });
      const convId = res.conversationId;
      setConversationId(convId);
      const assistantMsg: ChatMessage = {
        id: nextId(),
        role: 'assistant',
        text: res.answer,
        createdAt: Date.now(),
        chat: res,
      };
      const final = [...withUser, assistantMsg];
      setMessages(final);
      await persist(convId, final);
    } catch {
      setError(t(lang, 'chat.error'));
      setMessages(withUser);
    } finally {
      setSending(false);
    }
  }, [input, sending, token, messages, conversationId, lang, persist]);

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
        ListFooterComponent={sending ? <TypingBubble /> : null}
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
