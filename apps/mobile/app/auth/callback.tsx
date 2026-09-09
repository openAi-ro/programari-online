import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import * as Linking from 'expo-linking';

import { LoadingScreen } from '@/components/ui';
import { supabase } from '@/lib/supabase';

function isRecoveryFromUrl(url: string | null): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  return lower.includes('type=recovery') || lower.includes('type%3drecovery');
}

function isRecoveryFromWindow(): boolean {
  if (typeof window === 'undefined') return false;
  const hash = window.location.hash?.replace(/^#/, '') ?? '';
  const search = window.location.search?.replace(/^\?/, '') ?? '';
  const params = new URLSearchParams(hash || search);
  const type = (params.get('type') ?? '').toLowerCase();
  return type === 'recovery';
}

/**
 * Handles magic-link / email redirect from Supabase.
 * URL must match Redirect URLs in Supabase (e.g. http://localhost:8084/auth/callback).
 * Password recovery (type=recovery) → /(auth)/reset-password.
 */
export default function AuthCallbackScreen() {
  const [status, setStatus] = useState('Se confirmă sesiunea…');

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const url = await Linking.getInitialURL();
        let recovery = isRecoveryFromUrl(url);

        if (url && (url.includes('access_token') || url.includes('code='))) {
          // Some flows put tokens in the hash/query — supabase-js on web may pick them up.
          await supabase.auth.getSession();
        }

        // PKCE / hash tokens
        if (typeof window !== 'undefined') {
          const hash = window.location.hash?.replace(/^#/, '') ?? '';
          const search = window.location.search?.replace(/^\?/, '') ?? '';
          const params = new URLSearchParams(hash || search);
          const access_token = params.get('access_token');
          const refresh_token = params.get('refresh_token');
          if (access_token && refresh_token) {
            await supabase.auth.setSession({ access_token, refresh_token });
          }
          if (isRecoveryFromWindow()) recovery = true;
        }

        const { data } = await supabase.auth.getSession();
        if (cancelled) return;
        if (data.session) {
          if (recovery) {
            setStatus('Link de resetare confirmat. Redirecționare…');
            router.replace('/(auth)/reset-password');
          } else {
            setStatus('Autentificat. Redirecționare…');
            router.replace('/(app)/home');
          }
        } else {
          setStatus(
            'Nu s-a putut deschide sesiunea din link. Înapoi la login și folosește codul OTP din email (6 cifre), nu linkul.'
          );
          setTimeout(() => {
            if (!cancelled) router.replace('/(auth)/login');
          }, 4000);
        }
      } catch {
        if (!cancelled) {
          setStatus('Eroare la confirmare. Folosește codul din email pe ecranul de login.');
          setTimeout(() => router.replace('/(auth)/login'), 3000);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return <LoadingScreen label={status} />;
}
