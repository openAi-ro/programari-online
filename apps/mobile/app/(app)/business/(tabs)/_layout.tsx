import { Tabs } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';

import { BusinessTabBar } from '@/components/BusinessTabBar';
import { supabase } from '@/lib/supabase';

/**
 * Real Tabs for the 5 business primary menus.
 * Screens stay mounted (lazy + freezeOnBlur) so switch does not remount.
 * Stack siblings (calendar, staff, …) live in business/_layout.tsx above this group.
 */
export default function BusinessTabsLayout() {
  const [requestBadge, setRequestBadge] = useState(0);

  const refreshBadge = useCallback(async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setRequestBadge(0);
        return;
      }
      const { data: businesses } = await supabase
        .from('business_profiles')
        .select('id')
        .eq('owner_user_id', user.id);
      const ids = (businesses ?? []).map((b) => b.id as string);
      if (ids.length === 0) {
        setRequestBadge(0);
        return;
      }
      const { count } = await supabase
        .from('appointments')
        .select('id', { count: 'exact', head: true })
        .in('business_id', ids)
        .eq('status', 'pending');
      setRequestBadge(count ?? 0);
    } catch {
      // badge is best-effort
    }
  }, []);

  useEffect(() => {
    void refreshBadge();
    const interval = setInterval(() => void refreshBadge(), 60_000);
    return () => clearInterval(interval);
  }, [refreshBadge]);

  return (
    <Tabs
      tabBar={(props) => (
        <BusinessTabBar
          {...props}
          badges={{ requests: requestBadge }}
          onRequestsFocus={refreshBadge}
        />
      )}
      screenOptions={{
        headerShown: false,
        lazy: true,
        freezeOnBlur: true,
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Acasă' }} />
      <Tabs.Screen name="requests" options={{ title: 'Cereri' }} />
      <Tabs.Screen name="clients" options={{ title: 'Clienți' }} />
      <Tabs.Screen name="reports" options={{ title: 'Rapoarte' }} />
      <Tabs.Screen name="settings" options={{ title: 'Setări' }} />
    </Tabs>
  );
}
