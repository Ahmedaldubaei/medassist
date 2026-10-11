/**
 * Email verification landing: /verify?token=...
 * Calls the backend once, shows Arabic success/failure, links back to login.
 */
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Link, useLocalSearchParams } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { t } from '../../i18n';
import { colors, fontFamily, fontSize, radius, spacing } from '../../theme';
import { LoadingView } from '../../components/ui';

type State = 'loading' | 'ok' | 'fail';

export default function VerifyScreen() {
  const { token } = useLocalSearchParams<{ token?: string | string[] }>();
  const { lang } = useAuth();
  const raw = Array.isArray(token) ? token[0] : token;
  const [state, setState] = useState<State>(raw ? 'loading' : 'fail');

  useEffect(() => {
    if (!raw) return;
    let alive = true;
    api
      .verifyEmail(raw)
      .then(() => {
        if (alive) setState('ok');
      })
      .catch(() => {
        if (alive) setState('fail');
      });
    return () => {
      alive = false;
    };
  }, [raw]);

  if (state === 'loading') return <LoadingView label={t(lang, 'common.loading')} />;

  const ok = state === 'ok';
  return (
    <View style={styles.root}>
      <View style={[styles.iconWrap, ok ? styles.iconOk : styles.iconFail]}>
        <MaterialIcons
          name={ok ? 'check-circle' : 'error-outline'}
          size={48}
          color={ok ? colors.success : colors.danger}
        />
      </View>
      <Text style={styles.title}>{t(lang, 'verify.title')}</Text>
      <Text style={styles.message}>{t(lang, ok ? 'verify.success' : 'verify.failed')}</Text>
      <Link href="/(auth)/login" asChild>
        <TouchableOpacity style={styles.button} activeOpacity={0.85}>
          <Text style={styles.buttonText}>{t(lang, 'verify.backToLogin')}</Text>
        </TouchableOpacity>
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  iconWrap: { marginBottom: spacing.lg },
  iconOk: {},
  iconFail: {},
  title: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.xl,
    color: colors.navy,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  message: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.md,
    color: colors.textMuted,
    marginBottom: spacing.xl,
    textAlign: 'center',
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: 14,
    paddingHorizontal: spacing.xl,
  },
  buttonText: { color: '#fff', fontFamily: fontFamily.bold, fontSize: fontSize.md },
});
