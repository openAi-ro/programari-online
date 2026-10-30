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

type MicAccess = { granted: boolean; fresh: boolean; release: () => void };
const keepNothing = () => {};

/**
 * Permisiunea reala pentru microfon. Pe web, requestPermissionsAsync din modul raspunde mereu "granted"
 * fara prompt. Daca browserul are deja permisiunea, pornim direct. Altfel getUserMedia deschide promptul;
 * fluxul ramane deschis pana cand recunoasterea chiar asculta (audiostart), ca microfonul abia acordat
 * sa nu fie inchis chiar in clipa in care recunoasterea il cere.
 */
async function micAccess(speech: Speech): Promise<MicAccess> {
  if (Platform.OS !== 'web') {
    return { granted: (await speech.requestPermissionsAsync()).granted, fresh: false, release: keepNothing };
  }
  const state = await navigator.permissions
    ?.query({ name: 'microphone' as PermissionName })
    .then((status) => status.state, () => 'prompt' as const);
  if (state === 'granted') return { granted: true, fresh: false, release: keepNothing };
  if (state === 'denied') return { granted: false, fresh: false, release: keepNothing };
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    return { granted: true, fresh: true, release: () => stream.getTracks().forEach((track) => track.stop()) };
  } catch (e) {
    const name = (e as { name?: string } | null)?.name;
    if (name === 'NotAllowedError' || name === 'SecurityError') return { granted: false, fresh: false, release: keepNothing };
    throw e;
  }
}

function listen(speech: Speech) {
  speech.start({ lang: localeTag(), interimResults: true, continuous: false });
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
  // Fluxul getUserMedia ținut deschis până la audiostart (doar după un prompt nou).
  const releaseRef = useRef(keepNothing);
  // Imediat după acordarea permisiunii, Chrome poate încheia prima sesiune înainte să asculte; o repornim o dată.
  const retryRef = useRef(false);
  const heardRef = useRef(false);
  // Cat timp asteptam raspunsul la prompt, inca nu exista o sesiune de oprit.
  const pendingRef = useRef(false);
  const baseRef = useRef('');
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const setDraftRef = useRef(setDraft);
  setDraftRef.current = setDraft;

  const releaseMic = useCallback(() => {
    releaseRef.current();
    releaseRef.current = keepNothing;
  }, []);

  // După montare (nu la randarea de pe server), ca HTML-ul SSR să fie identic.
  useEffect(() => {
    const speech = speechModule();
    speechRef.current = speech;
    setSupported(speech !== null);
    if (!speech) return undefined;
    const subs = [
      speech.addListener('audiostart', () => {
        if (!activeRef.current) return;
        heardRef.current = true;
        releaseMic();
      }),
      speech.addListener('result', (e) => {
        if (activeRef.current) setDraftRef.current(joinDictation(baseRef.current, e.results[0]?.transcript ?? ''));
      }),
      speech.addListener('error', (e) => {
        if (!activeRef.current) return;
        const kind = dictationErrorKind(e.error);
        if (kind) retryRef.current = false;
        setError(kind);
      }),
      speech.addListener('end', () => {
        if (!activeRef.current) return;
        if (retryRef.current && !heardRef.current) {
          retryRef.current = false;
          try {
            listen(speech);
            return;
          } catch {
            setError('failed');
          }
        }
        releaseMic();
        activeRef.current = false;
        setListening(false);
      }),
    ];
    return () => {
      subs.forEach((s) => s.remove());
      if (activeRef.current) speech.abort();
      activeRef.current = false;
      releaseMic();
    };
  }, [releaseMic]);

  const start = useCallback(async (speech: Speech) => {
    setError(null);
    // Apasarea e confirmata imediat; o a doua apasare cat timp asteptam promptul anuleaza pornirea.
    activeRef.current = true;
    pendingRef.current = true;
    retryRef.current = false;
    setListening(true);
    const mic = await micAccess(speech).finally(() => {
      pendingRef.current = false;
    });
    if (!activeRef.current) {
      mic.release();
      return;
    }
    if (!mic.granted) {
      activeRef.current = false;
      setListening(false);
      setError('denied');
      return;
    }
    releaseRef.current = mic.release;
    retryRef.current = mic.fresh;
    heardRef.current = false;
    baseRef.current = draftRef.current;
    listen(speech);
  }, []);

  const toggle = useCallback(() => {
    const speech = speechRef.current;
    if (!speech) return;
    if (pendingRef.current) {
      activeRef.current = false;
      setListening(false);
      return;
    }
    if (activeRef.current) {
      retryRef.current = false;
      speech.stop();
      return;
    }
    start(speech).catch(() => {
      releaseMic();
      activeRef.current = false;
      setListening(false);
      setError('failed');
    });
  }, [start, releaseMic]);

  return { supported, listening, error, toggle };
}
