import { useCallback, useEffect, useState } from 'react';

import { Banner } from '@/components/ui';
import { useT } from '@/lib/i18n';
import {
  forceHardRefreshAndUpdate,
  shouldShowUpdateBanner,
} from '@/lib/appVersion';

/**
 * Banner pe ecranul principal (client + business): anunță update-ul și la tap
 * forțează hard refresh / EAS reload.
 */
export function UpdateBanner() {
  const tr = useT();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void shouldShowUpdateBanner().then((show) => {
      if (!cancelled) setVisible(show);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const onPress = useCallback(() => {
    if (busy) return;
    setBusy(true);
    void (async () => {
      try {
        await forceHardRefreshAndUpdate();
      } catch (e) {
        console.warn('forceHardRefreshAndUpdate', e);
        setBusy(false);
      }
      // Dacă reload-ul a reușit, componenta se demontează.
      // Dacă nu, lăsăm banner-ul vizibil și oprim spinner-ul.
      setBusy(false);
    })();
  }, [busy]);

  if (!visible) return null;

  return (
    <Banner
      tone="info"
      icon="cloud-download-outline"
      title={tr('update.available')}
      description={tr('update.description')}
      actionLabel={busy ? tr('update.updating') : tr('update.updateNow')}
      onPress={onPress}
    />
  );
}
