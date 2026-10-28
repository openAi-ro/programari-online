import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { Button, useTheme } from '@/components/ui';
import { fontSize, radius, spacing } from '@/constants/theme';
import { setAppMode, type AppMode } from '@/lib/appMode';
import { useT } from '@/lib/i18n';
import { invalidateBusinessRole } from '@/lib/useBusinessRole';

/** Mută contul în zona aleasă; alegerea e memorată, iar zona business recitește rolul. */
export async function switchAppMode(target: AppMode) {
  await setAppMode(target);
  invalidateBusinessRole();
  router.replace(target === 'business' ? '/(app)/business/(tabs)' : '/(app)/home');
}

/** Pentru conturile de client care sunt și în echipa unui salon: comutare între cele două zone. */
export function AppModeSwitch({
  target,
  onSwitched,
}: {
  target: AppMode;
  /** Pentru ecranele care rămân montate după comutare (ex. layout-ul business): recitește zona. */
  onSwitched?: () => void;
}) {
  const t = useTheme();
  const tr = useT();
  const toBusiness = target === 'business';
  return (
    <View style={[styles.box, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}>
      <Text style={[styles.hint, { color: t.colors.textMuted }]}>
        {toBusiness ? tr('mode.toBusinessHint') : tr('mode.toClientHint')}
      </Text>
      <Button
        label={toBusiness ? tr('mode.toBusiness') : tr('mode.toClient')}
        icon={toBusiness ? 'storefront-outline' : 'person-outline'}
        variant={toBusiness ? 'primary' : 'secondary'}
        onPress={async () => {
          await switchAppMode(target);
          onSwitched?.();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm },
  hint: { fontSize: fontSize.sm },
});
