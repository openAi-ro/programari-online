import { router, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Callout, Screen, SkeletonScreen } from '@/components/ui';
import { spacing } from '@/constants/theme';
import { resolveAppMode, type AppMode } from '@/lib/appMode';
import { supabase } from '@/lib/supabase';

/**
 * Ecranele de business sunt doar pentru conturile de business.
 * Un cont de client care ajunge aici printr-un link direct vede un mesaj, nu agenda.
 */
export default function BusinessLayout() {
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
    return <SkeletonScreen blocks={3} label="Se verifică tipul contului…" />;
  }

  if (mode === 'client') {
    return (
      <Screen>
        <Callout tone="danger" title="Cont de client">
          Acest ecran e doar pentru conturile de business. Contul tău e de client, așa că nu
          are agendă, cereri sau clienți de administrat.
        </Callout>
        <View style={styles.actions}>
          <Button
            label="Înapoi la programările mele"
            icon="arrow-back"
            onPress={() => router.replace('/(app)/home')}
          />
          <Button
            label="Setări cont"
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