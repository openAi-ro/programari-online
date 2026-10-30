import { requireOptionalNativeModule } from 'expo';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { dictationErrorKind, joinDictation, type DictationError } from './dictation';
import { localeTag } from './i18n';

type Speech = typeof import('expo-speech-recognition').ExpoSpeechRecognitionModule;

/**
 * Recunoașterea vocală, dacă e disponibilă aici: pe web prin Web Speech API din browser,
 * pe nativ doar în binarele care conțin modulul (runtime 1.2.0+). Pe un binar mai vechi
 * modulul nativ lipsește, deci nu-l încărcăm deloc (altfel importul ar arunca) și butonul nu apare.
 */
function speechModule(): Speech | null {
  if (Platform.OS !== 'web' && !requireOptionalNativeModule('ExpoSpeechRecognition')) return null;
  const speech: Speech = require('expo-speech-recognition').ExpoSpeechRecognitionModule;
  return speech.isRecognitionAvailable() ? speech : null;
}

/**
 * Permisiunea reala pentru microfon. Pe web, requestPermissionsAsync nu asteapta promptul browserului,
 * asa ca prima apasare pornea ascultarea inainte de raspuns; getUserMedia asteapta raspunsul.
 */
async function micAllowed(speech: Speech): Promise<boolean> {
  if (Platform.OS !== 'web') return (await speech.requestPermissionsAsync()).granted;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    return true;
  } catch (e) {
    const name = (e as { name?: string } | null)?.name;
    if (name === 'NotAllowedError' || name === 'SecurityError') return false;
    throw e;
  }
}

/**
 * Microfon pentru câmpul de mesaj: textul dictat se adaugă în ciornă (nu se trimite singur).
 * `supported` e false unde nu există recunoaștere vocală (binar vechi, browser fără Web Speech API).
 */
export function useDictation(draft: string, setDraft: (text: string) => void) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<DictationError | null>(null);
  const speechRef = useRef<Speech | null>(null);
  // Modulul e global: ascultăm evenimentele doar cât timp sesiunea e pornită de acest câmp.
  const activeRef = useRef(false);
  const baseRef = useRef('');
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const setDraftRef = useRef(setDraft);
  setDraftRef.current = setDraft;

  // După montare (nu la randarea de pe server), ca HTML-ul SSR să fie identic.
  useEffect(() => {
    const speech = speechModule();
    speechRef.current = speech;
    setSupported(speech !== null);
    if (!speech) return undefined;
    const subs = [
      speech.addListener('result', (e) => {
        if (activeRef.current) setDraftRef.current(joinDictation(baseRef.current, e.results[0]?.transcript ?? ''));
      }),
      speech.addListener('error', (e) => {
        if (activeRef.current) setError(dictationErrorKind(e.error));
      }),
      speech.addListener('end', () => {
        if (!activeRef.current) return;
        activeRef.current = false;
        setListening(false);
      }),
    ];
    return () => {
      subs.forEach((s) => s.remove());
      if (activeRef.current) speech.abort();
      activeRef.current = false;
    };
  }, []);

  const start = useCallback(async (speech: Speech) => {
    setError(null);
    if (!(await micAllowed(speech))) {
      setError('denied');
      return;
    }
    baseRef.current = draftRef.current;
    activeRef.current = true;
    setListening(true);
    speech.start({ lang: localeTag(), interimResults: true, continuous: false });
  }, []);

  const toggle = useCallback(() => {
    const speech = speechRef.current;
    if (!speech) return;
    if (activeRef.current) {
      speech.stop();
      return;
    }
    start(speech).catch(() => {
      activeRef.current = false;
      setListening(false);
      setError('failed');
    });
  }, [start]);

  return { supported, listening, error, toggle };
}
