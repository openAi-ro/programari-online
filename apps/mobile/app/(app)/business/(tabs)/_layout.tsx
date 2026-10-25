import { Tabs } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { BusinessTabBar } from '@/components/BusinessTabBar';
import { businessIdFilter } from '@/lib/realtimeFilters';
import { supabase } from '@/lib/supabase';
import { getCurrentUser } from '@/lib/currentUser';
import { useForegroundInterval } from '@/lib/useForegroundInterval';

/**
 * Real Tabs for the 5 business primary menus.
 * Screens stay mounted (lazy + freezeOnBlur) so switch does not remount.
 * Stack siblings (calendar, staff, …) live in business/_layout.tsx above this group.
 */
export default function BusinessTabsLayout() {
  const [requestBadge, setRequestBadge] = useState(0);
  // Business-urile proprii nu se schimbă în timpul sesiunii: le citim o dată
  // (per utilizator), apoi badge-ul costă o singură cerere (count).
  const bizIdsRef = useRef<{ userId: string; ids: string[] } | null>(null);
  // Filtrul Realtime depinde de id-uri: canalul se (re)creează când se schimbă.
  const [badgeFilter, setBadgeFilter] = useState<string | null>(null);

  const refreshBadge = useCallback(async () => {
    try {
      const user = await getCurrentUser();
      if (!user) {
        bizIdsRef.current = null;
        setBadgeFilter(null);
        setRequestBadge(0);
        return;
      }
      if (bizIdsRef.current?.userId !== user.id) {
        const { data: businesses, error } = await supabase
          .from('business_profiles')
          .select('id')
          .eq('owner_user_id', user.id);
        if (error) return;
        bizIdsRef.current = { userId: user.id, ids: (businesses ?? []).map((b) => b.id as string) };
      }
      const ids = bizIdsRef.current.ids;
      setBadgeFilter(businessIdFilter(ids));
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
  }, [refreshBadge]);

  useEffect(() => {
    if (!badgeFilter) return;
    // Schimbările vin prin realtime (doar saloanele proprii); sondajul e doar plasă de siguranță
    // (5 min, oprit în fundal, reîmprospătare la revenirea în aplicație).
    const channel = supabase
      .channel(`business-requests-badge-${Date.now()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'appointments', filter: badgeFilter },
        () => void refreshBadge()
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [badgeFilter, refreshBadge]);
  useForegroundInterval(() => void refreshBadge(), 5 * 60_000);

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
