/**
 * Home — conversations list with:
 * - Personalized greeting ("مرحبًا د. {name}")
 * - In-chat search bar (searches the user's own messages server-side)
 * - Quick links: emergency checklists, drugs, calculators, pinned
 * - Offline read-through cache with banner
 */
import React, { useCallback, useState } from 'react';
import {
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import {
  api,
  listConversationsCached,
  type ConversationListItem,
  type MessageSearchHit,
} from '../../api/client';
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

function QuickLink({
  icon,
  label,
  href,
  danger,
}: {
  icon: string;
  label: string;
  href: string;
  danger?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.quick, danger && styles.quickDanger]}
      activeOpacity={0.8}
      onPress={() => router.push(href as never)}
    >
      <MaterialIcons name={icon as never} size={22} color={danger ? '#fff' : colors.primary} />
      <Text style={[styles.quickLabel, danger && styles.quickLabelDanger]}>{label}</Text>
    </TouchableOpacity>
  );
}

export default function HomeScreen() {
  const { token, user, lang } = useAuth();
  const [convs, setConvs] = useState<ConversationListItem[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [offline, setOffline] = useState(false);
  /** M7: timestamp of the cached copy being shown (null when online). */
  const [offlineAt, setOfflineAt] = useState<number | null>(null);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<MessageSearchHit[] | null>(null);

  const scope = user?.id ?? 'anon';

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setLoadError('');
      const { data, fromCache, cachedAt } = await listConversationsCached(token, scope);
      setConvs(data.conversations);
      setOffline(fromCache);
      setOfflineAt(fromCache ? (cachedAt ?? null) : null);
    } catch {
      setLoadError(t(lang, 'chat.errLoad'));
    }
  }, [token, scope, lang]);

  useFocusEffect(
    useCallback(() => {
      setConvs(null);
      setOffline(false);
      setOfflineAt(null);
      void load();
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

  // Debounced in-chat search (user-scoped, server-side).
  React.useEffect(() => {
    if (!q.trim() || !token) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHits(null);
      return;
    }
    const h = setTimeout(async () => {
      try {
        const res = await api.conversations.search(token, q.trim());
        setHits(res.messages);
      } catch {
        setHits([]);
      }
    }, 400);
    return () => clearTimeout(h);
  }, [q, token]);

  const greeting = user?.name?.trim()
    ? `${t(lang, 'home.greeting')} ${user.name.trim()}`
    : t(lang, 'home.greetingFallback');

  if (convs === null && !loadError) return <LoadingView label={t(lang, 'common.loading')} />;

  const showingSearch = q.trim().length > 0;

  return (
    <View style={styles.root}>
      <View style={styles.greetingWrap}>
        <Text style={[styles.greeting, { textAlign: lang === 'ar' ? 'right' : 'left' }]}>
          {greeting}
        </Text>
      </View>

      {offline ? (
        <View style={styles.offlineBanner}>
          <MaterialIcons name="cloud-off" size={16} color={colors.warning} />
          <Text style={styles.offlineText}>
            {t(lang, 'common.offline')}
            {offlineAt ? ` ${t(lang, 'common.offlineSavedAt')} ${new Date(offlineAt).toLocaleDateString(lang === 'ar' ? 'ar' : 'en')}` : ''}
          </Text>
        </View>
      ) : null}

      <View style={styles.searchWrap}>
        <MaterialIcons name="search" size={20} color={colors.textMuted} />
        <TextInput
          style={[styles.search, { textAlign: lang === 'ar' ? 'right' : 'left' }]}
          placeholder={t(lang, 'home.searchChats')}
          placeholderTextColor={colors.textMuted}
          value={q}
          onChangeText={setQ}
        />
        {q ? (
          <TouchableOpacity onPress={() => setQ('')} hitSlop={10}>
            <MaterialIcons name="close" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={styles.quickRow}>
        <QuickLink icon="emergency" label={t(lang, 'home.emergency')} href="/(app)/emergency" danger />
        <QuickLink icon="medication" label={t(lang, 'home.drugs')} href="/(app)/drugs" />
        <QuickLink icon="calculate" label={t(lang, 'home.calculators')} href="/(app)/calculators" />
        <QuickLink icon="push-pin" label={t(lang, 'home.pinned')} href="/(app)/pinned" />
      </View>

      {loadError ? (
        <View style={styles.errorWrap}>
          <ErrorBanner message={loadError} />
        </View>
      ) : null}

      {showingSearch ? (
        <FlatList
          data={hits ?? []}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            hits === null ? null : (
              <EmptyState icon="search" title={t(lang, 'search.empty')} />
            )
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.row}
              activeOpacity={0.7}
              onPress={() => router.push(`/(app)/chat/${item.conversationId}`)}
            >
              <View style={styles.rowIcon}>
                <MaterialIcons name="search" size={20} color={colors.primary} />
              </View>
              <View style={styles.rowBody}>
                <Text style={styles.rowTitle} numberOfLines={2}>{item.preview}</Text>
                <Text style={styles.rowDate} numberOfLines={1}>{item.conversationTitle}</Text>
              </View>
            </TouchableOpacity>
          )}
        />
      ) : (
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
      )}

      <View style={styles.fabWrap}>
        <TouchableOpacity style={styles.fab} activeOpacity={0.85} onPress={() => router.push('/(app)/chat/new' as never)}>
          <MaterialIcons name="add" size={22} color="#fff" />
          <Text style={styles.fabText}>{t(lang, 'chat.new')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  greetingWrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.xs },
  greeting: { fontFamily: fontFamily.bold, fontSize: fontSize.xl, color: colors.navy },
  offlineBanner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    marginHorizontal: spacing.md, marginTop: spacing.xs, padding: spacing.sm,
    backgroundColor: colors.warningSoft, borderRadius: radius.md,
  },
  offlineText: { fontFamily: fontFamily.medium, fontSize: fontSize.xs, color: colors.warning },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    margin: spacing.md, marginBottom: spacing.sm, paddingHorizontal: spacing.md,
    backgroundColor: colors.surface, borderRadius: radius.pill, height: 46,
  },
  search: { flex: 1, fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: colors.text },
  quickRow: { flexDirection: 'row', gap: spacing.xs, paddingHorizontal: spacing.md, marginBottom: spacing.xs },
  quick: {
    flex: 1, alignItems: 'center', gap: 4, paddingVertical: spacing.sm,
    backgroundColor: colors.surface, borderRadius: radius.md,
  },
  quickDanger: { backgroundColor: colors.danger },
  quickLabel: { fontFamily: fontFamily.medium, fontSize: fontSize.xs, color: colors.primary },
  quickLabelDanger: { color: '#fff' },
  errorWrap: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  list: { padding: spacing.md, paddingTop: spacing.sm, gap: spacing.sm, flexGrow: 1 },
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
