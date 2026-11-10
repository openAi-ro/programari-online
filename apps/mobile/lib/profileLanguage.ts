import { getLanguage, hasUrlLanguage, languageSyncAction, setLanguage } from './language';
import { supabase } from './supabase';

/** La autentificare: limba aleasă explicit vine din profil; altfel profilul preia limba afișată (P6). */
export async function syncLanguageFromProfile(userId: string): Promise<void> {
  const { data, error } = await supabase
    .from('profiles')
    .select('language, language_set_at')
    .eq('id', userId)
    .maybeSingle();
  if (error) {
    console.warn('syncLanguageFromProfile', error.message);
    return;
  }
  const action = languageSyncAction(data, await getLanguage(), hasUrlLanguage());
  if (action?.kind === 'apply') await setLanguage(action.lang);
  if (action?.kind === 'push') {
    const { error: rpcErr } = await supabase.rpc('sync_device_language', { p_lang: action.lang });
    if (rpcErr) console.warn('sync_device_language', rpcErr.message);
  }
}
