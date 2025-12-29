'use client';

import { useState, useCallback, useRef, useEffect } from 'react';

/**
 * TTS State
 */
export type TTSState = 'idle' | 'loading' | 'playing' | 'error';

/**
 * TTS Error interface
 */
export interface TTSError {
  message: string;
  code?: string;
  recoverable: boolean;
}

/**
 * Hook configuration
 */
interface UseElevenLabsTTSConfig {
  /** Voice ID to use (optional, uses default if not provided) */
  voiceId?: string;
  /** Callback when speech starts */
  onStart?: () => void;
  /** Callback when speech ends */
  onEnd?: () => void;
  /** Callback on error */
  onError?: (error: TTSError) => void;
}

/**
 * Hook return type
 */
interface UseElevenLabsTTSReturn {
  /** Current TTS state */
  state: TTSState;
  /** Whether TTS is currently speaking */
  isSpeaking: boolean;
  /** Whether TTS is loading audio */
  isLoading: boolean;
  /** Current error (if any) */
  error: TTSError | null;
  /** Speak the given text */
  speak: (text: string) => Promise<void>;
  /** Stop current speech */
  stop: () => void;
  /** Clear error state */
  clearError: () => void;
}

/**
 * Audio queue item
 */
interface QueueItem {
  text: string;
  resolve: () => void;
  reject: (error: Error) => void;
}

/**
 * Custom hook for ElevenLabs Text-to-Speech
 */
export function useElevenLabsTTS(config: UseElevenLabsTTSConfig = {}): UseElevenLabsTTSReturn {
  const { voiceId, onStart, onEnd, onError } = config;

  const [state, setState] = useState<TTSState>('idle');
  const [error, setError] = useState<TTSError | null>(null);

  // Refs
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const queueRef = useRef<QueueItem[]>([]);
  const isProcessingRef = useRef(false);
  const isMountedRef = useRef(true);
  const currentItemRef = useRef<QueueItem | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
        audioRef.current = null;
      }
      queueRef.current = [];
    };
  }, []);

  /**
   * Process the audio queue
   */
  const processQueue = useCallback(async () => {
    if (isProcessingRef.current || queueRef.current.length === 0) {
      return;
    }

    isProcessingRef.current = true;
    const item = queueRef.current.shift()!;
    currentItemRef.current = item;

    try {
      if (!isMountedRef.current) {
        item.reject(new Error('Component unmounted'));
        return;
      }

      setState('loading');
      setError(null);

      // Call TTS API
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: item.text,
          voiceId,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.details || errorData.error || 'TTS request failed');
      }

      // Get audio blob
      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);

      if (!isMountedRef.current) {
        URL.revokeObjectURL(audioUrl);
        item.reject(new Error('Component unmounted'));
        return;
      }

      // Create new audio element for each playback
      const audio = new Audio();
      audioRef.current = audio;

      // Set up event handlers BEFORE setting src
      audio.onended = () => {
        URL.revokeObjectURL(audioUrl);
        if (isMountedRef.current) {
          setState('idle');
          onEnd?.();
        }
        currentItemRef.current = null;
        isProcessingRef.current = false;
        // Process next item
        if (isMountedRef.current && queueRef.current.length > 0) {
          processQueue();
        }
      };

      audio.onerror = () => {
        URL.revokeObjectURL(audioUrl);
        // Only handle error if we were actually trying to play something
        if (currentItemRef.current && audio.src) {
          const audioError: TTSError = {
            message: 'Audio playback failed',
            code: 'PLAYBACK_ERROR',
            recoverable: true
          };
          if (isMountedRef.current) {
            setError(audioError);
            setState('error');
            onError?.(audioError);
          }
          currentItemRef.current?.reject(new Error('Audio playback failed'));
        }
        currentItemRef.current = null;
        isProcessingRef.current = false;
        // Process next item
        if (isMountedRef.current && queueRef.current.length > 0) {
          processQueue();
        }
      };

      // Set source and play
      audio.src = audioUrl;

      setState('playing');
      onStart?.();

      try {
        await audio.play();
        item.resolve();
      } catch (playError) {
        // Handle autoplay policy - user interaction required
        URL.revokeObjectURL(audioUrl);
        const err = playError as Error;
        if (err.name === 'NotAllowedError') {
          const autoplayError: TTSError = {
            message: 'Audio playback blocked. Please interact with the page first.',
            code: 'AUTOPLAY_BLOCKED',
            recoverable: true
          };
          if (isMountedRef.current) {
            setError(autoplayError);
            setState('error');
            onError?.(autoplayError);
          }
        }
        throw playError;
      }

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      const ttsError: TTSError = {
        message: errorMessage,
        code: 'TTS_ERROR',
        recoverable: true
      };

      if (isMountedRef.current) {
        setError(ttsError);
        setState('error');
        onError?.(ttsError);
      }

      item.reject(err instanceof Error ? err : new Error(errorMessage));
      currentItemRef.current = null;
      isProcessingRef.current = false;

      // Process next item even on error
      if (isMountedRef.current && queueRef.current.length > 0) {
        processQueue();
      }
    }
  }, [voiceId, onStart, onEnd, onError]);

  /**
   * Speak text using ElevenLabs TTS
   */
  const speak = useCallback(async (text: string): Promise<void> => {
    if (!text || text.trim().length === 0) {
      return;
    }

    return new Promise((resolve, reject) => {
      queueRef.current.push({ text: text.trim(), resolve, reject });
      processQueue();
    });
  }, [processQueue]);

  /**
   * Stop current speech and clear queue
   */
  const stop = useCallback(() => {
    // Clear queue
    queueRef.current.forEach(item => {
      item.reject(new Error('Speech stopped by user'));
    });
    queueRef.current = [];
    currentItemRef.current = null;
    isProcessingRef.current = false;

    // Stop audio
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
      audioRef.current = null;
    }

    setState('idle');
    setError(null);
  }, []);

  /**
   * Clear error state
   */
  const clearError = useCallback(() => {
    setError(null);
    if (state === 'error') {
      setState('idle');
    }
  }, [state]);

  return {
    state,
    isSpeaking: state === 'playing',
    isLoading: state === 'loading',
    error,
    speak,
    stop,
    clearError,
  };
}

export default useElevenLabsTTS;
