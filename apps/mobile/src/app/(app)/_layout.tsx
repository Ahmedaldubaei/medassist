/**
 * Main app stack. Headers are styled here; screens set their own titles.
 */
import { Stack } from 'expo-router';
import { useAuth } from '../../auth/AuthContext';
import { t } from '../../i18n';
import { colors, fontFamily } from '../../theme';

export default function AppLayout() {
  const { lang } = useAuth();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.navy,
        headerTitleStyle: { fontFamily: fontFamily.bold },
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen name="index" options={{ title: t(lang, 'chat.title') }} />
      <Stack.Screen name="chat/[id]" options={{ title: t(lang, 'chat.newConversation') }} />
      <Stack.Screen name="settings" options={{ title: t(lang, 'settings.title') }} />
    </Stack>
  );
}
