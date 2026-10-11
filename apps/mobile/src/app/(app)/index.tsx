/**
 * Conversations list + new chat entry point.
 * History is cached locally (backend exposes no list endpoint yet — P5).
 */
import React, { useCallback, useState } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Link, router, useFocusEffect } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { historyStore, type ConversationSummary } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { t } from '../../i18n';
import { colors, fontFamily, fontSize, radius, spacing } from '../../theme';
import { EmptyState, LoadingView } from '../../components/ui';

function Row({ conv, lang }: { conv: ConversationSummary; lang: 'ar' | 'en' }) {
  return (
    <TouchableOpacity
      style={styles.row}
      activeOpacity={0.7}
      onPress={() => router.push(`/(app)/chat/${conv.id}`)}
    >
      <View style={styles.rowIcon}>
        <MaterialIcons name="chat-bubble-outline" size={20} color={colors.primary} />
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={1}>{conv.title}</Text>
        <Text style={styles.rowDate}>{new Date(conv.updatedAt).toLocaleDateString()}</Text>
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
  const { lang } = useAuth();
  const [convs, setConvs] = useState<ConversationSummary[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      historyStore.get().then((list) => {
        if (alive) setConvs(list);
      });
      return () => { alive = false; };
    }, []),
  );

  if (convs === null) return <LoadingView label={t(lang, 'common.loading')} />;

  return (
    <View style={styles.root}>
      <FlatList
        data={convs}
        keyExtractor={(c) => c.id}
        renderItem={({ item }) => <Row conv={item} lang={lang} />}
        contentContainerStyle={styles.list}
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
