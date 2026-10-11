/**
 * Reset password landing: /reset?token=... → new-password form → login.
 * The token is single-use with a 1h expiry (enforced server-side).
 */
import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Link, useLocalSearchParams } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { t } from '../../i18n';
import { colors, fontFamily, fontSize, spacing } from '../../theme';
import { ErrorBanner, Field, PrimaryButton } from '../../components/ui';

export default function ResetPasswordScreen() {
  const { token } = useLocalSearchParams<{ token?: string | string[] }>();
  const { lang } = useAuth();
  const raw = Array.isArray(token) ? token[0] : token;
  const [password, setPassword] = useState('');
  const [error, setError] = useState(!raw ? t(lang, 'auth.errReset') : '');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async () => {
    if (!raw) return;
    if (password.length < 8) {
      setError(t(lang, 'auth.errPassword'));
      return;
    }
    setLoading(true);
    setError('');
    try {
      await api.resetPassword(raw, password);
      setDone(true);
    } catch {
      setError(t(lang, 'auth.errReset'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{t(lang, 'auth.resetTitle')}</Text>
        {error ? <ErrorBanner message={error} /> : null}
        {done ? (
          <View style={styles.doneWrap}>
            <MaterialIcons name="check-circle" size={48} color={colors.success} />
            <Text style={styles.done}>{t(lang, 'auth.resetSuccess')}</Text>
            <Link href="/(auth)/login" asChild>
              <TouchableOpacity style={styles.button} activeOpacity={0.85}>
                <Text style={styles.buttonText}>{t(lang, 'auth.signInLink')}</Text>
              </TouchableOpacity>
            </Link>
          </View>
        ) : (
          <>
            <Field
              label={t(lang, 'auth.newPassword')}
              placeholder={t(lang, 'auth.newPasswordPlaceholder')}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />
            <PrimaryButton
              title={t(lang, 'auth.resetButton')}
              onPress={submit}
              loading={loading}
            />
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  scroll: {
    padding: spacing.lg,
    gap: spacing.md,
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'stretch',
  },
  title: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.xl,
    color: colors.navy,
    textAlign: 'center',
  },
  doneWrap: { alignItems: 'center', gap: spacing.md },
  done: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.md,
    color: colors.text,
    textAlign: 'center',
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 999,
    paddingVertical: 14,
    paddingHorizontal: spacing.xl,
    marginTop: spacing.sm,
  },
  buttonText: { color: '#fff', fontFamily: fontFamily.bold, fontSize: fontSize.md },
});
