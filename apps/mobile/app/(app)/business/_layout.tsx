import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppModeSwitch } from '@/components/AppModeSwitch';
import { Button, Callout, Screen, SkeletonScreen } from '@/components/ui';
import { InvitationAcceptCard } from '@/components/InvitationAcceptCard';
import { useT } from '@/lib/i18n';
import { spacing } from '@/constants/theme';
import { resolveAppMode, type ModeState } from '@/lib/appMode';
import { getCurrentUser } from '@/lib/currentUser';

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
  const [state, setState] = useState<ModeState | null>(null);
  const mode = state?.mode ?? null;

  const load = useCallback(async (isCancelled: () => boolean = () => false) => {
    const user = await getCurrentUser();
    if (isCancelled()) return;
    if (!user) {
      router.replace('/(auth)/login');
      return;
    }
    const resolved = await resolveAppMode(user.id);
    if (!isCancelled()) setState(resolved);
  }, []);

  // La fiecare intrare în zona business (accept invitație, comutare client/business) zona se recalculează.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void load(() => cancelled);
      return () => {
        cancelled = true;
      };
    }, [load]),
  );

  if (!mode) {
    return <SkeletonScreen blocks={3} label={tr('biz.checkingAccount')} />;
  }

  if (mode === 'client') {
    return (
      <Screen>
        <Callout tone="danger" title={tr('biz.clientAccount')}>
          {tr('biz.clientOnly')}
        </Callout>
        <InvitationAcceptCard onEntered={() => void load()} />
        {state?.canSwitch ? <AppModeSwitch target="business" onSwitched={() => void load()} /> : null}
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

  // Ecranele owner/admin se apără singure (managerOnly): angajatul vede doar mesajul, nu și ecranul.
  return <Stack screenOptions={{ headerShown: false }} />;
}

const styles = StyleSheet.create({
  actions: { gap: spacing.md },
});
