import { Stack, useRouter } from 'expo-router';

import { Button, EmptyState, Screen, useTheme } from '@/components/ui';
import { useT } from '@/lib/i18n';
import { spacing } from '@/constants/theme';

export default function NotFoundScreen() {
  const t = useTheme();
  const tr = useT();
  const router = useRouter();

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Screen>
        <EmptyState
          icon="compass-outline"
          title={tr('nav.notFoundTitle')}
          description={tr('nav.notFoundDesc')}
          action={
            <Button
              label={tr('nav.backToStart')}
              icon="home-outline"
              onPress={() => router.replace('/(auth)/login' as never)}
            />
          }
        />
        <Button
          label={tr('nav.scanQr')}
          variant="secondary"
          icon="scan-outline"
          onPress={() => router.replace('/(app)/scan' as never)}
          style={{ marginTop: spacing.md }}
        />
        <Button
          label={tr('nav.openAccount')}
          variant="ghost"
          icon="person-circle-outline"
          onPress={() => router.replace('/(app)/home' as never)}
          style={{ marginTop: spacing.xs }}
        />
      </Screen>
    </>
  );
}
