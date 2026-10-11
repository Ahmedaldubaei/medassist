/**
 * Conversations list — the signed-in user's own chat history from the backend
 * (GET /api/v1/conversations, newest first), with pull-to-refresh and a
 * "new chat" entry point. Per-account scoping is enforced server-side.
 */
import React, { useCallback, useState } from 'react';
import { Alert, FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Link, router, useFocusEffect } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { api, type ConversationListItem } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { t } from '../../i18n';
import { colors, fontFamily, fontSize, radius, spacing } from '../../theme';
import { EmptyState, ErrorBanner, LoadingView } from '../../components/ui';

function Row({
  conv,
  lang,
  onDelete,
}: {
  conv: ConversationListItem;
  lang: 'ar' | 'en';
  onDelete: (id: string) => void;
}) {
  return (
    <TouchableOpacity
      style={styles.row}
      activeOpacity={0.7}
      onPress={() => router.push(`/(app)/chat/${conv.id}`)}
      onLongPress={() =>
        Alert.alert(t(lang, 'chat.deleteTitle'), t(lang, 'chat.deleteMessage'), [
          { text: t(lang, 'common.cancel'), style: 'cancel' },
          { text: t(lang, 'chat.delete'), style: 'destructive', onPress: () => onDelete(conv.id) },
        ])
      }
    >
      <View style={styles.rowIcon}>
        <MaterialIcons name="chat-bubble-outline" size={20} color={colors.primary} />
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={1}>{conv.title}</Text>
        <Text style={styles.rowDate}>
          {new Date(conv.createdAt).toLocaleDateString()} · {conv.messageCount}
        </Text>
      </View>
      <MaterialIcons
        name={lang === 'ar' ? 'chevron-left' : 'chevron-right'}
        size={22}
        color={colors.textMuted}
      />
    </TouchableOpacity>
  );
}

export default function ConversationsScreen() {
  const { token, lang } = useAuth();
  const [convs, setConvs] = useState<ConversationListItem[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setLoadError('');
      const res = await api.conversations.list(token, { limit: 50 });
      setConvs(res.conversations);
    } catch {
      setLoadError(t(lang, 'chat.errLoad'));
    }
  }, [token, lang]);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      setConvs(null);
      void load().then(() => {
        if (!alive) return;
      });
      return () => {
        alive = false;
      };
    }, [load]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const onDelete = useCallback(
    async (id: string) => {
      if (!token) return;
      try {
        await api.conversations.remove(token, id);
        setConvs((prev) => prev?.filter((c) => c.id !== id) ?? prev);
      } catch {
        setLoadError(t(lang, 'chat.deleteFailed'));
      }
    },
    [token, lang],
  );

  if (convs === null && !loadError) return <LoadingView label={t(lang, 'common.loading')} />;

  return (
    <View style={styles.root}>
      {loadError ? (
        <View style={styles.errorWrap}>
          <ErrorBanner message={loadError} />
        </View>
      ) : null}
      <FlatList
        data={convs ?? []}
        keyExtractor={(c) => c.id}
        renderItem={({ item }) => <Row conv={item} lang={lang} onDelete={onDelete} />}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          <EmptyState icon="forum" title={t(lang, 'chat.empty')} hint={t(lang, 'chat.emptyHint')} />
        }
      />
      <View style={styles.fabWrap}>
        <Link href="/(app)/chat/new" asChild>
          <TouchableOpacity style={styles.fab} activeOpacity={0.85}>
            <MaterialIcons name="add" size={22} color="#fff" />
            <Text style={styles.fabText}>{t(lang, 'chat.new')}</Text>
          </TouchableOpacity>
        </Link>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  errorWrap: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  list: { padding: spacing.md, gap: spacing.sm, flexGrow: 1 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md,
  },
  rowIcon: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primarySoft,
    alignItems: 'center', justifyContent: 'center',
  },
  rowBody: { flex: 1 },
  rowTitle: { fontFamily: fontFamily.medium, fontSize: fontSize.md, color: colors.text },
  rowDate: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2 },
  fabWrap: { padding: spacing.md },
  fab: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
    backgroundColor: colors.primary, borderRadius: radius.pill, paddingVertical: 14,
  },
  fabText: { color: '#fff', fontFamily: fontFamily.bold, fontSize: fontSize.md },
});
