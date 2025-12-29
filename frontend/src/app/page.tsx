'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

// Web Speech API type declarations (not included in standard TypeScript lib)
interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
  length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  isFinal: boolean;
  length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message: string;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: ((this: SpeechRecognition, ev: Event) => void) | null;
  onaudiostart: ((this: SpeechRecognition, ev: Event) => void) | null;
  onspeechstart: ((this: SpeechRecognition, ev: Event) => void) | null;
  onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => void) | null;
  onerror: ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => void) | null;
  onend: ((this: SpeechRecognition, ev: Event) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useElevenLabsTTS } from '@/hooks/useElevenLabsTTS';
import {
  ErrorCategory,
  ErrorSeverity,
  AppError,
  logError,
  createAppError,
  getUserFriendlyMessage
} from '@/types/errors';

// ============================================================================
// Types
// ============================================================================

type ErrorType = 'camera' | 'microphone' | 'api' | 'network' | 'speech' | 'canvas' | 'general';

interface VisionVoiceError {
  type: ErrorType;
  message: string;
  recoverable: boolean;
  action?: string;
}

// ============================================================================
// Constants
// ============================================================================

const MAX_RETRIES = 3;
const API_TIMEOUT = 30000; // 30 seconds
const SPEECH_NO_SPEECH_TIMEOUT = 10000; // 10 seconds without speech
const MAX_IMAGE_SIZE_MB = 4; // Max image size for API
const MIN_REQUEST_INTERVAL = 4000; // Minimum 4 seconds between vision requests (allows ~15 RPM safely)
const RATE_LIMIT_STORAGE_KEY = 'visionvoice_rate_limit_until'; // Persist rate limit across page reloads

// Wake words that trigger the assistant (case-insensitive)
// Include common misrecognitions like "mission" for "vision"
const WAKE_WORDS = [
  'hey vision', 'vision', 'okay vision', 'hi vision',
  'hey mission', 'mission', 'okay mission', 'hi mission',  // common mishearing
  'a vision', 'the vision'
];
// Minimum words required if no wake word (to avoid single-word triggers)
const MIN_WORDS_WITHOUT_WAKE = 3;

// ============================================================================
// Main Component
// ============================================================================

function VisionVoiceApp() {
  // State
  const [isActive, setIsActive] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [response, setResponse] = useState('');
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<VisionVoiceError | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [isOnline, setIsOnline] = useState(true);
  const [speechRecognitionSupported, setSpeechRecognitionSupported] = useState(true);

  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const noSpeechTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  // Refs for tracking current state in callbacks (to avoid stale closures)
  const isActiveRef = useRef(isActive);
  const isListeningRef = useRef(isListening);
  const stopSpeakingRef = useRef<() => void>(() => {});
  const lastRequestTimeRef = useRef<number>(0);
  const rateLimitUntilRef = useRef<number>(0);
  const requestCountRef = useRef<number>(0); // Track requests for debugging
  const rateLimitInitializedRef = useRef<boolean>(false);

  // ElevenLabs TTS Hook
  const {
    speak,
    stop: stopSpeaking,
    isSpeaking,
    isLoading: isTTSLoading,
    error: ttsError
  } = useElevenLabsTTS({
    onError: (err) => {
      logError('ElevenLabsTTS', new Error(err.message), { code: err.code });
      // Fallback to browser TTS if ElevenLabs fails
      if (err.code === 'API_KEY_MISSING' || err.code === 'TTS_ERROR') {
        console.warn('[TTS] Falling back to browser speech synthesis');
      }
    }
  });

  // ============================================================================
  // Error Handling Utilities
  // ============================================================================

  /**
   * Clear error after a delay
   */
  const clearErrorAfterDelay = useCallback((delay: number = 5000) => {
    setTimeout(() => {
      setError(prev => {
        if (prev?.recoverable) {
          return null;
        }
        return prev;
      });
    }, delay);
  }, []);

  /**
   * Set error with optional auto-clear
   */
  const setErrorWithAutoClear = useCallback((
    newError: VisionVoiceError,
    autoClear: boolean = true
  ) => {
    setError(newError);
    logError('VisionVoiceApp', new Error(newError.message), {
      type: newError.type,
      recoverable: newError.recoverable
    });
    if (autoClear && newError.recoverable) {
      clearErrorAfterDelay();
    }
  }, [clearErrorAfterDelay]);

  // Initialize rate limit from localStorage (survives page reloads)
  useEffect(() => {
    if (!rateLimitInitializedRef.current) {
      rateLimitInitializedRef.current = true;
      try {
        const stored = localStorage.getItem(RATE_LIMIT_STORAGE_KEY);
        if (stored) {
          const until = parseInt(stored, 10);
          if (until > Date.now()) {
            rateLimitUntilRef.current = until;
            console.log('[RateLimit] Restored cooldown, expires in', Math.ceil((until - Date.now()) / 1000), 'seconds');
          } else {
            localStorage.removeItem(RATE_LIMIT_STORAGE_KEY);
          }
        }
      } catch {
        // localStorage might not be available
      }
    }
  }, []);

  // Keep refs in sync with state (for use in callbacks to avoid stale closures)
  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

  useEffect(() => {
    isListeningRef.current = isListening;
  }, [isListening]);

  useEffect(() => {
    stopSpeakingRef.current = stopSpeaking;
  }, [stopSpeaking]);

  // ============================================================================
  // Network Status Monitoring
  // ============================================================================

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      // Auto-clear network error when back online
      setError(prev => {
        if (prev?.type === 'network') {
          return null;
        }
        return prev;
      });
    };

    const handleOffline = () => {
      setIsOnline(false);
      setErrorWithAutoClear({
        type: 'network',
        message: 'No internet connection. Please check your network.',
        recoverable: true,
        action: 'Will reconnect automatically when online'
      }, false); // Don't auto-clear network errors
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    setIsOnline(navigator.onLine);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [setErrorWithAutoClear]);

  // ============================================================================
  // Camera Setup
  // ============================================================================

  useEffect(() => {
    async function setupCamera() {
      try {
        // Check if camera is available
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error('Camera API not supported in this browser');
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false
        });

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          streamRef.current = stream;
        }

        // Clear any previous camera errors
        if (error?.type === 'camera') {
          setError(null);
        }
      } catch (err: unknown) {
        logError('setupCamera', err);

        let errorMessage = 'Could not access camera.';
        let action = 'Please grant camera permission and reload.';

        if (err instanceof DOMException) {
          switch (err.name) {
            case 'NotAllowedError':
            case 'PermissionDeniedError':
              errorMessage = 'Camera permission denied.';
              action = 'Please allow camera access in your browser settings.';
              break;
            case 'NotFoundError':
            case 'DevicesNotFoundError':
              errorMessage = 'No camera found.';
              action = 'Please connect a camera and reload.';
              break;
            case 'NotReadableError':
            case 'TrackStartError':
              errorMessage = 'Camera is in use by another app.';
              action = 'Please close other apps using the camera.';
              break;
            case 'OverconstrainedError':
              errorMessage = 'Camera does not meet requirements.';
              action = 'Trying with default settings...';
              // Try again with simpler constraints
              try {
                const fallbackStream = await navigator.mediaDevices.getUserMedia({
                  video: true,
                  audio: false
                });
                if (videoRef.current) {
                  videoRef.current.srcObject = fallbackStream;
                  streamRef.current = fallbackStream;
                }
                return; // Success with fallback
              } catch (fallbackErr) {
                logError('setupCamera:fallback', fallbackErr);
                action = 'Please try a different camera.';
              }
              break;
          }
        }

        setError({
          type: 'camera',
          message: errorMessage,
          recoverable: true,
          action
        });
      }
    }

    setupCamera();

    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => {
          try {
            track.stop();
          } catch {
            // Ignore track stop errors
          }
        });
      }
    };
  }, [error?.type]);

  // ============================================================================
  // Speech Recognition Setup
  // ============================================================================

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const SpeechRecognitionAPI = (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (!SpeechRecognitionAPI) {
      setSpeechRecognitionSupported(false);
      logError('SpeechRecognition', new Error('Speech Recognition not supported'));
      return;
    }

    // Request explicit microphone permission to ensure correct device is used
    const requestMicPermission = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        // Log which microphone is being used
        const audioTrack = stream.getAudioTracks()[0];
        console.log('[Microphone] Using:', audioTrack.label);
        // Stop the stream - we just needed permission
        stream.getTracks().forEach(track => track.stop());
      } catch (err) {
        console.error('[Microphone] Permission denied or error:', err);
      }
    };

    requestMicPermission();

    try {
      const recognition = new SpeechRecognitionAPI() as SpeechRecognition;
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      // Debug: Log when recognition actually starts
      recognition.onstart = () => {
        console.log('[SpeechRecognition] Started - listening for audio');
      };

      recognition.onaudiostart = () => {
        console.log('[SpeechRecognition] Audio capture started - microphone is active');
      };

      recognition.onspeechstart = () => {
        console.log('[SpeechRecognition] Speech detected!');
        // Stop any ongoing TTS when user starts speaking (interrupt)
        stopSpeakingRef.current();
      };

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        // Clear no-speech timeout on any result
        if (noSpeechTimeoutRef.current) {
          clearTimeout(noSpeechTimeoutRef.current);
          noSpeechTimeoutRef.current = null;
        }

        let finalTranscript = '';
        let interimTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          const transcript = result[0].transcript;

          if (result.isFinal) {
            finalTranscript += transcript;
          } else {
            interimTranscript += transcript;
          }
        }

        // Show interim results so user knows mic is working
        if (interimTranscript) {
          console.log('[SpeechRecognition] Interim:', interimTranscript);
          setTranscript(interimTranscript + '...');
        }

        if (finalTranscript) {
          console.log('[SpeechRecognition] Final:', finalTranscript);

          // Check for wake word or minimum word count to avoid accidental triggers
          const lowerTranscript = finalTranscript.toLowerCase().trim();
          const words = lowerTranscript.split(/\s+/).filter(w => w.length > 0);
          const hasWakeWord = WAKE_WORDS.some(wake => lowerTranscript.includes(wake));

          // Remove wake word from command if present
          let command = finalTranscript;
          if (hasWakeWord) {
            for (const wake of WAKE_WORDS) {
              const wakeRegex = new RegExp(wake + '[,.]?\\s*', 'gi');
              command = command.replace(wakeRegex, '').trim();
            }
          }

          // Only process if: has wake word, OR has enough words for intentional command
          if (hasWakeWord || words.length >= MIN_WORDS_WITHOUT_WAKE) {
            setTranscript(finalTranscript);
            // If wake word but no command, prompt user
            if (hasWakeWord && command.length === 0) {
              setTranscript('Listening...');
              // Don't process empty command, wait for more input
            } else {
              handleVoiceCommand(command || finalTranscript);
            }
          } else {
            console.log('[SpeechRecognition] Ignored (too short, no wake word):', finalTranscript);
          }
        }
      };

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        // Only log actual errors, not expected events like 'no-speech'
        if (event.error !== 'no-speech' && event.error !== 'aborted') {
          logError('SpeechRecognition:error', new Error(event.error), {
            message: event.message
          });
        }

        switch (event.error) {
          case 'no-speech':
            // This is normal - recognition will automatically restart via onend handler
            // Only show message if silence persists for extended period
            if (!noSpeechTimeoutRef.current) {
              noSpeechTimeoutRef.current = setTimeout(() => {
                // Only notify if still active and listening
                if (isActiveRef.current && isListeningRef.current) {
                  setErrorWithAutoClear({
                    type: 'speech',
                    message: 'No speech detected. Please speak clearly.',
                    recoverable: true,
                    action: 'Make sure your microphone is working'
                  });
                }
              }, SPEECH_NO_SPEECH_TIMEOUT);
            }
            break;

          case 'audio-capture':
            setErrorWithAutoClear({
              type: 'microphone',
              message: 'Microphone not available.',
              recoverable: true,
              action: 'Please check your microphone settings'
            });
            setIsListening(false);
            break;

          case 'not-allowed':
            setErrorWithAutoClear({
              type: 'microphone',
              message: 'Microphone permission denied.',
              recoverable: false,
              action: 'Please allow microphone access in browser settings'
            }, false);
            setIsListening(false);
            break;

          case 'network':
            setErrorWithAutoClear({
              type: 'network',
              message: 'Network error during speech recognition.',
              recoverable: true,
              action: 'Please check your internet connection'
            });
            break;

          case 'aborted':
            // User or system aborted - not an error to display
            break;

          default:
            setErrorWithAutoClear({
              type: 'speech',
              message: 'Speech recognition error.',
              recoverable: true,
              action: 'Please try speaking again'
            });
        }
      };

      recognition.onend = () => {
        // Clear no-speech timeout
        if (noSpeechTimeoutRef.current) {
          clearTimeout(noSpeechTimeoutRef.current);
          noSpeechTimeoutRef.current = null;
        }

        // Restart if still active and listening (use refs to get current values)
        if (isActiveRef.current && isListeningRef.current) {
          try {
            recognition.start();
          } catch (e) {
            // Already started or other error - ignore
            logError('SpeechRecognition:restart', e);
          }
        }
      };

      recognitionRef.current = recognition;
    } catch (err) {
      logError('SpeechRecognition:setup', err);
      setSpeechRecognitionSupported(false);
    }

    // Cleanup
    return () => {
      if (noSpeechTimeoutRef.current) {
        clearTimeout(noSpeechTimeoutRef.current);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setErrorWithAutoClear]);

  // ============================================================================
  // Canvas / Image Capture
  // ============================================================================

  /**
   * Capture frame from camera with comprehensive error handling
   */
  const captureFrame = useCallback((): string | null => {
    try {
      const video = videoRef.current;
      const canvas = canvasRef.current;

      if (!video || !canvas) {
        logError('captureFrame', new Error('Video or canvas element not available'));
        return null;
      }

      // Check if video is ready
      if (video.readyState < 2) { // HAVE_CURRENT_DATA
        logError('captureFrame', new Error('Video not ready'));
        return null;
      }

      if (video.videoWidth === 0 || video.videoHeight === 0) {
        logError('captureFrame', new Error('Video dimensions are zero'));
        return null;
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        setErrorWithAutoClear({
          type: 'canvas',
          message: 'Could not initialize canvas.',
          recoverable: true,
          action: 'Please try reloading the page'
        });
        return null;
      }

      // Set canvas dimensions
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      // Draw video frame to canvas
      try {
        ctx.drawImage(video, 0, 0);
      } catch (drawError) {
        logError('captureFrame:drawImage', drawError);
        setErrorWithAutoClear({
          type: 'canvas',
          message: 'Could not capture image.',
          recoverable: true,
          action: 'Please try again'
        });
        return null;
      }

      // Convert to data URL with quality optimization
      let quality = 0.8;
      let dataUrl: string;

      try {
        dataUrl = canvas.toDataURL('image/jpeg', quality);
      } catch (toDataUrlError) {
        logError('captureFrame:toDataURL', toDataUrlError);
        setErrorWithAutoClear({
          type: 'canvas',
          message: 'Could not process image.',
          recoverable: true,
          action: 'Please try again'
        });
        return null;
      }

      // Check if image is too large and reduce quality if needed
      const estimatedSizeMB = (dataUrl.length * 3 / 4) / (1024 * 1024);
      if (estimatedSizeMB > MAX_IMAGE_SIZE_MB) {
        // Reduce quality to fit within size limit
        quality = 0.5;
        try {
          dataUrl = canvas.toDataURL('image/jpeg', quality);
        } catch {
          // Use original if reduction fails
        }
      }

      return dataUrl;
    } catch (err) {
      logError('captureFrame:unexpected', err);
      setErrorWithAutoClear({
        type: 'canvas',
        message: 'Unexpected error capturing image.',
        recoverable: true,
        action: 'Please try again'
      });
      return null;
    }
  }, [setErrorWithAutoClear]);

  // ============================================================================
  // Vision API
  // ============================================================================

  /**
   * Analyze image with Gemini (with retry logic and timeout)
   */
  const analyzeImage = useCallback(async (query: string, attempt = 1): Promise<string> => {
    // Check if we're in rate limit cooldown
    const now = Date.now();
    if (rateLimitUntilRef.current > now) {
      const secondsRemaining = Math.ceil((rateLimitUntilRef.current - now) / 1000);
      console.log(`[Vision] Blocked by cooldown, ${secondsRemaining}s remaining`);
      return `API limit still active. Please wait ${secondsRemaining} more seconds.`;
    }

    // Check network status first
    if (!isOnline) {
      const errorMsg = 'No internet connection. Please check your network and try again.';
      setErrorWithAutoClear({
        type: 'network',
        message: errorMsg,
        recoverable: true,
        action: 'Check your internet connection'
      }, false);
      return errorMsg;
    }

    const imageData = captureFrame();
    if (!imageData) {
      const errorMsg = 'I could not capture an image. Please make sure the camera is working.';
      setErrorWithAutoClear({
        type: 'camera',
        message: errorMsg,
        recoverable: true,
        action: 'Check camera permissions'
      });
      return errorMsg;
    }

    setIsProcessing(true);
    setRetryCount(attempt - 1);
    requestCountRef.current++;
    console.log(`[Vision] Request #${requestCountRef.current} starting for query: "${query.substring(0, 50)}..."`);

    try {
      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT);

      const res = await fetch('/api/vision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: imageData, query }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));

        // Handle specific HTTP errors
        if (res.status === 401) {
          throw new Error('API_KEY_INVALID');
        } else if (res.status === 429) {
          // Extract retry time from response if available
          const retryAfter = errorData.retryAfter || 60;
          const cooldownUntil = Date.now() + (retryAfter * 1000);
          rateLimitUntilRef.current = cooldownUntil;
          // Persist to localStorage so it survives page reloads
          try {
            localStorage.setItem(RATE_LIMIT_STORAGE_KEY, cooldownUntil.toString());
          } catch { /* ignore */ }
          console.log(`[RateLimit] Hit! Cooldown set for ${retryAfter}s. Total requests this session: ${requestCountRef.current}`);
          throw new Error(`RATE_LIMITED:${retryAfter}`);
        } else if (res.status >= 500) {
          throw new Error('SERVER_ERROR');
        }

        throw new Error(errorData.error || 'Vision API request failed');
      }

      const data = await res.json();

      // Clear any previous API errors on success
      if (error?.type === 'api') {
        setError(null);
      }
      setRetryCount(0);

      // Clear rate limit on success - we're good to go
      rateLimitUntilRef.current = 0;
      try {
        localStorage.removeItem(RATE_LIMIT_STORAGE_KEY);
      } catch { /* ignore */ }

      console.log(`[Vision] Request #${requestCountRef.current} succeeded`);

      return data.description || 'I could not analyze the image.';

    } catch (err: unknown) {
      logError('analyzeImage', err, { attempt });

      // Handle abort/timeout
      if (err instanceof Error && err.name === 'AbortError') {
        const errorMsg = 'Request timed out. The server is taking too long to respond.';

        // Retry on timeout
        if (attempt < MAX_RETRIES) {
          console.log(`Retrying... attempt ${attempt + 1} of ${MAX_RETRIES}`);
          setIsProcessing(false);
          return analyzeImage(query, attempt + 1);
        }

        setErrorWithAutoClear({
          type: 'api',
          message: errorMsg,
          recoverable: true,
          action: 'Please try again'
        });
        return errorMsg;
      }

      // Handle specific errors
      if (err instanceof Error) {
        if (err.message === 'API_KEY_INVALID') {
          const errorMsg = 'The API is not configured correctly. Please contact support.';
          setError({
            type: 'api',
            message: errorMsg,
            recoverable: false,
            action: 'Configuration error'
          });
          return errorMsg;
        }

        if (err.message.startsWith('RATE_LIMITED')) {
          // Extract seconds from error message (format: RATE_LIMITED:30)
          const seconds = parseInt(err.message.split(':')[1]) || 60;
          const errorMsg = `Google's API limit reached. Please wait about ${seconds} seconds before trying again.`;
          setErrorWithAutoClear({
            type: 'api',
            message: errorMsg,
            recoverable: true,
            action: `Available again in ~${seconds}s`
          });
          return errorMsg;
        }

        if (err.message === 'SERVER_ERROR' || err.message.includes('fetch')) {
          // Retry on server errors
          if (attempt < MAX_RETRIES) {
            console.log(`Server error, retrying... attempt ${attempt + 1} of ${MAX_RETRIES}`);
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt)); // Exponential backoff
            setIsProcessing(false);
            return analyzeImage(query, attempt + 1);
          }
        }
      }

      // Generic error
      const errorMsg = 'I had trouble analyzing the image. Please try again.';
      setErrorWithAutoClear({
        type: 'api',
        message: errorMsg,
        recoverable: true,
        action: 'Tap the button to retry'
      });
      return errorMsg;

    } finally {
      setIsProcessing(false);
    }
  }, [captureFrame, isOnline, error?.type, setErrorWithAutoClear]);


  // ============================================================================
  // Voice Command Handler
  // ============================================================================

  const handleVoiceCommand = useCallback(async (command: string) => {
    const lowerCommand = command.toLowerCase();

    // Check for control commands first
    if (lowerCommand.includes('stop') || lowerCommand.includes('pause') || lowerCommand.includes('quiet')) {
      setIsActive(false);
      setIsListening(false);
      stopSpeaking();
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          // Ignore stop errors
        }
      }
      return;
    }

    if (lowerCommand.includes('help')) {
      const helpText = 'You can ask me things like: What do you see? Is there something in front of me? Read this text. Describe what you see.';
      setResponse(helpText);
      speak(helpText);
      return;
    }

    // Rate limiting - prevent too many requests too quickly
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTimeRef.current;
    if (timeSinceLastRequest < MIN_REQUEST_INTERVAL && lastRequestTimeRef.current > 0) {
      const waitTime = Math.ceil((MIN_REQUEST_INTERVAL - timeSinceLastRequest) / 1000);
      speak(`Please wait ${waitTime} seconds before asking another question.`);
      return;
    }

    // All other commands are treated as vision requests
    // The user has already triggered via wake word or intentional phrase
    lastRequestTimeRef.current = now;
    speak('Let me take a look...');
    const visionResponse = await analyzeImage(command);
    setResponse(visionResponse);
    speak(visionResponse);
  }, [analyzeImage, speak, stopSpeaking]);

  // ============================================================================
  // Quick Capture
  // ============================================================================

  const handleQuickCapture = useCallback(async () => {
    try {
      speak('Analyzing what I see...');
      const visionResponse = await analyzeImage('What do you see? Describe it in detail.');
      setResponse(visionResponse);
      speak(visionResponse);
    } catch (err) {
      logError('handleQuickCapture', err);
      speak('Sorry, I had trouble analyzing the image.');
    }
  }, [analyzeImage, speak]);

  // ============================================================================
  // Toggle Active State
  // ============================================================================

  const toggleActive = useCallback(() => {
    try {
      if ('vibrate' in navigator) {
        navigator.vibrate(isActive ? [100] : [100, 50, 100]);
      }
    } catch {
      // Ignore vibration errors
    }

    if (isActive) {
      // Deactivating
      setIsActive(false);
      setIsListening(false);
      stopSpeaking();

      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          // Ignore stop errors
        }
      }
    } else {
      // Activating
      setIsActive(true);
      setIsListening(true);
      speak('VisionVoice activated. Ask me what you want to see.');

      if (recognitionRef.current) {
        try {
          recognitionRef.current.start();
        } catch (e) {
          // Already started or not supported
          logError('toggleActive:startRecognition', e);
        }
      }
    }
  }, [isActive, speak, stopSpeaking]);

  // ============================================================================
  // Keyboard Accessibility
  // ============================================================================

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      try {
        if (e.code === 'Space' && !e.repeat && document.activeElement?.tagName !== 'INPUT') {
          e.preventDefault();
          toggleActive();
        }
      } catch (err) {
        logError('handleKeyDown', err);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleActive]);

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <main
      className="min-h-screen bg-black text-white flex flex-col relative overflow-hidden"
      role="application"
      aria-label="VisionVoice - AI Visual Assistant"
    >
      {/* Screen reader status */}
      <div role="status" aria-live="polite" className="sr-only">
        {isActive ? 'VisionVoice is active and listening' : 'VisionVoice is paused. Tap anywhere to start.'}
      </div>

      {/* Camera View */}
      <div className="flex-1 relative">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="absolute inset-0 w-full h-full object-cover"
          aria-hidden="true"
        />
        <canvas ref={canvasRef} className="hidden" aria-hidden="true" />

        {/* Overlay when inactive */}
        {!isActive && (
          <div
            className="absolute inset-0 bg-black/80 flex items-center justify-center backdrop-blur-sm"
            onClick={toggleActive}
          >
            <div className="text-center p-8 max-w-md">
              <div className="text-8xl mb-6" aria-hidden="true">&#9673;</div>
              <h1 className="text-4xl font-bold mb-3">VisionVoice</h1>
              <p className="text-xl text-gray-300 mb-2">AI Eyes That Speak</p>
              <p className="text-gray-500 mb-6">Tap anywhere or press Space to start</p>
              <div className="inline-flex items-center gap-2 bg-blue-600 px-6 py-3 rounded-full text-lg font-semibold">
                <span>Start</span>
              </div>
              {!speechRecognitionSupported && (
                <p className="text-yellow-400 text-sm mt-4">
                  Speech recognition not supported - use the capture button instead
                </p>
              )}
            </div>
          </div>
        )}

        {/* Status indicator */}
        {isActive && (
          <div className="absolute top-4 left-4 right-4 flex justify-between items-start">
            {/* Recording indicator */}
            <div className="flex items-center gap-2 bg-black/60 px-4 py-2 rounded-full backdrop-blur-sm">
              <div className={`w-3 h-3 rounded-full ${
                isSpeaking ? 'bg-blue-500 animate-pulse' :
                isTTSLoading ? 'bg-purple-500 animate-pulse' :
                isProcessing ? 'bg-yellow-500' :
                isListening ? 'bg-green-500 animate-pulse' :
                'bg-red-500'
              }`} />
              <span className="text-sm font-medium">
                {isSpeaking ? 'Speaking...' :
                 isTTSLoading ? 'Loading voice...' :
                 isProcessing ? 'Analyzing...' :
                 isListening ? 'Listening...' :
                 'Ready'}
              </span>
            </div>

            {/* Stop button */}
            <button
              onClick={toggleActive}
              className="bg-red-600 hover:bg-red-700 px-4 py-2 rounded-full text-sm font-semibold transition-colors"
              aria-label="Stop VisionVoice"
            >
              Stop
            </button>
          </div>
        )}
      </div>

      {/* Response area */}
      {isActive && (response || transcript) && (
        <div className="absolute bottom-24 left-4 right-4 bg-black/80 backdrop-blur-sm p-4 rounded-2xl max-h-48 overflow-y-auto">
          {transcript && (
            <p className="text-gray-400 text-sm mb-2">
              <span className="font-semibold text-gray-300">You:</span> {transcript}
            </p>
          )}
          {response && (
            <p className="text-white text-base leading-relaxed">
              <span className="font-semibold text-blue-400">VisionVoice:</span> {response}
            </p>
          )}
        </div>
      )}

      {/* Quick capture button */}
      {isActive && (
        <div className="absolute bottom-4 left-4 right-4 flex justify-center safe-area-bottom">
          <button
            onClick={handleQuickCapture}
            disabled={isProcessing}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 px-8 py-4 rounded-full text-lg font-semibold transition-colors flex items-center gap-3"
            aria-label="Capture and describe what's in view"
          >
            <span className="text-2xl" aria-hidden="true">&#9673;</span>
            <span>{isProcessing ? 'Analyzing...' : 'What do you see?'}</span>
          </button>
        </div>
      )}

      {/* Full screen activation button */}
      {!isActive && (
        <button
          onClick={toggleActive}
          className="absolute inset-0 cursor-pointer"
          aria-label="Tap to start VisionVoice"
        />
      )}

      {/* Error display */}
      {error && (
        <div
          role="alert"
          aria-live="assertive"
          className={`absolute top-4 left-4 right-4 p-4 rounded-xl ${error.recoverable ? 'bg-yellow-600' : 'bg-red-600'
            }`}
        >
          <div className="flex justify-between items-start">
            <div className="flex-1">
              <p className="font-semibold text-white">{error.message}</p>
              {error.action && (
                <p className="text-sm text-white/80 mt-1">{error.action}</p>
              )}
              {retryCount > 0 && (
                <p className="text-xs text-white/60 mt-1">
                  Retry attempt {retryCount} of {MAX_RETRIES}...
                </p>
              )}
            </div>
            <button
              onClick={() => setError(null)}
              className="ml-4 text-white/80 hover:text-white p-1"
              aria-label="Dismiss error"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          {error.recoverable && error.type !== 'network' && (
            <button
              onClick={() => {
                setError(null);
                if (error.type === 'camera') {
                  window.location.reload();
                }
              }}
              className="mt-3 w-full bg-white/20 hover:bg-white/30 text-white py-2 px-4 rounded-lg text-sm font-medium transition-colors"
            >
              {error.type === 'camera' ? 'Reload Page' : 'Try Again'}
            </button>
          )}
        </div>
      )}

      {/* Network status indicator */}
      {!isOnline && (
        <div className="absolute bottom-32 left-4 right-4 bg-orange-600 p-3 rounded-xl text-center">
          <p className="text-white text-sm font-medium">
            Offline - Waiting for connection...
          </p>
        </div>
      )}
    </main>
  );
}

// ============================================================================
// Export with Error Boundary
// ============================================================================

export default function Home() {
  return (
    <ErrorBoundary
      onError={(error, errorInfo) => {
        logError('ErrorBoundary:Home', error, {
          componentStack: errorInfo.componentStack
        });
      }}
    >
      <VisionVoiceApp />
    </ErrorBoundary>
  );
}
