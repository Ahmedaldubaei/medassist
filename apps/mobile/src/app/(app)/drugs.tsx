/**
 * Drug quick-reference: search + drug cards with documented doses and
 * citations. Missing data is shown as unavailable — never invented.
 */
import React, { useCallback, useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { api, type DrugItem } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { t } from '../../i18n';
import { colors, fontFamily, fontSize, radius, spacing } from '../../theme';
import { EmptyState, ErrorBanner, LoadingView } from '../../components/ui';

function Disclaimer({ lang }: { lang: 'ar' | 'en' }) {
  return (
    <View style={styles.disclaimer}>
      <MaterialIcons name="info-outline" size={16} color={colors.info} />
      <Text style={[styles.disclaimerText, { textAlign: lang === 'ar' ? 'right' : 'left' }]}>
        {t(lang, 'drugs.disclaimer')}
      </Text>
    </View>
  );
}

function DrugCard({ drug, lang }: { drug: DrugItem; lang: 'ar' | 'en' }) {
  const rtl = lang === 'ar';
  const align = { textAlign: (rtl ? 'right' : 'left') as 'right' | 'left' };
  const name = lang === 'ar' ? drug.nameAr : drug.nameEn;
  return (
    <View style={styles.card}>
      <Text style={[styles.name, align]}>{name}</Text>
      {drug.classAr ? <Text style={[styles.class, align]}>{drug.classAr}</Text> : null}
      {drug.entries.map((e, i) => (
        <View key={i} style={styles.entry}>
          <Text style={[styles.indication, align]}>
            {lang === 'ar' ? e.indicationAr : e.indicationEn}
          </Text>
          <View style={styles.doseRow}>
            <Text style={[styles.doseLabel, align]}>{t(lang, 'drugs.dose')}: </Text>
            <Text style={[styles.dose, align]}>
              {e.dose ?? `⚠ ${t(lang, 'drugs.unavailable')}`}
            </Text>
          </View>
          {e.route ? (
            <Text style={[styles.meta, align]}>{t(lang, 'drugs.route')}: {e.route}</Text>
          ) : null}
          {(lang === 'ar' ? e.notesAr : e.notesEn) ? (
            <Text style={[styles.meta, align]}>
              {t(lang, 'drugs.notes')}: {lang === 'ar' ? e.notesAr : e.notesEn}
            </Text>
          ) : null}
          <Text style={[styles.source, align]}>
            {t(lang, 'emergency.source')}: {e.citation.title}
          </Text>
        </View>
      ))}
    </View>
  );
}

export default function DrugsScreen() {
  const { token, lang } = useAuth();
  const [q, setQ] = useState('');
  const [drugs, setDrugs] = useState<DrugItem[] | null>(null);
  const [err, setErr] = useState('');

  const load = useCallback(
    async (query: string) => {
      if (!token) return;
      try {
        setErr('');
        const res = await api.clinical.drugs(token, query.trim() || undefined);
        setDrugs(res.drugs);
      } catch {
        setErr(t(lang, 'common.retry'));
      }
    },
    [token, lang],
  );

  useFocusEffect(
    useCallback(() => {
      setDrugs(null);
      void load('');
    }, [load]),
  );

  // Debounced search
  React.useEffect(() => {
    const h = setTimeout(() => void load(q), 400);
    return () => clearTimeout(h);
  }, [q, load]);

  if (drugs === null && !err) return <LoadingView label={t(lang, 'common.loading')} />;

  return (
    <View style={styles.root}>
      <View style={styles.searchWrap}>
        <MaterialIcons name="search" size={20} color={colors.textMuted} />
        <TextInput
          style={[styles.search, { textAlign: lang === 'ar' ? 'right' : 'left' }]}
          placeholder={t(lang, 'drugs.searchPlaceholder')}
          placeholderTextColor={colors.textMuted}
          value={q}
          onChangeText={setQ}
        />
      </View>
      {err ? <ErrorBanner message={err} /> : null}
      <Disclaimer lang={lang} />
      <FlatList
        data={drugs ?? []}
        keyExtractor={(d) => d.nameEn}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<EmptyState icon="medication" title={t(lang, 'drugs.empty')} />}
        renderItem={({ item }) => <DrugCard drug={item} lang={lang} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    margin: spacing.md, paddingHorizontal: spacing.md,
    backgroundColor: colors.surface, borderRadius: radius.pill, height: 48,
  },
  search: { flex: 1, fontFamily: fontFamily.regular, fontSize: fontSize.md, color: colors.text },
  list: { padding: spacing.md, paddingTop: 0, gap: spacing.md },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg },
  name: { fontFamily: fontFamily.bold, fontSize: fontSize.lg, color: colors.primary },
  class: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: colors.textMuted, marginTop: 2 },
  entry: {
    marginTop: spacing.md, paddingTop: spacing.md,
    borderTopWidth: 1, borderTopColor: colors.surfaceAlt,
  },
  indication: { fontFamily: fontFamily.medium, fontSize: fontSize.sm, color: colors.text, marginBottom: 6 },
  doseRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline' },
  doseLabel: { fontFamily: fontFamily.medium, fontSize: fontSize.sm, color: colors.textMuted },
  dose: { fontFamily: fontFamily.bold, fontSize: fontSize.md, color: colors.text },
  meta: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: colors.textMuted, marginTop: 4 },
  source: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.textMuted, marginTop: 6, fontStyle: 'italic' },
  disclaimer: {
    flexDirection: 'row', gap: spacing.xs, alignItems: 'flex-start',
    marginHorizontal: spacing.md, marginBottom: spacing.sm,
    padding: spacing.md, backgroundColor: colors.infoSoft, borderRadius: radius.md,
  },
  disclaimerText: { flex: 1, fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.text },
});
