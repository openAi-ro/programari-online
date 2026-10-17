import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { router } from 'expo-router';
import * as Linking from 'expo-linking';

import { Button, Callout, LoadingScreen, Screen } from '@/components/ui';
import { persistAccountKind, parseAccountKind } from '@/lib/accountKind';
import { isFreshSignup, isGoogleUser, resolveGoogleAccountKind } from '@/lib/googleAuth';

import {
  completeAuthFromUrl,
  getNativeAuthCallbackUrl,
  isAuthCallbackUrl,
  mapAuthError,
  takePendingGoogleKind,
} from '@/lib/auth';
import { pickAuthCallbackUrl, takeAuthCallbackUrl } from '@/lib/auth-link';
import { trKey } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';

/**
 * Handles magic-link / email activation redirect from Supabase.
 * Emails always point at the public https URL, then we hand off to the app.
 */
export default function AuthCallbackScreen() {
  const [status, setStatus] = useState(() => trKey('auth.cbActivating'));
  const [error, setError] = useState<string | null>(null);
  const [activated, setActivated] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const url =
          takeAuthCallbackUrl() || Linking.getLinkingURL() || (await Linking.getInitialURL());
        const toParse = pickAuthCallbackUrl({
          platform: Platform.OS,
          webHref:
            Platform.OS === 'web'
              ? `${window.location.origin}${window.location.pathname}${window.location.search}${window.location.hash}`
              : null,
          linkUrl: url,
          isCallback: isAuthCallbackUrl,
        });
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
          setStatus(trKey('auth.cbCannotActivate'));
          return;
        }

        if (result.session) {
          let kind = parseAccountKind(
            result.session.user.user_metadata?.account_kind as string | undefined
          );
          if (isGoogleUser(result.session.user)) {
            const { data: profile } = await supabase
              .from('profiles')
              .select('account_kind')
              .eq('id', result.session.user.id)
              .maybeSingle();
            const pending = await takePendingGoogleKind();
            kind = resolveGoogleAccountKind({
              metadataKind: result.session.user.user_metadata?.account_kind as string | undefined,
              pendingKind: pending,
              // Cont nou: ușa aleasă bate profilul implicit pus de trigger. Dacă
              // ușa a fost deja consumată (formularul a terminat primul), profilul
              // e deja corect.
              profileKind:
                isFreshSignup(result.session.user) && pending
                  ? null
                  : (profile?.account_kind as string | undefined),
            });
          }
          await persistAccountKind(kind);
          if (result.recovery) {
            setStatus(trKey('auth.cbResetConfirmed'));
            router.replace('/(auth)/reset-password');
            return;
          }

          if (Platform.OS === 'web' && isGoogleUser(result.session.user)) {
            router.replace('/(app)/home');
            return;
          }

          if (Platform.OS === 'web') {
            const nativeUrl = getNativeAuthCallbackUrl(toParse);
            void Linking.openURL(nativeUrl).catch(() => undefined);
            setActivated(true);
            setStatus(trKey('auth.cbAccountActivated'));
            return;
          }

          setStatus(trKey('auth.cbActivatedRedirect'));
          router.replace('/(app)/home');
          return;
        }

        setStatus(trKey('auth.cbNoSession'));
        setError(trKey('auth.cbReopenLink'));
      } catch (e) {
        if (!cancelled) {
          setStatus(trKey('auth.cbActivationError'));
          setError(e instanceof Error ? e.message : trKey('auth.cbUnknownError'));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <Screen title={trKey('auth.cbTitle')}>
        <Callout tone="danger" title={status}>
          {error}
        </Callout>
        <Button
          label={trKey('auth.cbBackToLogin')}
          onPress={() => router.replace('/(auth)/login')}
          icon="log-in-outline"
        />
      </Screen>
    );
  }

  if (activated) {
    return (
      <Screen title={trKey('auth.cbTitle')}>
        <Callout tone="success" title={status}>
          {trKey('auth.cbActivatedBody')}
          
        </Callout>
        <Button
          label={trKey('auth.cbOpenApp')}
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
          label={trKey('auth.cbContinueWeb')}
          variant="ghost"
          icon="globe-outline"
          onPress={() => router.replace('/(app)/home')}
        />
      </Screen>
    );
  }

  return <LoadingScreen label={status} />;
}
