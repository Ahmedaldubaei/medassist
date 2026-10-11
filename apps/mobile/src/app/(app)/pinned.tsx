/**
 * Pinned messages — the user's pinned replies across conversations.
 * Tap to open the conversation.
 */
import React, { useCallback, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { api, type PinnedMessage } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { t } from '../../i18n';
import { colors, fontFamily, fontSize, radius, spacing } from '../../theme';
import { EmptyState, ErrorBanner, LoadingView } from '../../components/ui';

export default function PinnedScreen() {
  const { token, lang } = useAuth();
  const [items, setItems] = useState<PinnedMessage[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setErr('');
      const res = await api.conversations.pinned(token);
      setItems(res.messages);
    } catch {
      setErr(t(lang, 'common.retry'));
    }
  }, [token, lang]);

  useFocusEffect(
    useCallback(() => {
      setItems(null);
      void load();
    }, [load]),
  );

  if (items === null && !err) return <LoadingView label={t(lang, 'common.loading')} />;

  const unpin = async (id: string) => {
    if (!token) return;
    try {
      await api.messages.pin(token, id, false);
      setItems((prev) => prev?.filter((m) => m.id !== id) ?? prev);
    } catch {
      setErr(t(lang, 'msg.pinFailed'));
    }
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <MaterialIcons name="push-pin" size={24} color={colors.primary} />
        <Text style={styles.headerTitle}>{t(lang, 'pinned.title')}</Text>
      </View>
      {err ? <ErrorBanner message={err} /> : null}
      <FlatList
        data={items ?? []}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}
          />
        }
        ListEmptyComponent={
          <EmptyState icon="push-pin" title={t(lang, 'pinned.empty')} hint={t(lang, 'pinned.emptyHint')} />
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            activeOpacity={0.8}
            onPress={() => router.push(`/(app)/chat/${item.conversationId}`)}
          >
            <View style={styles.cardHead}>
              <Text style={styles.convTitle} numberOfLines={1}>{item.conversationTitle}</Text>
              <TouchableOpacity onPress={() => void unpin(item.id)} hitSlop={12}>
                <MaterialIcons name="push-pin" size={20} color={colors.primary} />
              </TouchableOpacity>
            </View>
            <Text
              style={[styles.preview, { textAlign: lang === 'ar' ? 'right' : 'left' }]}
              numberOfLines={3}
            >
              {item.preview}
            </Text>
            <Text style={styles.date}>{new Date(item.createdAt).toLocaleDateString()}</Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    padding: spacing.lg, paddingBottom: spacing.sm,
  },
  headerTitle: { fontFamily: fontFamily.bold, fontSize: fontSize.lg, color: colors.text },
  list: { padding: spacing.md, gap: spacing.sm },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  convTitle: { flex: 1, fontFamily: fontFamily.bold, fontSize: fontSize.sm, color: colors.primary },
  preview: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: colors.text, lineHeight: 22 },
  date: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.textMuted, marginTop: 6 },
});
