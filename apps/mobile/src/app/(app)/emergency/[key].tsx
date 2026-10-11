/**
 * Interactive crisis checklist: tappable checkboxes, progress bar, reset,
 * per-step source citations. Big touch targets for use in a hurry.
 */
import React, { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { api, type ChecklistDetail, type ChecklistStep } from '../../../api/client';
import { useAuth } from '../../../auth/AuthContext';
import { t } from '../../../i18n';
import { colors, fontFamily, fontSize, radius, spacing } from '../../../theme';
import { ErrorBanner, LoadingView } from '../../../components/ui';

function StepRow({
  step,
  index,
  checked,
  lang,
  onToggle,
}: {
  step: ChecklistStep;
  index: number;
  checked: boolean;
  lang: 'ar' | 'en';
  onToggle: () => void;
}) {
  const rtl = lang === 'ar';
  const text = lang === 'ar' ? step.textAr : step.textEn;
  return (
    <TouchableOpacity
      style={[styles.step, checked && styles.stepDone]}
      activeOpacity={0.75}
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
    >
      <View style={[styles.checkbox, checked && styles.checkboxDone]}>
        {checked ? <MaterialIcons name="check" size={26} color="#fff" /> : null}
      </View>
      <View style={styles.stepBody}>
        <Text style={[styles.stepNum, { textAlign: rtl ? 'right' : 'left' }]}>
          {index + 1}
        </Text>
        <Text style={[styles.stepText, checked && styles.stepTextDone, { textAlign: rtl ? 'right' : 'left' }]}>
          {step.unavailable ? `⚠ ${t(lang, 'emergency.unavailable')}` : text}
        </Text>
        <Text style={[styles.stepSource, { textAlign: rtl ? 'right' : 'left' }]}>
          {t(lang, 'emergency.source')}: {step.citation.title}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

export default function ChecklistScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const { token, lang } = useAuth();
  const [detail, setDetail] = useState<ChecklistDetail | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    if (!token || !key) return;
    try {
      setErr('');
      const res = await api.clinical.checklist(token, key);
      setDetail(res);
      setChecked(new Set());
    } catch {
      setErr(t(lang, 'common.retry'));
    }
  }, [token, key, lang]);

  React.useEffect(() => {
    // Intentional reset + fetch when the checklist key changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDetail(null);
    void load();
  }, [load]);

  const toggle = (i: number) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  const onReset = () =>
    Alert.alert(t(lang, 'emergency.reset'), t(lang, 'emergency.resetConfirm'), [
      { text: t(lang, 'common.cancel'), style: 'cancel' },
      { text: t(lang, 'common.confirm'), onPress: () => setChecked(new Set()) },
    ]);

  if (!detail && !err) return <LoadingView label={t(lang, 'common.loading')} />;
  if (err || !detail) {
    return (
      <View style={styles.root}>
        <ErrorBanner message={err || t(lang, 'common.retry')} onRetry={load} retryLabel={t(lang, 'common.retry')} />
      </View>
    );
  }

  const total = detail.steps.length;
  const done = checked.size;
  const allDone = total > 0 && done === total;
  const title = lang === 'ar' ? detail.titleAr : detail.titleEn;

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={[styles.title, { textAlign: lang === 'ar' ? 'right' : 'left' }]}>{title}</Text>
        <TouchableOpacity style={styles.resetBtn} onPress={onReset} activeOpacity={0.7}>
          <MaterialIcons name="refresh" size={18} color={colors.primary} />
          <Text style={styles.resetText}>{t(lang, 'emergency.reset')}</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.progressWrap}>
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${total ? (done / total) * 100 : 0}%` }]} />
        </View>
        <Text style={styles.progressText}>
          {done}/{total} {t(lang, 'emergency.progress')}
        </Text>
      </View>
      {allDone ? (
        <View style={styles.doneBanner}>
          <MaterialIcons name="check-circle" size={20} color={colors.success} />
          <Text style={styles.doneText}>{t(lang, 'emergency.allDone')}</Text>
        </View>
      ) : null}
      <ScrollView contentContainerStyle={styles.list}>
        {detail.steps.map((s, i) => (
          <StepRow key={i} step={s} index={i} checked={checked.has(i)} lang={lang} onToggle={() => toggle(i)} />
        ))}
        <View style={styles.disclaimer}>
          <MaterialIcons name="info-outline" size={16} color={colors.info} />
          <Text style={[styles.disclaimerText, { textAlign: lang === 'ar' ? 'right' : 'left' }]}>
            {t(lang, 'emergency.disclaimer')}
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: spacing.lg, paddingBottom: spacing.sm,
  },
  title: { flex: 1, fontFamily: fontFamily.bold, fontSize: fontSize.lg, color: colors.danger },
  resetBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingVertical: 8, paddingHorizontal: 12,
    borderRadius: radius.pill, backgroundColor: colors.primarySoft,
  },
  resetText: { fontFamily: fontFamily.medium, fontSize: fontSize.sm, color: colors.primary },
  progressWrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  progressBar: { flex: 1, height: 10, borderRadius: 5, backgroundColor: colors.surfaceAlt, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: colors.success, borderRadius: 5 },
  progressText: { fontFamily: fontFamily.medium, fontSize: fontSize.sm, color: colors.textMuted },
  doneBanner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    marginHorizontal: spacing.lg, marginBottom: spacing.sm, padding: spacing.md,
    backgroundColor: colors.successSoft, borderRadius: radius.md,
  },
  doneText: { flex: 1, fontFamily: fontFamily.bold, fontSize: fontSize.sm, color: colors.success },
  list: { padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xl },
  step: {
    flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start',
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg,
    minHeight: 76,
  },
  stepDone: { opacity: 0.75, backgroundColor: colors.successSoft },
  checkbox: {
    width: 44, height: 44, borderRadius: 12, marginTop: 2,
    borderWidth: 2, borderColor: colors.primary,
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff',
  },
  checkboxDone: { backgroundColor: colors.success, borderColor: colors.success },
  stepBody: { flex: 1 },
  stepNum: { fontFamily: fontFamily.bold, fontSize: fontSize.xs, color: colors.primary, marginBottom: 2 },
  stepText: { fontFamily: fontFamily.medium, fontSize: fontSize.md, color: colors.text, lineHeight: 24 },
  stepTextDone: { textDecorationLine: 'line-through', color: colors.textMuted },
  stepSource: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.textMuted, marginTop: 6 },
  disclaimer: {
    flexDirection: 'row', gap: spacing.xs, alignItems: 'flex-start',
    padding: spacing.md, backgroundColor: colors.infoSoft, borderRadius: radius.md, marginTop: spacing.sm,
  },
  disclaimerText: { flex: 1, fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.text },
});
