/**
 * Settings: language switch (RTL flip + reload), account info, sign out.
 */
import React, { useState } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';
import * as Updates from 'expo-updates';
import { MaterialIcons } from '@expo/vector-icons';
import { useAuth } from '../../auth/AuthContext';
import { t, type Lang } from '../../i18n';
import { applyDirection } from '../../lib/direction';
import { colors, fontFamily, fontSize, radius, spacing } from '../../theme';

function SectionTitle({ children }: { children: string }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

export default function SettingsScreen() {
  const { user, lang, setLang, signOut } = useAuth();
  const [switching, setSwitching] = useState(false);

  const changeLang = async (l: Lang) => {
    if (l === lang || switching) return;
    setSwitching(true);
    await setLang(l);
    applyDirection(l);
    // RTL flip requires a reload to take effect on native.
    if (Platform.OS === 'web') {
      window.location.reload();
    } else {
      try {
        await Updates.reloadAsync();
      } catch {
        setSwitching(false);
      }
    }
  };

  const confirmLogout = () => {
    Alert.alert(t(lang, 'settings.logout'), t(lang, 'settings.logoutConfirm'), [
      { text: t(lang, 'common.cancel'), style: 'cancel' },
      {
        text: t(lang, 'common.confirm'),
        style: 'destructive',
        onPress: async () => {
          await signOut();
          router.replace('/(auth)/login');
        },
      },
    ]);
  };

  const LangButton = ({ value, label }: { value: Lang; label: string }) => {
    const active = lang === value;
    return (
      <TouchableOpacity
        style={[styles.langBtn, active && styles.langBtnActive]}
        onPress={() => changeLang(value)}
        disabled={switching}
      >
        <Text style={[styles.langBtnText, active && styles.langBtnTextActive]}>{label}</Text>
        {active ? <MaterialIcons name="check" size={16} color="#fff" /> : null}
      </TouchableOpacity>
    );
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <SectionTitle>{t(lang, 'settings.language')}</SectionTitle>
      <View style={styles.langRow}>
        <LangButton value="ar" label={t(lang, 'settings.arabic')} />
        <LangButton value="en" label={t(lang, 'settings.english')} />
      </View>
      <Text style={styles.hint}>{t(lang, 'settings.langRestart')}</Text>

      <SectionTitle>{t(lang, 'settings.account')}</SectionTitle>
      <View style={styles.card}>
        <View style={styles.avatar}>
          <MaterialIcons name="person" size={28} color={colors.primary} />
        </View>
        <View style={styles.accountBody}>
          <Text style={styles.accountName}>{user?.name}</Text>
          <Text style={styles.accountEmail}>{user?.email}</Text>
          <Text style={styles.accountRole}>
            {t(lang, 'settings.role')}: {user ? t(lang, `role.${user.role}` as 'role.ADMIN') : ''}
          </Text>
        </View>
      </View>

      <TouchableOpacity style={styles.logoutBtn} onPress={confirmLogout} activeOpacity={0.8}>
        <MaterialIcons name="logout" size={18} color={colors.danger} />
        <Text style={styles.logoutText}>{t(lang, 'settings.logout')}</Text>
      </TouchableOpacity>

      <Text style={styles.version}>
        {t(lang, 'settings.version')} 1.0.0 · MedAssist
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.sm },
  sectionTitle: { fontFamily: fontFamily.bold, fontSize: fontSize.md, color: colors.navy, marginTop: spacing.md },
  langRow: { flexDirection: 'row', gap: spacing.sm },
  langBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: 12,
  },
  langBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  langBtnText: { fontFamily: fontFamily.medium, color: colors.text },
  langBtnTextActive: { color: '#fff' },
  hint: { fontSize: fontSize.xs, color: colors.textMuted, fontFamily: fontFamily.regular },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md,
  },
  avatar: {
    width: 52, height: 52, borderRadius: 26, backgroundColor: colors.primarySoft,
    alignItems: 'center', justifyContent: 'center',
  },
  accountBody: { flex: 1 },
  accountName: { fontFamily: fontFamily.bold, fontSize: fontSize.md, color: colors.text },
  accountEmail: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: colors.textMuted },
  accountRole: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.primary, marginTop: 2 },
  logoutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    borderWidth: 1, borderColor: colors.danger, borderRadius: radius.md, paddingVertical: 13, marginTop: spacing.md,
  },
  logoutText: { color: colors.danger, fontFamily: fontFamily.bold, fontSize: fontSize.md },
  version: { textAlign: 'center', color: colors.textMuted, fontSize: fontSize.xs, marginTop: spacing.lg, fontFamily: fontFamily.regular },
});
