/**
 * Settings: language switch, account info, edit profile, sign out,
 * delete account (double-confirmed).
 */
import React, { useState } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';
import * as Updates from 'expo-updates';
import { MaterialIcons } from '@expo/vector-icons';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { t, type Lang } from '../../i18n';
import { applyDirection } from '../../lib/direction';
import { colors, fontFamily, fontSize, radius, spacing } from '../../theme';

function SectionTitle({ children }: { children: string }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

function LangButton({
  value,
  label,
  active,
  disabled,
  onPress,
}: {
  value: Lang;
  label: string;
  active: boolean;
  disabled: boolean;
  onPress: (v: Lang) => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.langBtn, active && styles.langBtnActive]}
      onPress={() => onPress(value)}
      disabled={disabled}
    >
      <Text style={[styles.langBtnText, active && styles.langBtnTextActive]}>{label}</Text>
      {active ? <MaterialIcons name="check" size={16} color="#fff" /> : null}
    </TouchableOpacity>
  );
}

export default function SettingsScreen() {
  const { user, token, lang, setLang, signOut, refreshUser } = useAuth();
  const [switching, setSwitching] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user?.name ?? '');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const changeLang = async (l: Lang) => {
    if (l === lang || switching) return;
    setSwitching(true);
    await setLang(l);
    applyDirection(l);
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

  const saveProfile = async () => {
    if (!token || saving) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      await api.updateMe(token, { name: trimmed });
      await refreshUser();
      setEditing(false);
      Alert.alert(t(lang, 'settings.saved'));
    } catch {
      Alert.alert(t(lang, 'settings.saveFailed'));
    } finally {
      setSaving(false);
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

  const confirmDelete = () => {
    Alert.alert(t(lang, 'settings.deleteTitle'), t(lang, 'settings.deleteMessage'), [
      { text: t(lang, 'common.cancel'), style: 'cancel' },
      {
        text: t(lang, 'common.confirm'),
        style: 'destructive',
        onPress: () =>
          Alert.alert(t(lang, 'settings.deleteConfirm2Title'), t(lang, 'settings.deleteConfirm2Message'), [
            { text: t(lang, 'common.cancel'), style: 'cancel' },
            {
              text: t(lang, 'settings.deleteAccount'),
              style: 'destructive',
              onPress: async () => {
                if (!token || deleting) return;
                setDeleting(true);
                try {
                  await api.deleteMe(token);
                  await signOut();
                  router.replace('/(auth)/login');
                } catch {
                  Alert.alert(t(lang, 'settings.deleteFailed'));
                } finally {
                  setDeleting(false);
                }
              },
            },
          ]),
      },
    ]);
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <SectionTitle>{t(lang, 'settings.language')}</SectionTitle>
      <View style={styles.langRow}>
        <LangButton value="ar" label={t(lang, 'settings.arabic')} active={lang === 'ar'} disabled={switching} onPress={changeLang} />
        <LangButton value="en" label={t(lang, 'settings.english')} active={lang === 'en'} disabled={switching} onPress={changeLang} />
      </View>
      <Text style={styles.hint}>{t(lang, 'settings.langRestart')}</Text>

      <SectionTitle>{t(lang, 'settings.account')}</SectionTitle>
      <View style={styles.card}>
        <View style={styles.avatar}>
          <MaterialIcons name="person" size={28} color={colors.primary} />
        </View>
        <View style={styles.accountBody}>
          {editing ? (
            <TextInput
              style={[styles.nameInput, { textAlign: lang === 'ar' ? 'right' : 'left' }]}
              value={name}
              onChangeText={setName}
              maxLength={100}
              autoFocus
            />
          ) : (
            <Text style={styles.accountName}>{user?.name}</Text>
          )}
          <Text style={styles.accountEmail}>{user?.email}</Text>
          <Text style={styles.accountRole}>
            {t(lang, 'settings.role')}: {user ? t(lang, `role.${user.role}` as 'role.ADMIN') : ''}
          </Text>
        </View>
        {editing ? (
          <View style={styles.editRow}>
            <TouchableOpacity
              style={[styles.saveBtn, saving && styles.disabled]}
              onPress={saveProfile}
              disabled={saving}
            >
              <Text style={styles.saveText}>{t(lang, 'settings.save')}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { setEditing(false); setName(user?.name ?? ''); }} hitSlop={8}>
              <MaterialIcons name="close" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            onPress={() => { setName(user?.name ?? ''); setEditing(true); }}
            hitSlop={10}
            accessibilityLabel={t(lang, 'settings.editProfile')}
          >
            <MaterialIcons name="edit" size={20} color={colors.primary} />
          </TouchableOpacity>
        )}
      </View>

      <TouchableOpacity style={styles.logoutBtn} onPress={confirmLogout} activeOpacity={0.8}>
        <MaterialIcons name="logout" size={18} color={colors.danger} />
        <Text style={styles.logoutText}>{t(lang, 'settings.logout')}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.deleteBtn, deleting && styles.disabled]}
        onPress={confirmDelete}
        disabled={deleting}
        activeOpacity={0.8}
      >
        <MaterialIcons name="delete-forever" size={18} color="#fff" />
        <Text style={styles.deleteText}>{t(lang, 'settings.deleteAccount')}</Text>
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
  nameInput: {
    fontFamily: fontFamily.bold, fontSize: fontSize.md, color: colors.text,
    borderBottomWidth: 1, borderBottomColor: colors.primary, paddingVertical: 4,
  },
  accountEmail: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: colors.textMuted },
  accountRole: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.primary, marginTop: 2 },
  editRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  saveBtn: { backgroundColor: colors.primary, borderRadius: radius.pill, paddingVertical: 8, paddingHorizontal: 16 },
  saveText: { color: '#fff', fontFamily: fontFamily.bold, fontSize: fontSize.sm },
  disabled: { opacity: 0.5 },
  logoutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    borderWidth: 1, borderColor: colors.danger, borderRadius: radius.md, paddingVertical: 13, marginTop: spacing.md,
  },
  logoutText: { color: colors.danger, fontFamily: fontFamily.bold, fontSize: fontSize.md },
  deleteBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    backgroundColor: colors.danger, borderRadius: radius.md, paddingVertical: 13, marginTop: spacing.sm,
  },
  deleteText: { color: '#fff', fontFamily: fontFamily.bold, fontSize: fontSize.md },
  version: { textAlign: 'center', color: colors.textMuted, fontSize: fontSize.xs, marginTop: spacing.lg, fontFamily: fontFamily.regular },
});
