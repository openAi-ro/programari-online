import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { router } from 'expo-router';
import * as Linking from 'expo-linking';

import { Button, Callout, LoadingScreen, Screen } from '@/components/ui';
import { persistAccountKind, parseAccountKind } from '@/lib/accountKind';
import {
  completeAuthFromUrl,
  getNativeAuthCallbackUrl,
  isAuthCallbackUrl,
  mapAuthError,
} from '@/lib/auth';
import { takeAuthCallbackUrl } from '@/lib/auth-link';
import { supabase } from '@/lib/supabase';

/**
 * Handles magic-link / email activation redirect from Supabase.
 * Emails always point at the public https URL, then we hand off to the app.
 */
export default function AuthCallbackScreen() {
  const [status, setStatus] = useState('Se activează contul…');
  const [error, setError] = useState<string | null>(null);
  const [activated, setActivated] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const url = takeAuthCallbackUrl() || (await Linking.getInitialURL());
        const href =
          typeof window !== 'undefined'
            ? `${window.location.origin}${window.location.pathname}${window.location.search}${window.location.hash}`
            : url;

        const toParse = href && isAuthCallbackUrl(href) ? href : url;
        const result = toParse
          ? await completeAuthFromUrl(toParse)
          : {
              session: (await supabase.auth.getSession()).data.session,
              recovery: false,
              error: null,
            };

        if (cancelled) return;

        if (result.error && !result.session) {
          setError(mapAuthError({ message: result.error } as Error) ?? result.error);
          setStatus('Nu am putut activa contul din acest link.');
          return;
        }

        if (result.session) {
          const kind = parseAccountKind(
            result.session.user.user_metadata?.account_kind as string | undefined
          );
          await persistAccountKind(kind);
          if (result.recovery) {
            setStatus('Link de resetare confirmat. Redirecționare…');
            router.replace('/(auth)/reset-password');
            return;
          }

          if (Platform.OS === 'web') {
            const nativeUrl = getNativeAuthCallbackUrl(toParse);
            void Linking.openURL(nativeUrl).catch(() => undefined);
            setActivated(true);
            setStatus('Cont activat.');
            return;
          }

          setStatus('Cont activat. Redirecționare…');
          router.replace('/(app)/home');
          return;
        }

        setStatus('Nu s-a putut deschide sesiunea din link.');
        setError('Deschide din nou linkul din cel mai recent email, sau revino la login.');
      } catch (e) {
        if (!cancelled) {
          setStatus('Eroare la activare.');
          setError(e instanceof Error ? e.message : 'Eroare necunoscută.');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <Screen title="Activare cont">
        <Callout tone="danger" title={status}>
          {error}
        </Callout>
        <Button
          label="Înapoi la login"
          onPress={() => router.replace('/(auth)/login')}
          icon="log-in-outline"
        />
      </Screen>
    );
  }

  if (activated) {
    return (
      <Screen title="Activare cont">
        <Callout tone="success" title={status}>
          Contul e activ. Dacă aplicația nu s-a deschis automat, deschide-o pe telefon și apasă
          „Intră în cont” cu aceeași adresă și parolă.
        </Callout>
        <Button
          label="Deschide aplicația"
          icon="phone-portrait-outline"
          onPress={() => {
            const href =
              typeof window !== 'undefined'
                ? `${window.location.pathname}${window.location.search}${window.location.hash}`
                : '';
            void Linking.openURL(getNativeAuthCallbackUrl(href));
          }}
        />
        <Button
          label="Continuă pe web"
          variant="ghost"
          icon="globe-outline"
          onPress={() => router.replace('/(app)/home')}
        />
      </Screen>
    );
  }

  return <LoadingScreen label={status} />;
}
