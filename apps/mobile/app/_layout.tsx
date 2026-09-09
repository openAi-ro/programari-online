import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import 'react-native-reanimated';
import type { Session } from '@supabase/supabase-js';
import { router, useSegments } from 'expo-router';

import { useColorScheme } from '@/components/useColorScheme';
import { buildTheme, palette } from '@/constants/theme';
import {
  attachNotificationResponseListener,
  consumeLastNotificationResponse,
} from '@/lib/notifications';
import { supabase } from '@/lib/supabase';

export { ErrorBoundary } from 'expo-router';

export const unstable_settings = {
  initialRouteName: 'index',
};

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return <RootLayoutNav />;
}

function useSessionGuard() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const segments = useSegments();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session === undefined) return;

    const inAuthGroup = segments[0] === '(auth)';
    // Allow Supabase email redirect page without forcing login
    const inAuthCallback =
      segments[0] === 'auth' && segments[1] === 'callback';
    // Recovery session must stay on reset-password (do not bounce to home)
    const onResetPassword =
      inAuthGroup && segments[1] === 'reset-password';

    if (!session && !inAuthGroup && !inAuthCallback) {
      router.replace('/(auth)/login');
    } else if (session && inAuthGroup && !onResetPassword) {
      router.replace('/(app)/home');
    }
  }, [session, segments]);

  return session;
}

function usePushNavigation(session: Session | null | undefined) {
  useEffect(() => {
    if (!session) return;
    const detach = attachNotificationResponseListener();
    // Cold start: delay slightly so navigation stack is ready
    const t = setTimeout(() => {
      consumeLastNotificationResponse().catch(() => {});
    }, 400);
    return () => {
      clearTimeout(t);
      detach();
    };
  }, [session]);
}

function RootLayoutNav() {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const session = useSessionGuard();
  usePushNavigation(session);

  // Fiecare ecran isi deseneaza singur suprafata; tema de mai jos aliniaza
  // doar chrome-ul nativ (bara de stare, fundalul navigatorului, tranzitiile).
  const theme = useMemo(() => {
    const t = buildTheme(scheme);
    const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
    return {
      ...base,
      dark: scheme === 'dark',
      colors: {
        ...base.colors,
        primary: t.colors.accent,
        background: t.colors.bg,
        card: t.colors.bgElevated,
        text: t.colors.text,
        border: t.colors.border,
        notification: t.colors.accent,
      },
    };
  }, [scheme]);

  if (session === undefined) {
    const t = buildTheme(scheme);
    return (
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: t.colors.bg,
        }}
      >
        <ActivityIndicator size="large" color={palette.accent500} />
      </View>
    );
  }

  return (
    <ThemeProvider value={theme}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.colors.background },
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(app)" />
        <Stack.Screen name="auth/callback" />
        <Stack.Screen name="b/[publicCode]" />
      </Stack>
    </ThemeProvider>
  );
}
