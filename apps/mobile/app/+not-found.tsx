import { Stack, useRouter } from 'expo-router';

import { Button, EmptyState, Screen, useTheme } from '@/components/ui';
import { spacing } from '@/constants/theme';

export default function NotFoundScreen() {
  const t = useTheme();
  const router = useRouter();

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Screen>
        <EmptyState
          icon="compass-outline"
          title="Ecranul nu există"
          description="Linkul acesta nu duce nicăieri în app. Verifică linkul sau întoarce-te la început."
          action={
            <Button
              label="Înapoi la început"
              icon="home-outline"
              onPress={() => router.replace('/(auth)/login' as never)}
            />
          }
        />
        <Button
          label="Scanează un cod QR"
          variant="secondary"
          icon="scan-outline"
          onPress={() => router.replace('/(app)/scan' as never)}
          style={{ marginTop: spacing.md }}
        />
        <Button
          label="Deschide contul tău"
          variant="ghost"
          icon="person-circle-outline"
          onPress={() => router.replace('/(app)/home' as never)}
          style={{ marginTop: spacing.xs }}
        />
      </Screen>
    </>
  );
}
