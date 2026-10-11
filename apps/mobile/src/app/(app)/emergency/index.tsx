/**
 * Emergency checklists — list of curated, corpus-cited crisis checklists.
 * Every step cites its source document; nothing is invented.
 */
import React, { useCallback, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { api, type ChecklistSummary } from '../../../api/client';
import { useAuth } from '../../../auth/AuthContext';
import { t } from '../../../i18n';
import { colors, fontFamily, fontSize, radius, spacing } from '../../../theme';
import { EmptyState, ErrorBanner, LoadingView } from '../../../components/ui';

export default function EmergencyListScreen() {
  const { token, lang } = useAuth();
  const [lists, setLists] = useState<ChecklistSummary[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setErr('');
      const res = await api.clinical.checklists(token);
      setLists(res.checklists);
    } catch {
      setErr(t(lang, 'common.retry'));
    }
  }, [token, lang]);

  useFocusEffect(
    useCallback(() => {
      setLists(null);
      void load();
    }, [load]),
  );

  if (lists === null && !err) return <LoadingView label={t(lang, 'common.loading')} />;

  const title = (c: ChecklistSummary) => (lang === 'ar' ? c.titleAr : c.titleEn);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <MaterialIcons name="emergency" size={28} color={colors.danger} />
        <View style={styles.headerText}>
          <Text style={styles.headerTitle}>{t(lang, 'emergency.title')}</Text>
          <Text style={styles.headerSub}>{t(lang, 'emergency.subtitle')}</Text>
        </View>
      </View>
      {err ? <ErrorBanner message={err} onRetry={load} retryLabel={t(lang, 'common.retry')} /> : null}
      <FlatList
        data={lists ?? []}
        keyExtractor={(c) => c.key}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
        ListEmptyComponent={<EmptyState icon="medical-services" title={t(lang, 'drugs.empty')} />}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            activeOpacity={0.8}
            onPress={() => router.push(`/(app)/emergency/${item.key}`)}
          >
            <View style={styles.cardIcon}>
              <MaterialIcons name="checklist" size={24} color="#fff" />
            </View>
            <Text style={styles.cardTitle}>{title(item)}</Text>
            <MaterialIcons
              name={lang === 'ar' ? 'chevron-left' : 'chevron-right'}
              size={24}
              color={colors.textMuted}
            />
          </TouchableOpacity>
        )}
      />
      <View style={styles.disclaimer}>
        <MaterialIcons name="info-outline" size={16} color={colors.info} />
        <Text style={[styles.disclaimerText, { textAlign: lang === 'ar' ? 'right' : 'left' }]}>
          {t(lang, 'emergency.disclaimer')}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    padding: spacing.lg, paddingBottom: spacing.sm,
  },
  headerText: { flex: 1 },
  headerTitle: { fontFamily: fontFamily.bold, fontSize: fontSize.lg, color: colors.text },
  headerSub: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: colors.textMuted, marginTop: 2 },
  list: { padding: spacing.md, gap: spacing.sm },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg,
    borderLeftWidth: 4, borderLeftColor: colors.danger,
  },
  cardIcon: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: colors.danger,
    alignItems: 'center', justifyContent: 'center',
  },
  cardTitle: { flex: 1, fontFamily: fontFamily.bold, fontSize: fontSize.md, color: colors.text },
  disclaimer: {
    flexDirection: 'row', gap: spacing.xs, alignItems: 'flex-start',
    margin: spacing.md, padding: spacing.md,
    backgroundColor: colors.infoSoft, borderRadius: radius.md,
  },
  disclaimerText: { flex: 1, fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.text },
});
