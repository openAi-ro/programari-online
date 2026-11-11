import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { Banner } from '@/components/ui';
import { useT } from '@/lib/i18n';
import { applyUpdateNow, updateBannerState } from '@/lib/appVersion';

/** Dacă după atât timp aplicația tot n-a reîncărcat, actualizarea n-a reușit. */
const RELOAD_TIMEOUT_MS = 15000;

type State = 'hidden' | 'available' | 'updating' | 'failed' | 'stuck';

/**
 * Banner pe ecranul principal (client + business): anunță versiunea nouă și la tap o aplică
 * (web: reîncarcă pagina; native: descarcă EAS Update și repornește).
 * „Se actualizează…” rămâne până la reîncărcare; o eroare arată un mesaj, nu un buton mort.
 */
export function UpdateBanner() {
  const tr = useT();
  const [state, setState] = useState<State>('hidden');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void updateBannerState().then((s) => {
      if (!cancelled) setState(s === 'none' ? 'hidden' : s);
    });
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const onPress = useCallback(() => {
    if (state === 'updating') return;
    setState('updating');
    void (async () => {
      try {
        const result = await applyUpdateNow();
        if (result === 'upToDate') {
          setState('hidden');
          return;
        }
        // Reîncărcarea a pornit: dacă pagina/aplicația tot e aici după timeout, n-a mers.
        timer.current = setTimeout(() => setState('failed'), RELOAD_TIMEOUT_MS);
      } catch (e) {
        console.warn('applyUpdateNow', e);
        setState('failed');
      }
    })();
  }, [state]);

  if (state === 'hidden') return null;

  return (
    <Banner
      tone={state === 'failed' || state === 'stuck' ? 'warning' : 'info'}
      icon={state === 'failed' || state === 'stuck' ? 'alert-circle-outline' : 'cloud-download-outline'}
      title={state === 'failed' || state === 'stuck' ? tr('update.failedTitle') : tr('update.available')}
      description={
        state === 'stuck' ? tr(Platform.OS === 'web' ? 'update.stuck' : 'update.stuckApp') : state === 'failed' ? tr('update.failed') : tr('update.description')
      }
      actionLabel={
        state === 'updating' ? tr('update.updating') : state === 'available' ? tr('update.updateNow') : tr('common.retry')
      }
      onPress={state === 'updating' ? undefined : onPress}
    />
  );
}
