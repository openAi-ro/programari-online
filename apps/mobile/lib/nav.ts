import { router } from 'expo-router';
import { useCallback } from 'react';

/**
 * Navigare înapoi sigură: dacă nu există istoric (deep link, QR, repornire),
 * merge la Acasă în loc să iasă din app.
 */
export function useBack() {
  return useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(app)/home');
    }
  }, []);
}
