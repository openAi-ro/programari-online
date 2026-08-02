import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import 'react-native-reanimated';
import type { Session } from '@supabase/supabase-js';
import { router, useSegments } from 'expo-router';

import { useColorScheme } from '@/components/useColorScheme';
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

    if (!session && !inAuthGroup && !inAuthCallback) {
      router.replace('/(auth)/login');
    } else if (session && inAuthGroup) {
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
  const colorScheme = useColorScheme();
  const session = useSessionGuard();
  usePushNavigation(session);

  if (session === undefined) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(app)" options={{ headerShown: false }} />
        <Stack.Screen name="auth/callback" options={{ headerShown: false, title: 'Confirmare' }} />
        <Stack.Screen name="b/[publicCode]" options={{ headerShown: false }} />
        <Stack.Screen name="+not-found" />
      </Stack>
    </ThemeProvider>
  );
}
