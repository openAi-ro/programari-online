import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { dictationErrorKind, joinDictation } from './dictation';
import { localeTag } from './i18n';

type RecognitionResultList = ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: RecognitionResultList }) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Microfon pentru câmpul de mesaj: textul dictat se adaugă în ciornă (nu se trimite singur).
 * `supported` e false pe nativ și în browserele fără Web Speech API.
 */
export function useDictation(draft: string, setDraft: (text: string) => void) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<'denied' | 'failed' | null>(null);
  const recRef = useRef<Recognition | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  // După montare (nu la randarea de pe server), ca HTML-ul SSR să fie identic.
  useEffect(() => {
    setSupported(recognitionCtor() !== null);
    return () => recRef.current?.abort();
  }, []);

  const toggle = useCallback(() => {
    if (recRef.current) {
      recRef.current.stop();
      return;
    }
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    const base = draftRef.current;
    rec.lang = localeTag();
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (e) => {
      let spoken = '';
      for (let i = 0; i < e.results.length; i += 1) spoken += `${e.results[i][0].transcript} `;
      setDraft(joinDictation(base, spoken));
    };
    rec.onerror = (e) => setError(dictationErrorKind(e.error));
    rec.onend = () => {
      recRef.current = null;
      setListening(false);
    };
    setError(null);
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      recRef.current = null;
      setError('failed');
    }
  }, [setDraft]);

  return { supported, listening, error, toggle };
}
