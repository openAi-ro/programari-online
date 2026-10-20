import type { User } from '@supabase/supabase-js';

import { userFromSession } from './sessionUser';
import { supabase } from './supabase';

/** Utilizatorul curent din sesiunea locală (fără rețea). Vezi `userFromSession`. */
export function getCurrentUser(): Promise<User | null> {
  return userFromSession(supabase.auth);
}
