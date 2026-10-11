/**
 * Root layout: font loading, RTL direction, auth provider, auth gate.
 */
import React, { useEffect, useState } from 'react';
import { I18nManager } from 'react-native';
import { Stack, router, useSegments } from 'expo-router';
import { useFonts } from 'expo-font';
import {
  IBMPlexSansArabic_400Regular,
  IBMPlexSansArabic_500Medium,
  IBMPlexSansArabic_700Bold,
} from '@expo-google-fonts/ibm-plex-sans-arabic';
import { AuthProvider, useAuth } from '../auth/AuthContext';
import { langStore } from '../api/client';
import { applyDirection } from '../lib/direction';
import { LoadingView } from '../components/ui';
import { t } from '../i18n';

function AuthRedirect() {
  const { token, ready } = useAuth();
  const segments = useSegments();

  useEffect(() => {
    if (!ready) return;
    const inAuth = segments[0] === '(auth)';
    if (!token && !inAuth) router.replace('/(auth)/login');
    else if (token && inAuth) router.replace('/(app)');
  }, [token, ready, segments]);

  return null;
}

function Gate() {
  const { ready, lang } = useAuth();
  if (!ready) return <LoadingView label={t(lang, 'common.loading')} />;
  return (
    <>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(app)" />
      </Stack>
      <AuthRedirect />
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    IBMPlexSansArabic_400Regular,
    IBMPlexSansArabic_500Medium,
    IBMPlexSansArabic_700Bold,
  });
  const [dirReady, setDirReady] = useState(false);

  useEffect(() => {
    (async () => {
      const stored = await langStore.get();
      applyDirection(stored === 'en' ? 'en' : 'ar');
      // Ensure native RTL flag consistency before first render.
      void I18nManager.isRTL;
      setDirReady(true);
    })();
  }, []);

  if ((!fontsLoaded && !fontError) || !dirReady) return null;

  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
