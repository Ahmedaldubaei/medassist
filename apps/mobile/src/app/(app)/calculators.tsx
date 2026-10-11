/**
 * Clinical calculators (mobile-side, no backend):
 * - Weight-based dose: only computes when the drug reference documents
 *   per-kg dosing; otherwise shows "unavailable" — never invents.
 * - BMI: pure math.
 * Both carry the reference disclaimer.
 */
import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { api, type DrugItem } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { t } from '../../i18n';
import { colors, fontFamily, fontSize, radius, spacing } from '../../theme';
import { LoadingView } from '../../components/ui';

function SectionTitle({ icon, text }: { icon: string; text: string }) {
  return (
    <View style={styles.sectionTitle}>
      <MaterialIcons name={icon as never} size={20} color={colors.primary} />
      <Text style={styles.sectionTitleText}>{text}</Text>
    </View>
  );
}

function Disclaimer({ lang }: { lang: 'ar' | 'en' }) {
  return (
    <View style={styles.disclaimer}>
      <MaterialIcons name="info-outline" size={16} color={colors.info} />
      <Text style={[styles.disclaimerText, { textAlign: lang === 'ar' ? 'right' : 'left' }]}>
        {t(lang, 'calc.disclaimer')}
      </Text>
    </View>
  );
}

export default function CalculatorsScreen() {
  const { token, lang } = useAuth();
  const rtl = lang === 'ar';
  const align = { textAlign: (rtl ? 'right' : 'left') as 'right' | 'left' };

  const [drugs, setDrugs] = useState<DrugItem[] | null>(null);
  const [drugIdx, setDrugIdx] = useState(0);
  const [weight, setWeight] = useState('');
  const [doseResult, setDoseResult] = useState<string | null>(null);

  const [bmiW, setBmiW] = useState('');
  const [bmiH, setBmiH] = useState('');
  const [bmiResult, setBmiResult] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!token) return;
      api.clinical.drugs(token).then((r) => setDrugs(r.drugs)).catch(() => setDrugs([]));
    }, [token]),
  );

  const drug = drugs && drugs.length > 0 ? drugs[Math.min(drugIdx, drugs.length - 1)] : null;
  const perKgEntry = drug?.entries.find((e) => e.perKg) ?? null;

  const calcDose = () => {
    const w = parseFloat(weight.replace(',', '.'));
    if (!w || w <= 0 || w > 500) {
      setDoseResult(t(lang, 'calc.enterWeight'));
      return;
    }
    if (!perKgEntry?.perKg) {
      setDoseResult(t(lang, 'calc.noPerKg'));
      return;
    }
    const { min, max, unit } = perKgEntry.perKg;
    const lo = (w * min).toFixed(1);
    const hi = (w * max).toFixed(1);
    setDoseResult(`${lo} – ${hi} ${unit} (${w} kg)`);
  };

  const calcBmi = () => {
    const w = parseFloat(bmiW.replace(',', '.'));
    const h = parseFloat(bmiH.replace(',', '.'));
    if (!w || w <= 0 || !h || h <= 0 || h > 300) {
      setBmiResult(t(lang, 'calc.enterWeight'));
      return;
    }
    const bmi = w / Math.pow(h / 100, 2);
    setBmiResult(bmi.toFixed(1));
  };

  if (drugs === null) return <LoadingView label={t(lang, 'common.loading')} />;

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <SectionTitle icon="medication" text={t(lang, 'calc.weightDose')} />
      <View style={styles.card}>
        <Text style={[styles.label, align]}>{t(lang, 'calc.selectDrug')}</Text>
        <View style={styles.chips}>
          {drugs.map((d, i) => (
            <TouchableOpacity
              key={d.nameEn}
              style={[styles.chip, i === drugIdx && styles.chipActive]}
              onPress={() => { setDrugIdx(i); setDoseResult(null); }}
              activeOpacity={0.7}
            >
              <Text style={[styles.chipText, i === drugIdx && styles.chipTextActive]}>
                {lang === 'ar' ? d.nameAr : d.nameEn}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={[styles.label, align]}>{t(lang, 'calc.weight')}</Text>
        <TextInput
          style={[styles.input, align]}
          keyboardType="decimal-pad"
          placeholder="70"
          placeholderTextColor={colors.textMuted}
          value={weight}
          onChangeText={(v) => { setWeight(v); setDoseResult(null); }}
        />
        <TouchableOpacity style={styles.button} onPress={calcDose} activeOpacity={0.85}>
          <Text style={styles.buttonText}>{t(lang, 'calc.calculate')}</Text>
        </TouchableOpacity>
        {doseResult !== null ? (
          <View style={styles.result}>
            <Text style={[styles.resultLabel, align]}>{t(lang, 'calc.result')}</Text>
            <Text style={[styles.resultValue, align]}>{doseResult}</Text>
            {perKgEntry?.citation ? (
              <Text style={[styles.source, align]}>
                {t(lang, 'emergency.source')}: {perKgEntry.citation.title}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
      <Disclaimer lang={lang} />

      <SectionTitle icon="monitor-weight" text={t(lang, 'calc.bmi')} />
      <View style={styles.card}>
        <Text style={[styles.label, align]}>{t(lang, 'calc.weight')}</Text>
        <TextInput
          style={[styles.input, align]}
          keyboardType="decimal-pad"
          placeholder="70"
          placeholderTextColor={colors.textMuted}
          value={bmiW}
          onChangeText={(v) => { setBmiW(v); setBmiResult(null); }}
        />
        <Text style={[styles.label, align]}>{t(lang, 'calc.height')}</Text>
        <TextInput
          style={[styles.input, align]}
          keyboardType="decimal-pad"
          placeholder="170"
          placeholderTextColor={colors.textMuted}
          value={bmiH}
          onChangeText={(v) => { setBmiH(v); setBmiResult(null); }}
        />
        <TouchableOpacity style={styles.button} onPress={calcBmi} activeOpacity={0.85}>
          <Text style={styles.buttonText}>{t(lang, 'calc.calculate')}</Text>
        </TouchableOpacity>
        {bmiResult !== null ? (
          <View style={styles.result}>
            <Text style={[styles.resultLabel, align]}>{t(lang, 'calc.bmiResult')}</Text>
            <Text style={[styles.resultValue, align]}>{bmiResult}</Text>
          </View>
        ) : null}
      </View>
      <Disclaimer lang={lang} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  sectionTitle: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.sm },
  sectionTitleText: { fontFamily: fontFamily.bold, fontSize: fontSize.lg, color: colors.text },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg },
  label: { fontFamily: fontFamily.medium, fontSize: fontSize.sm, color: colors.textMuted, marginBottom: 6, marginTop: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    paddingVertical: 10, paddingHorizontal: 16, borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.surfaceAlt,
  },
  chipActive: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  chipText: { fontFamily: fontFamily.medium, fontSize: fontSize.sm, color: colors.text },
  chipTextActive: { color: colors.primary, fontFamily: fontFamily.bold },
  input: {
    backgroundColor: colors.surfaceAlt, borderRadius: radius.md,
    paddingVertical: 12, paddingHorizontal: 14,
    fontFamily: fontFamily.regular, fontSize: fontSize.lg, color: colors.text,
  },
  button: {
    backgroundColor: colors.primary, borderRadius: radius.pill,
    paddingVertical: 14, alignItems: 'center', marginTop: spacing.md,
  },
  buttonText: { color: '#fff', fontFamily: fontFamily.bold, fontSize: fontSize.md },
  result: {
    marginTop: spacing.md, padding: spacing.md,
    backgroundColor: colors.primarySoft, borderRadius: radius.md,
  },
  resultLabel: { fontFamily: fontFamily.medium, fontSize: fontSize.sm, color: colors.textMuted },
  resultValue: { fontFamily: fontFamily.bold, fontSize: fontSize.xl, color: colors.primary, marginTop: 4 },
  source: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.textMuted, marginTop: 6, fontStyle: 'italic' },
  disclaimer: {
    flexDirection: 'row', gap: spacing.xs, alignItems: 'flex-start',
    padding: spacing.md, backgroundColor: colors.infoSoft, borderRadius: radius.md,
  },
  disclaimerText: { flex: 1, fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.text },
});
