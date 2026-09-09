import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';

import { LoadingScreen } from '@/components/ui';
import { supabase } from '@/lib/supabase';

export default function Index() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (session === undefined) {
    return <LoadingScreen label="Se încarcă…" />;
  }

  if (!session) {
    return <Redirect href="/(auth)/login" />;
  }

  return <Redirect href="/(app)/home" />;
}
