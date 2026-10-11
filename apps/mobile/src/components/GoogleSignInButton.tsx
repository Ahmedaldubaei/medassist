/**
 * "Continue with Google" button.
 * Uses expo-auth-session's Google ID-token flow: on success the ID token is
 * POSTed to /api/v1/auth/google, and the returned JWT is stored exactly like
 * the email login flow.
 *
 * Web quirk (this bit us): on web the auth response arrives via page redirect,
 * NOT via the awaited promptAsync() promise — so we must call
 * WebBrowser.maybeCompleteAuthSession() and react to the hook's `response`
 * state. The web redirect URI is pinned to window.location.origin, which
 * matches the Authorized redirect URI registered in the Google OAuth client.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';
import { MaterialIcons } from '@expo/vector-icons';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { t } from '../i18n';
import { colors, fontFamily, fontSize, radius, spacing } from '../theme';
import { ErrorBanner } from './ui';

WebBrowser.maybeCompleteAuthSession();

const GOOGLE_CLIENT_ID =
  process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ??
  '1087373322481-d78c5rso191hd4hlcis95v7cuqgnd194.apps.googleusercontent.com';

// On web the redirect must exactly match the URI registered in Google Cloud.
const REDIRECT_URI =
  Platform.OS === 'web' && typeof window !== 'undefined'
    ? window.location.origin
    : undefined;

export function GoogleSignInButton() {
  const { signIn, lang } = useAuth();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    clientId: GOOGLE_CLIENT_ID,
    redirectUri: REDIRECT_URI,
    androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
  });

  const completeSignIn = useCallback(
    async (idToken: string) => {
      try {
        const { token, user } = await api.googleLogin({ idToken });
        await signIn(token, user);
        router.replace('/(app)');
      } catch (err) {
        setError(t(lang, err instanceof ApiError ? 'auth.errGoogle' : 'auth.errNetwork'));
      } finally {
        setBusy(false);
      }
    },
    [lang, signIn],
  );

  /* eslint-disable react-hooks/set-state-in-effect -- response-driven auth completion, not a render loop */
  useEffect(() => {
    if (!response) return;
    if (response.type === 'success') {
      const idToken = response.params.id_token as string | undefined;
      if (idToken) {
        void completeSignIn(idToken);
      } else {
        setError(t(lang, 'auth.errGoogle'));
        setBusy(false);
      }
    } else {
      // dismissed or error — let the user try again
      setBusy(false);
      if (response.type === 'error') setError(t(lang, 'auth.errGoogle'));
    }
  }, [response, completeSignIn, lang]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const onPress = () => {
    if (!request || busy) return;
    setError('');
    setBusy(true);
    // Do NOT await on web — the result arrives via `response` after redirect.
    void promptAsync();
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
