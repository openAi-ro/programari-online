import { router } from 'expo-router';
import type { ComponentType } from 'react';

import { Button, Callout, Screen, SkeletonScreen } from '@/components/ui';
import { useT } from '@/lib/i18n';
import { canManageBusinessSettings } from '@/lib/teamAccess';
import { useBusinessRole } from '@/lib/useBusinessRole';

/**
 * Ecranele owner/admin din /business: angajatul (staff) vede doar mesajul, ecranul propriu-zis
 * nu se montează (nici din link direct). Fără rol (owner fără business încă) ecranul merge normal.
 */
export function managerOnly<P extends object>(Inner: ComponentType<P>) {
  function ManagerOnlyScreen(props: P) {
    const tr = useT();
    const { role, loading } = useBusinessRole();
    if (loading) return <SkeletonScreen blocks={3} />;
    if (role && !canManageBusinessSettings(role)) {
      return (
        <Screen>
          <Callout tone="info">{tr('members.staffNoAccess')}</Callout>
          <Button
            label={tr('members.backToAppointments')}
            icon="arrow-back"
            onPress={() => router.replace('/(app)/business/(tabs)')}
          />
        </Screen>
      );
    }
    return <Inner {...props} />;
  }
  return ManagerOnlyScreen;
}
