/**
 * Hook for speech-to-text voice input using the Web Speech API.
 * Provides microphone capture with interim/final transcript,
 * auto-stop on silence, and optional auto-send.
 */
import { useState, useRef, useCallback, useEffect } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionErrorEvent {
  error: string;
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

interface UseVoiceInputOptions {
  /** BCP 47 language tag (e.g. 'en', 'zh', 'ja', 'id') */
  lang: string;
  /** Called with the final transcript text */
  onResult: (text: string) => void;
  /** When true, triggers send after recognition ends with a result */
  autoSend: boolean;
  /** Called when autoSend fires */
  onAutoSend?: () => void;
}

interface UseVoiceInputReturn {
  isListening: boolean;
  isSupported: boolean;
  interimTranscript: string;
  startListening: () => void;
  stopListening: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Map i18n language codes to BCP 47 tags the Web Speech API understands. */
const langToBcp47 = (lang: string): string => {
  const map: Record<string, string> = {
    en: 'en-US',
    zh: 'zh-CN',
    ja: 'ja-JP',
    id: 'id-ID',
  };
  return map[lang] ?? 'en-US';
};

const getSpeechRecognitionCtor = (): SpeechRecognitionConstructor | null => {
  const w = window as unknown as Record<string, unknown>;
  return (
    (w.SpeechRecognition as SpeechRecognitionConstructor | undefined) ??
    (w.webkitSpeechRecognition as SpeechRecognitionConstructor | undefined) ??
    null
  );
};

// ---------------------------------------------------------------------------
// Auto-stop silence timeout (ms)
// ---------------------------------------------------------------------------
const SILENCE_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

const useVoiceInput = ({
  lang,
  onResult,
  autoSend,
  onAutoSend,
}: UseVoiceInputOptions): UseVoiceInputReturn => {
  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hadResultRef = useRef(false);
  const autoSendRef = useRef(autoSend);
  const onResultRef = useRef(onResult);
  const onAutoSendRef = useRef(onAutoSend);

  // Keep refs in sync so callbacks never go stale
  useEffect(() => {
    autoSendRef.current = autoSend;
  }, [autoSend]);

  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  useEffect(() => {
    onAutoSendRef.current = onAutoSend;
  }, [onAutoSend]);

  const isSupported = typeof window !== 'undefined' && getSpeechRecognitionCtor() !== null;

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current !== null) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  const resetSilenceTimer = useCallback(
    (recognition: SpeechRecognitionInstance) => {
      clearSilenceTimer();
      silenceTimerRef.current = setTimeout(() => {
        recognition.stop();
      }, SILENCE_TIMEOUT_MS);
    },
    [clearSilenceTimer],
  );

  const stopListening = useCallback(() => {
    clearSilenceTimer();
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsListening(false);
    setInterimTranscript('');
  }, [clearSilenceTimer]);

  const startListening = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;

    // Stop any existing session
    if (recognitionRef.current) {
      recognitionRef.current.abort();
      recognitionRef.current = null;
    }

    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = langToBcp47(lang);

    hadResultRef.current = false;
    recognitionRef.current = recognition;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = '';
      let final = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          final += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }

      if (final) {
        hadResultRef.current = true;
        onResultRef.current(final.trim());
        setInterimTranscript('');
      } else {
        setInterimTranscript(interim);
      }

      // Reset silence timer on any speech activity
      resetSilenceTimer(recognition);
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      // "aborted" and "no-speech" are expected, not real errors
      if (event.error !== 'aborted' && event.error !== 'no-speech') {
        console.warn('[voice-input] SpeechRecognition error:', event.error);
      }
      setIsListening(false);
      setInterimTranscript('');
      clearSilenceTimer();
      recognitionRef.current = null;
    };

    recognition.onend = () => {
      setIsListening(false);
      setInterimTranscript('');
      clearSilenceTimer();
      recognitionRef.current = null;

      if (hadResultRef.current && autoSendRef.current) {
        onAutoSendRef.current?.();
      }
    };

    try {
      recognition.start();
      setIsListening(true);
      resetSilenceTimer(recognition);
    } catch {
      console.warn('[voice-input] Failed to start SpeechRecognition');
      setIsListening(false);
    }
  }, [lang, resetSilenceTimer, clearSilenceTimer]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearSilenceTimer();
      if (recognitionRef.current) {
        recognitionRef.current.abort();
        recognitionRef.current = null;
      }
    };
  }, [clearSilenceTimer]);

  return {
    isListening,
    isSupported,
    interimTranscript,
    startListening,
    stopListening,
  };
};

export default useVoiceInput;
