import { Ionicons } from '@expo/vector-icons';
import { useFonts } from 'expo-font';
import {
  DarkTheme,
  DefaultTheme,
  ErrorBoundary as RouterErrorBoundary,
  type ErrorBoundaryProps,
  Stack,
  ThemeProvider,
  router,
  usePathname,
  useSegments,
} from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as Updates from 'expo-updates';
import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import 'react-native-reanimated';
import type { Session } from '@supabase/supabase-js';
import { useColorScheme } from '@/components/useColorScheme';
import { BootLoading } from '@/components/BootLoading';
import { DialogHost } from '@/components/DialogHost';
import { buildTheme } from '@/constants/theme';
import {
  attachNotificationResponseListener,
  configureNotificationPresentation,
  consumeLastNotificationResponse,
  registerForPushAsync,
} from '@/lib/notifications';
import { applyAvailableUpdateWithTimeout, reloadWithBootScreen } from '@/lib/appVersion';
import { WEB_BOOT_SPLASH_ID } from '@/constants/bootLogo';
import { consumePendingAuthRedirect } from '@/lib/auth-redirect';
import { isAuthCallbackUrl, isAuthRedirectHeld } from '@/lib/auth';
import { stashAuthCallbackUrl } from '@/lib/auth-link';
import { getThemePreference } from '@/lib/themePreference';
import { LanguageProvider, trKey } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';
import { linkMyBusinessClients } from '@/lib/businessBooking';
import { getLanguage, subscribeLanguage } from '@/lib/language';
import { syncLanguageFromProfile } from '@/lib/profileLanguage';
import * as Linking from 'expo-linking';

/** Eroarea de pornire trebuie să fie vizibilă: scoatem loaderul de pornire (HTML pe web, splash nativ). */
export function ErrorBoundary(props: ErrorBoundaryProps) {
  useEffect(() => {
    if (Platform.OS === 'web') {
      document.getElementById(WEB_BOOT_SPLASH_ID)?.remove();
    } else {
      hideNativeSplash();
    }
  }, []);
  return <RouterErrorBoundary {...props} />;
}

export const unstable_settings = {
  initialRouteName: 'index',
};

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    ...Ionicons.font,
  });
  const [updatesReady, setUpdatesReady] = useState(__DEV__);
  const [bootDone, setBootDone] = useState(false);
  const finishBoot = useCallback(() => setBootDone(true), []);
  const { isUpdatePending, isDownloading } = Updates.useUpdates();
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
      void reloadWithBootScreen();
    }
  }, [isUpdatePending]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await applyAvailableUpdateWithTimeout();
      if (!cancelled) {
        setUpdatesReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Plasă de siguranță: dacă iconița loaderului nu raportează încărcarea, splash-ul nativ nu rămâne blocat.
  useEffect(() => {
    const t = setTimeout(hideNativeSplash, 2000);
    return () => clearTimeout(t);
  }, []);

  // Web: loaderul din HTML (+html.tsx) stă de la primul afișaj; îl scoatem o singură dată, când aplicația e gata.
  useEffect(() => {
    if (!bootDone) return;
    if (Platform.OS === 'web') {
      document.getElementById(WEB_BOOT_SPLASH_ID)?.remove();
    } else {
      hideNativeSplash();
    }
  }, [bootDone]);

  const app =
    loaded && updatesReady ? (
      <LanguageProvider>
        <RootLayoutNav onBootDone={finishBoot} />
      </LanguageProvider>
    ) : null;

  if (Platform.OS === 'web') {
    return app;
  }

  // Un singur loader de pornire, montat o dată, peste aplicație: preia logo-ul splash-ului nativ
  // (care se ascunde abia după ce iconița loaderului e desenată) și rămâne până la primul ecran.
  return (
    <View style={styles.root}>
      {app}
      {bootDone ? null : (
        <BootLoading
          label={isDownloading ? trKey('root.downloadingTitle') : undefined}
          sublabel={isDownloading ? trKey('root.downloadingBody') : undefined}
          onLogoLoadEnd={hideNativeSplash}
        />
      )}
    </View>
  );
}

function hideNativeSplash() {
  void SplashScreen.hideAsync();
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});

function useSessionGuard() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const segments = useSegments();
  const pathname = usePathname();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session) linkMyBusinessClients();
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      if (next && (event === 'SIGNED_IN' || event === 'USER_UPDATED')) linkMyBusinessClients();
      if (next && event === 'SIGNED_IN') void syncLanguageFromProfile(next.user.id);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session === undefined) return;

    const inAuthGroup = segments[0] === '(auth)';
    const inAuthCallback =
      segments[0] === 'auth' && (segments as string[])[1] === 'callback';
    const onResetPassword =
      inAuthGroup && (segments as string[])[1] === 'reset-password';
    const path = pathname || '';
    const inPublicBook = segments[0] === 'b' || path.startsWith('/b/');
    const inPublicInstall =
      (segments[0] as string) === 'install' || path.startsWith('/install');
    const inPublicGcal =
      (segments[0] as string) === 'gcal-connected' || path.startsWith('/gcal-connected');
    const inDevNavBench =
      __DEV__ &&
      ((segments[0] as string) === 'dev-nav-bench' || path.startsWith('/dev-nav-bench'));
    const inAuthCallbackPath = inAuthCallback || path.startsWith('/auth/callback');
    // Linkul de invitație ține minte tokenul și trimite singur la login (app/invitatie.tsx).
    const inInvite = (segments[0] as string) === 'invitatie' || path.startsWith('/invitatie');
    // Ruta inexistentă ajunge pe ecranul +not-found; garda nu o trimite la login (audit C-09).
    const inNotFound = segments[0] === '+not-found' || path === '/+not-found';

    if (
      !session &&
      !inNotFound &&
      !inAuthGroup &&
      !inAuthCallbackPath &&
      !inPublicBook &&
      !inPublicInstall &&
      !inPublicGcal &&
      !inInvite &&
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

function RootLayoutNav({ onBootDone }: { onBootDone: () => void }) {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const session = useSessionGuard();
  const pathname = usePathname();
  usePushNavigation(session);

  // Pornirea s-a terminat când știm sesiunea și am plecat de pe „/” (care doar redirecționează).
  useEffect(() => {
    if (session !== undefined && pathname && pathname !== '/') onBootDone();
  }, [session, pathname, onBootDone]);

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
    return null;
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
      <Stack.Screen name="gcal-connected" />
        <Stack.Screen name="invitatie" />
      </Stack>
      <DialogHost />
    </ThemeProvider>
  );
}
