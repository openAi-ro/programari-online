import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, router, usePathname, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as Updates from 'expo-updates';
import { useEffect, useMemo, useReducer, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import 'react-native-reanimated';
import type { Session } from '@supabase/supabase-js';
import { useColorScheme } from '@/components/useColorScheme';
import { buildTheme, palette } from '@/constants/theme';
import {
  attachNotificationResponseListener,
  configureNotificationPresentation,
  consumeLastNotificationResponse,
  registerForPushAsync,
} from '@/lib/notifications';
import { applyAvailableUpdateWithTimeout } from '@/lib/appVersion';
import { consumePendingAuthRedirect } from '@/lib/auth-redirect';
import { isAuthCallbackUrl, isAuthRedirectHeld } from '@/lib/auth';
import { stashAuthCallbackUrl } from '@/lib/auth-link';
import { getThemePreference } from '@/lib/themePreference';
import { LanguageProvider, trKey } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';
import { getLanguage, subscribeLanguage } from '@/lib/language';
import * as Linking from 'expo-linking';

export { ErrorBoundary } from 'expo-router';

export const unstable_settings = {
  initialRouteName: 'index',
};

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });
  const [updatesReady, setUpdatesReady] = useState(__DEV__);
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const { isUpdatePending } = Updates.useUpdates();
  const [, forceRender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => subscribeLanguage(() => forceRender()), []);

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    void getThemePreference();
    void getLanguage();
  }, []);

  useEffect(() => {
    if (isUpdatePending) {
      void Updates.reloadAsync();
    }
  }, [isUpdatePending]);

  useEffect(() => {
    if (!loaded) return;
    let cancelled = false;
    (async () => {
      await SplashScreen.hideAsync();
      await applyAvailableUpdateWithTimeout();
      if (!cancelled) {
        setUpdatesReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  if (!updatesReady) {
    const t = buildTheme(scheme);
    return (
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: t.colors.bg,
          gap: 12,
          paddingHorizontal: 32,
        }}
      >
        <ActivityIndicator size="large" color={palette.accent500} />
        <Text
          style={{
            color: t.colors.text,
            fontSize: 16,
            fontWeight: '700',
            textAlign: 'center',
          }}
        >
          {trKey('root.downloadingTitle')}
        </Text>
        <Text
          style={{
            color: t.colors.textMuted,
            fontSize: 13,
            textAlign: 'center',
          }}
        >
          {trKey('root.downloadingBody')}
        </Text>
      </View>
    );
  }

  return (
    <LanguageProvider>
      <RootLayoutNav />
    </LanguageProvider>
  );
}

function useSessionGuard() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const segments = useSegments();
  const pathname = usePathname();

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
    const inAuthCallback =
      segments[0] === 'auth' && segments[1] === 'callback';
    const onResetPassword =
      inAuthGroup && segments[1] === 'reset-password';
    const path = pathname || '';
    const inPublicBook = segments[0] === 'b' || path.startsWith('/b/');
    const inPublicInstall =
      (segments[0] as string) === 'install' || path.startsWith('/install');
    const inDevNavBench =
      __DEV__ &&
      ((segments[0] as string) === 'dev-nav-bench' || path.startsWith('/dev-nav-bench'));
    const inAuthCallbackPath = inAuthCallback || path.startsWith('/auth/callback');

    if (
      !session &&
      !inAuthGroup &&
      !inAuthCallbackPath &&
      !inPublicBook &&
      !inPublicInstall &&
      !inDevNavBench
    ) {
      router.replace('/(auth)/login');
    } else if (
      session &&
      inAuthGroup &&
      !onResetPassword &&
      !isAuthRedirectHeld()
    ) {
      const next = consumePendingAuthRedirect();
      router.replace((next || '/(app)/home') as never);
    }
  }, [session, segments, pathname]);

  useEffect(() => {
    const sub = Linking.addEventListener('url', ({ url }) => {
      if (isAuthCallbackUrl(url)) {
        stashAuthCallbackUrl(url);
        router.push('/auth/callback' as never);
      }
    });
    return () => sub.remove();
  }, []);

  return session;
}

function usePushNavigation(session: Session | null | undefined) {
  // Canalul Android `cereri_heads` (Pop on screen) trebuie să existe ÎNAINTE
  // să vină primul push remote — altfel Android ignoră notificarea.
  useEffect(() => {
    configureNotificationPresentation().catch(() => {});
  }, []);

  useEffect(() => {
    if (!session?.user?.id) return;
    void registerForPushAsync(session.user.id).catch((e) => {
      console.warn('Push register on session failed', e);
    });
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
        <Stack.Screen name="install" />
      </Stack>
    </ThemeProvider>
  );
}
