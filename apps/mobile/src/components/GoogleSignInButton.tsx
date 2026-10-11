/**
 * "Continue with Google" button.
 * Uses expo-auth-session's Google ID-token flow: on success the ID token is
 * POSTed to /api/v1/auth/google, and the returned JWT is stored exactly like
 * the email login flow. On web the redirect is the current origin (registered
 * in the Google OAuth client); on native it uses the app scheme — platform
 * OAuth clients (androidClientId/iosClientId) can be supplied later via env.
 */
import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';
import * as Google from 'expo-auth-session/providers/google';
import { MaterialIcons } from '@expo/vector-icons';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { t } from '../i18n';
import { colors, fontFamily, fontSize, radius, spacing } from '../theme';
import { ErrorBanner } from './ui';

const GOOGLE_CLIENT_ID =
  process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ??
  '1087373322481-d78c5rso191hd4hlcis95v7cuqgnd194.apps.googleusercontent.com';

export function GoogleSignInButton() {
  const { signIn, lang } = useAuth();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [request, , promptAsync] = Google.useIdTokenAuthRequest(
    {
      clientId: GOOGLE_CLIENT_ID,
      androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
      iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    },
    { scheme: 'medassist' },
  );

  const onPress = async () => {
    if (!request || busy) return;
    setError('');
    setBusy(true);
    try {
      const res = await promptAsync();
      if (res.type !== 'success') {
        setError(t(lang, 'auth.errGoogle'));
        return;
      }
      const idToken = res.params.id_token as string | undefined;
      if (!idToken) {
        setError(t(lang, 'auth.errGoogle'));
        return;
      }
      const { token, user } = await api.googleLogin({ idToken });
      await signIn(token, user);
      router.replace('/(app)');
    } catch {
      setError(t(lang, 'auth.errGoogle'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View>
      {error ? <ErrorBanner message={error} /> : null}
      <TouchableOpacity
        style={[styles.button, (!request || busy) && styles.buttonDisabled]}
        onPress={onPress}
        disabled={!request || busy}
        activeOpacity={0.85}
      >
        {busy ? (
          <ActivityIndicator color={colors.navy} />
        ) : (
          <>
            <MaterialIcons name="account-circle" size={20} color={colors.navy} />
            <Text style={styles.buttonText}>{t(lang, 'auth.googleButton')}</Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingVertical: 14,
    marginTop: spacing.md,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: colors.navy, fontFamily: fontFamily.bold, fontSize: fontSize.md },
});
