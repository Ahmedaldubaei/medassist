/**
 * Forgot password: email input → reset link sent confirmation.
 * The backend always returns 200 for unknown emails (no user enumeration).
 */
import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { t } from '../../i18n';
import { colors, fontFamily, fontSize, spacing } from '../../theme';
import { ErrorBanner, Field, PrimaryButton } from '../../components/ui';

export default function ForgotPasswordScreen() {
  const { lang } = useAuth();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async () => {
    const valid = /.+@.+\..+/.test(email.trim());
    if (!valid) {
      setError(t(lang, 'auth.errEmail'));
      return;
    }
    setLoading(true);
    setError('');
    try {
      await api.forgotPassword(email.trim());
      setSent(true);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'GOOGLE_ONLY') {
        setError(err.message);
      } else {
        setError(t(lang, 'auth.errResetLink'));
      }
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
        <Text style={styles.title}>{t(lang, 'auth.forgotTitle')}</Text>
        <Text style={styles.hint}>{t(lang, 'auth.forgotHint')}</Text>
        {error ? <ErrorBanner message={error} /> : null}
        {sent ? (
          <View style={styles.sentWrap}>
            <Text style={styles.sent}>{t(lang, 'auth.resetLinkSent')}</Text>
          </View>
        ) : (
          <>
            <Field
              label={t(lang, 'auth.email')}
              placeholder={t(lang, 'auth.emailPlaceholder')}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />
            <PrimaryButton
              title={t(lang, 'auth.sendResetLink')}
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
  scroll: { padding: spacing.lg, gap: spacing.md, flexGrow: 1, justifyContent: 'center' },
  title: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.xl,
    color: colors.navy,
    textAlign: 'center',
  },
  hint: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.md,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  sentWrap: {
    backgroundColor: colors.successSoft,
    borderRadius: 12,
    padding: spacing.lg,
  },
  sent: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.md,
    color: colors.success,
    textAlign: 'center',
  },
});
