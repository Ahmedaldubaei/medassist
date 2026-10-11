/**
 * Register screen.
 */
import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Link, router } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { api, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { t } from '../../i18n';
import { colors, fontFamily, fontSize, spacing } from '../../theme';
import { ErrorBanner, Field, PrimaryButton } from '../../components/ui';
import { GoogleSignInButton } from '../../components/GoogleSignInButton';

export default function RegisterScreen() {
  const { signIn, lang } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ name?: string; email?: string; password?: string }>({});
  const [apiError, setApiError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    const e: typeof errors = {};
    if (name.trim().length < 2) e.name = t(lang, 'auth.errName');
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) e.email = t(lang, 'auth.errEmail');
    if (password.length < 8) e.password = t(lang, 'auth.errPassword');
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    setLoading(true);
    setApiError('');
    try {
      await api.register({ name: name.trim(), email: email.trim(), password });
      // Backend returns the user only; sign in to obtain a token.
      const { token, user } = await api.login({ email: email.trim(), password });
      await signIn(token, user);
      router.replace('/(app)');
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) setApiError(t(lang, 'auth.errEmailInUse'));
      else if (err instanceof ApiError) setApiError(t(lang, 'auth.errRegister'));
      else setApiError(t(lang, 'auth.errNetwork'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.brand}>
          <View style={styles.logoWrap}>
            <MaterialIcons name="medical-services" size={36} color="#fff" />
          </View>
          <Text style={styles.brandName}>{t(lang, 'app.name')}</Text>
        </View>

        <Text style={styles.heading}>{t(lang, 'auth.createAccount')}</Text>
        <Text style={styles.sub}>{t(lang, 'auth.createSubtitle')}</Text>

        {apiError ? <ErrorBanner message={apiError} /> : null}

        <Field
          label={t(lang, 'auth.name')}
          placeholder={t(lang, 'auth.namePlaceholder')}
          value={name}
          onChangeText={(v) => { setName(v); setErrors((p) => ({ ...p, name: undefined })); }}
          error={errors.name}
        />
        <Field
          label={t(lang, 'auth.email')}
          placeholder={t(lang, 'auth.emailPlaceholder')}
          value={email}
          onChangeText={(v) => { setEmail(v); setErrors((p) => ({ ...p, email: undefined })); }}
          keyboardType="email-address"
          error={errors.email}
        />
        <Field
          label={t(lang, 'auth.password')}
          placeholder={t(lang, 'auth.passwordPlaceholder')}
          value={password}
          onChangeText={(v) => { setPassword(v); setErrors((p) => ({ ...p, password: undefined })); }}
          secureTextEntry
          error={errors.password}
        />

        <PrimaryButton title={t(lang, 'auth.registerButton')} onPress={submit} loading={loading} />
        <GoogleSignInButton />

        <View style={styles.switchRow}>
          <Text style={styles.switchText}>{t(lang, 'auth.haveAccount')} </Text>
          <Link href="/(auth)/login" asChild>
            <TouchableOpacity>
              <Text style={styles.switchLink}>{t(lang, 'auth.signInLink')}</Text>
            </TouchableOpacity>
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  scroll: { flexGrow: 1, padding: spacing.lg, justifyContent: 'center' },
  brand: { alignItems: 'center', marginBottom: spacing.lg },
  logoWrap: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm,
  },
  brandName: { fontSize: fontSize.lg, fontFamily: fontFamily.bold, color: colors.navy, textAlign: 'center' },
  heading: { fontSize: fontSize.xl, fontFamily: fontFamily.bold, color: colors.navy, marginBottom: 4 },
  sub: { fontSize: fontSize.sm, fontFamily: fontFamily.regular, color: colors.textMuted, marginBottom: spacing.lg },
  switchRow: { flexDirection: 'row', justifyContent: 'center', marginTop: spacing.lg },
  switchText: { color: colors.textMuted, fontFamily: fontFamily.regular },
  switchLink: { color: colors.primary, fontFamily: fontFamily.bold },
});
