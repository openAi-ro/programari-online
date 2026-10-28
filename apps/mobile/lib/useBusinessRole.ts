import { useEffect, useState } from 'react';

import { fetchBusinessRole } from './businessMembers';
import { getCurrentUser } from './currentUser';
import { fetchMyBusiness } from './myBusiness';
import type { BusinessRole } from './teamAccess';

type RoleState = { role: BusinessRole | null; businessId: string | null; businessName: string | null };

let cached: { key: string; value: RoleState } | null = null;
let inflight: Promise<RoleState> | null = null;

/** După acceptarea unei invitații sau schimbarea business-ului: rolul se recitește. */
export function invalidateBusinessRole() {
  cached = null;
  inflight = null;
}

async function loadRole(): Promise<RoleState> {
  const user = await getCurrentUser();
  if (!user) return { role: null, businessId: null, businessName: null };
  const business = await fetchMyBusiness(user.id);
  if (!business) return { role: null, businessId: null, businessName: null };
  const key = `${user.id}:${business.id}`;
  if (cached?.key === key) return cached.value;
  const value = { role: await fetchBusinessRole(business.id), businessId: business.id, businessName: business.name };
  cached = { key, value };
  return value;
}

/** Rolul meu (owner/admin/staff) în business-ul activ; null cât se încarcă sau fără business. */
export function useBusinessRole(): RoleState & { loading: boolean } {
  const [state, setState] = useState<RoleState & { loading: boolean }>(() =>
    cached ? { ...cached.value, loading: false } : { role: null, businessId: null, businessName: null, loading: true },
  );
  useEffect(() => {
    let cancelled = false;
    inflight ??= loadRole().finally(() => {
      inflight = null;
    });
    void inflight.then((value) => {
      if (!cancelled) setState({ ...value, loading: false });
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}
