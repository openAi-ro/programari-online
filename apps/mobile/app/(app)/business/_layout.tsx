import { router, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Callout, Screen, SkeletonScreen } from '@/components/ui';
import { useT } from '@/lib/i18n';
import { spacing } from '@/constants/theme';
import { resolveAppMode, type AppMode } from '@/lib/appMode';
import { supabase } from '@/lib/supabase';

/**
 * Ecranele de business sunt doar pentru conturile de business.
 * Un cont de client care ajunge aici printr-un link direct vede un mesaj, nu agenda.
 *
 * (tabs) = cele 5 meniuri primare.
 * Sibling screens (calendar, setup, staff, waitlist, qr, services, chat) pe Stack —
 * auto-descoperite (nu declara doar `(tabs)`).
 */
export const unstable_settings = {
  initialRouteName: '(tabs)',
};

export default function BusinessLayout() {
  const tr = useT();
  const [mode, setMode] = useState<AppMode | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!user) {
        router.replace('/(auth)/login');
        return;
      }
      const resolved = await resolveAppMode(user.id);
      if (!cancelled) setMode(resolved);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!mode) {
    return <SkeletonScreen blocks={3} label={tr('biz.checkingAccount')} />;
  }

  if (mode === 'client') {
    return (
      <Screen>
        <Callout tone="danger" title={tr('biz.clientAccount')}>
          {tr('biz.clientOnly')}
        </Callout>
        <View style={styles.actions}>
          <Button
            label={tr('biz.backToMyBookings')}
            icon="arrow-back"
            onPress={() => router.replace('/(app)/home')}
          />
          <Button
            label={tr('biz.accountSettings')}
            variant="secondary"
            icon="person-circle-outline"
            onPress={() => router.replace('/(app)/settings')}
          />
        </View>
      </Screen>
    );
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}

const styles = StyleSheet.create({
  actions: { gap: spacing.md },
});
