import type { Session, User } from '@supabase/supabase-js';

/** Ce ne trebuie din `supabase.auth` — permite testarea fără client real. */
export type SessionSource = {
  getSession(): Promise<{ data: { session: Session | null } }>;
};

/**
 * Utilizatorul din sesiunea locală (AsyncStorage / localStorage), fără cerere
 * la /auth/v1/user. Serverul validează oricum JWT-ul la fiecare cerere (RLS),
 * deci pentru ecrane e suficient. Pentru acțiuni sensibile folosește getUser().
 */
export async function userFromSession(source: SessionSource): Promise<User | null> {
  try {
    const { data } = await source.getSession();
    return data.session?.user ?? null;
  } catch {
    return null;
  }
}
