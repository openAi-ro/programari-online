import { Platform } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Linking from 'expo-linking';

import { Button, Callout, Screen } from '@/components/ui';
import { gcalReturnMessageKey, gcalReturnTarget } from '@/lib/gcalReturn';
import { useT, type TrKey } from '@/lib/i18n';

function firstParam(v: string | string[] | undefined): string | null {
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
  return null;
}

/** Pagina publică după acordul Google Calendar (redirect din google-calendar-callback). */
export default function GcalConnectedScreen() {
  const tr = useT();
  const params = useLocalSearchParams<{ status?: string; reason?: string }>();
  const status = firstParam(params.status);
  const ok = status === 'ok';

  function goBack() {
    const ua = Platform.OS === 'web' ? window.navigator.userAgent : null;
    const target = gcalReturnTarget(Platform.OS, ua);
    if (target.deepLink) {
      void Linking.openURL(target.deepLink).catch(() => undefined);
      setTimeout(() => router.replace(target.path as never), 1500);
      return;
    }
    router.replace(target.path as never);
  }

  return (
    <Screen title={tr('gcal.title')}>
      <Callout tone={ok ? 'success' : 'danger'} title={ok ? tr('common.done') : tr('gcal.retFailTitle')}>
        {tr(gcalReturnMessageKey(status, firstParam(params.reason)) as TrKey)}
      </Callout>
      <Button label={tr('gcal.retBack')} icon="arrow-back-outline" onPress={goBack} />
    </Screen>
  );
}