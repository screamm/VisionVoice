import { useEffect, useRef, useCallback, useState } from 'react';
import {
  WebSocketError,
  AudioError,
  VisionError,
  logError,
  createAppError,
  ErrorCategory
} from '@/types/errors';

/**
 * ElevenLabs WebSocket connection states
 */
export enum ConnectionState {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  RECONNECTING = 'reconnecting',
  ERROR = 'error'
}

/**
 * Audio configuration constants
 */
const AUDIO_CONFIG = {
  SAMPLE_RATE: 16000,
  CHANNELS: 1,
  BIT_DEPTH: 16,
  BUFFER_SIZE: 4096
} as const;

/**
 * Connection configuration
 */
const CONNECTION_CONFIG = {
  /** WebSocket connection timeout in ms */
  CONNECTION_TIMEOUT: 15000,
  /** Maximum reconnection attempts */
  MAX_RECONNECT_ATTEMPTS: 3,
  /** Base delay for exponential backoff (ms) */
  RECONNECT_BASE_DELAY: 1000,
  /** Maximum audio queue size to prevent memory leaks */
  MAX_AUDIO_QUEUE_SIZE: 50,
  /** Vision API request timeout (ms) */
  VISION_API_TIMEOUT: 25000,
  /** Maximum vision API retry attempts */
  MAX_VISION_RETRIES: 2
} as const;

/**
 * WebSocket message types from ElevenLabs
 */
interface ElevenLabsMessage {
  type: 'audio' | 'transcript' | 'tool_call' | 'error' | 'conversation_initiation_metadata';
  audio?: string;
  transcript?: {
    text: string;
    role: 'user' | 'agent';
    timestamp: number;
  };
  tool_call?: {
    name: string;
    parameters: Record<string, unknown>;
    call_id: string;
  };
  error?: {
    message: string;
    code?: string;
  };
}

/**
 * Props for useElevenLabs hook
 */
interface UseElevenLabsProps {
  agentId: string;
  isActive: boolean;
  currentImage?: string;
  visionContext?: string;
  onTranscript?: (text: string, role: 'user' | 'agent') => void;
  onStatusChange?: (status: ConnectionState) => void;
  onError?: (error: Error) => void;
}

/**
 * Return type for useElevenLabs hook
 */
interface UseElevenLabsReturn {
  connectionState: ConnectionState;
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  isRecording: boolean;
  error: Error | null;
  reconnect: () => void;
}

/**
 * Custom hook for ElevenLabs Conversational AI integration
 * Handles WebSocket connection, audio streaming, and tool calls with comprehensive error handling
 */
export function useElevenLabs({
  agentId,
  isActive,
  currentImage,
  visionContext,
  onTranscript,
  onStatusChange,
  onError
}: UseElevenLabsProps): UseElevenLabsReturn {
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const playbackQueueRef = useRef<AudioBuffer[]>([]);
  const isPlayingRef = useRef(false);
  const connectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  /**
   * Clear all connection-related timeouts
   */
  const clearConnectionTimeouts = useCallback(() => {
    if (connectionTimeoutRef.current) {
      clearTimeout(connectionTimeoutRef.current);
      connectionTimeoutRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  /**
   * Update connection state and notify parent
   */
  const updateConnectionState = useCallback((state: ConnectionState) => {
    setConnectionState(state);
    onStatusChange?.(state);
  }, [onStatusChange]);

  /**
   * Handle errors consistently with logging
   */
  const handleError = useCallback((err: Error, context?: string) => {
    logError(context || 'useElevenLabs', err);
    setError(err);
    updateConnectionState(ConnectionState.ERROR);
    onError?.(err);
  }, [updateConnectionState, onError]);

  /**
   * Convert Float32Array to Int16Array (PCM16) with validation
   */
  const float32ToInt16 = useCallback((float32Array: Float32Array): Int16Array => {
    if (!float32Array || float32Array.length === 0) {
      throw new AudioError('Invalid audio data: empty buffer', { operation: 'encode' });
    }

    try {
      const int16Array = new Int16Array(float32Array.length);
      for (let i = 0; i < float32Array.length; i++) {
        const s = Math.max(-1, Math.min(1, float32Array[i]));
        int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }
      return int16Array;
    } catch (err) {
      throw AudioError.encodingFailed(err instanceof Error ? err.message : 'Unknown error');
    }
  }, []);

  /**
   * Process and send audio data to WebSocket with error handling
   */
  const sendAudioData = useCallback((audioData: Float32Array) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      return;
    }

    try {
      const int16Array = float32ToInt16(audioData);
      const base64Audio = btoa(
        String.fromCharCode(...new Uint8Array(int16Array.buffer))
      );

      wsRef.current.send(JSON.stringify({
        type: 'audio',
        audio: base64Audio
      }));
    } catch (err) {
      // Don't propagate audio send errors to avoid flooding - just log
      logError('sendAudioData', err);
    }
  }, [float32ToInt16]);

  /**
   * Play audio buffer through Web Audio API with error handling
   */
  const playAudioBuffer = useCallback(async (buffer: AudioBuffer): Promise<void> => {
    if (!audioContextRef.current) {
      throw AudioError.playbackFailed('AudioContext not initialized');
    }

    try {
      // Resume AudioContext if suspended (Safari requirement)
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }

      const source = audioContextRef.current.createBufferSource();
      source.buffer = buffer;
      source.connect(audioContextRef.current.destination);

      return new Promise<void>((resolve, reject) => {
        source.onended = () => resolve();
        source.onerror = () => reject(AudioError.playbackFailed('Source playback error'));
        source.start();
      });
    } catch (err) {
      throw AudioError.playbackFailed(err instanceof Error ? err.message : 'Unknown error');
    }
  }, []);

  /**
   * Process playback queue with memory management
   */
  const processPlaybackQueue = useCallback(async () => {
    if (isPlayingRef.current || playbackQueueRef.current.length === 0) {
      return;
    }

    isPlayingRef.current = true;

    while (playbackQueueRef.current.length > 0) {
      const buffer = playbackQueueRef.current.shift();
      if (buffer) {
        try {
          await playAudioBuffer(buffer);
        } catch (err) {
          // Log but continue playing remaining buffers
          logError('processPlaybackQueue', err);
        }
      }
    }

    isPlayingRef.current = false;
  }, [playAudioBuffer]);

  /**
   * Decode and queue audio from base64 PCM16 with validation
   */
  const handleAudioResponse = useCallback(async (base64Audio: string) => {
    if (!audioContextRef.current) {
      return;
    }

    // Memory management: limit queue size
    if (playbackQueueRef.current.length >= CONNECTION_CONFIG.MAX_AUDIO_QUEUE_SIZE) {
      logError('handleAudioResponse', new Error('Audio queue full, dropping oldest buffer'));
      playbackQueueRef.current.shift(); // Remove oldest
    }

    try {
      // Validate base64 input
      if (!base64Audio || typeof base64Audio !== 'string') {
        throw AudioError.decodingFailed('Invalid base64 audio data');
      }

      // Decode base64 to ArrayBuffer
      let binaryString: string;
      try {
        binaryString = atob(base64Audio);
      } catch {
        throw AudioError.decodingFailed('Invalid base64 encoding');
      }

      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Validate buffer size
      if (bytes.length === 0 || bytes.length % 2 !== 0) {
        throw AudioError.decodingFailed('Invalid PCM16 buffer size');
      }

      // Convert PCM16 to Float32
      const int16Array = new Int16Array(bytes.buffer);
      const float32Array = new Float32Array(int16Array.length);
      for (let i = 0; i < int16Array.length; i++) {
        float32Array[i] = int16Array[i] / (int16Array[i] < 0 ? 0x8000 : 0x7FFF);
      }

      // Create AudioBuffer
      const audioBuffer = audioContextRef.current.createBuffer(
        AUDIO_CONFIG.CHANNELS,
        float32Array.length,
        AUDIO_CONFIG.SAMPLE_RATE
      );
      audioBuffer.getChannelData(0).set(float32Array);

      // Queue for playback
      playbackQueueRef.current.push(audioBuffer);
      processPlaybackQueue();
    } catch (err) {
      if (err instanceof AudioError) {
        throw err;
      }
      throw AudioError.decodingFailed(err instanceof Error ? err.message : 'Unknown error');
    }
  }, [processPlaybackQueue]);

  /**
   * Handle tool calls from ElevenLabs with retry logic
   */
  const handleToolCall = useCallback(async (
    toolCall: NonNullable<ElevenLabsMessage['tool_call']>,
    attempt: number = 1
  ) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      return;
    }

    const sendToolResult = (result: unknown) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'tool_result',
          call_id: toolCall.call_id,
          result
        }));
      }
    };

    const sendToolError = (errorMessage: string) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'tool_result',
          call_id: toolCall.call_id,
          error: errorMessage
        }));
      }
    };

    try {
      if (toolCall.name === 'analyze_image') {
        // Validate image data
        if (!currentImage) {
          const error = VisionError.invalidImage();
          sendToolError('No image available for analysis');
          handleError(error, 'handleToolCall:analyze_image');
          return;
        }

        // Create abort controller for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(
          () => controller.abort(),
          CONNECTION_CONFIG.VISION_API_TIMEOUT
        );

        try {
          const response = await fetch('/api/vision', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              image: currentImage,
              context: visionContext
            }),
            signal: controller.signal
          });

          clearTimeout(timeoutId);

          if (!response.ok) {
            // Handle specific HTTP errors
            if (response.status === 429) {
              throw VisionError.rateLimited();
            }
            if (response.status >= 500) {
              // Retry on server errors
              if (attempt < CONNECTION_CONFIG.MAX_VISION_RETRIES) {
                const delay = CONNECTION_CONFIG.RECONNECT_BASE_DELAY * attempt;
                await new Promise(resolve => setTimeout(resolve, delay));
                return handleToolCall(toolCall, attempt + 1);
              }
              throw VisionError.serverError(`Status ${response.status}`);
            }

            const errorData = await response.json().catch(() => ({}));
            throw new VisionError(
              errorData.error || `Vision API error: ${response.statusText}`,
              response.status
            );
          }

          const result = await response.json();
          sendToolResult(result);
        } catch (fetchError) {
          clearTimeout(timeoutId);

          // Handle abort/timeout
          if (fetchError instanceof Error && fetchError.name === 'AbortError') {
            // Retry on timeout
            if (attempt < CONNECTION_CONFIG.MAX_VISION_RETRIES) {
              const delay = CONNECTION_CONFIG.RECONNECT_BASE_DELAY * attempt;
              await new Promise(resolve => setTimeout(resolve, delay));
              return handleToolCall(toolCall, attempt + 1);
            }
            throw VisionError.timeout();
          }

          throw fetchError;
        }
      } else {
        // Unknown tool call
        sendToolError(`Unknown tool: ${toolCall.name}`);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      sendToolError(errorMessage);
      handleError(
        err instanceof Error ? err : new Error(errorMessage),
        'handleToolCall'
      );
    }
  }, [currentImage, visionContext, handleError]);

  /**
   * Handle WebSocket messages with comprehensive error handling
   */
  const handleWebSocketMessage = useCallback((event: MessageEvent) => {
    let message: ElevenLabsMessage;

    try {
      message = JSON.parse(event.data);
    } catch (err) {
      handleError(
        WebSocketError.messageParseFailed(err instanceof Error ? err.message : undefined),
        'handleWebSocketMessage'
      );
      return;
    }

    try {
      switch (message.type) {
        case 'audio':
          if (message.audio) {
            handleAudioResponse(message.audio).catch(err => {
              // Audio errors are non-fatal, just log
              logError('handleAudioResponse', err);
            });
          }
          break;

        case 'transcript':
          if (message.transcript) {
            onTranscript?.(message.transcript.text, message.transcript.role);
          }
          break;

        case 'tool_call':
          if (message.tool_call) {
            handleToolCall(message.tool_call);
          }
          break;

        case 'error':
          if (message.error) {
            handleError(
              new WebSocketError(message.error.message),
              'ElevenLabs:server_error'
            );
          }
          break;

        case 'conversation_initiation_metadata':
          // Connection established successfully
          clearConnectionTimeouts();
          reconnectAttemptsRef.current = 0;
          updateConnectionState(ConnectionState.CONNECTED);
          setError(null);
          break;

        default:
          logError('handleWebSocketMessage', new Error(`Unknown message type: ${(message as any).type}`));
      }
    } catch (err) {
      handleError(
        err instanceof Error ? err : new Error('Message handling failed'),
        'handleWebSocketMessage'
      );
    }
  }, [handleAudioResponse, handleToolCall, onTranscript, updateConnectionState, handleError, clearConnectionTimeouts]);

  /**
   * Schedule reconnection with exponential backoff
   */
  const scheduleReconnect = useCallback(() => {
    if (reconnectAttemptsRef.current >= CONNECTION_CONFIG.MAX_RECONNECT_ATTEMPTS) {
      handleError(
        WebSocketError.connectionFailed(
          `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${agentId}`,
          `Max reconnection attempts (${CONNECTION_CONFIG.MAX_RECONNECT_ATTEMPTS}) exceeded`
        ),
        'scheduleReconnect'
      );
      return;
    }

    const delay = CONNECTION_CONFIG.RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttemptsRef.current);
    reconnectAttemptsRef.current += 1;

    updateConnectionState(ConnectionState.RECONNECTING);

    reconnectTimeoutRef.current = setTimeout(() => {
      connectWebSocket();
    }, delay);
  }, [agentId, handleError, updateConnectionState]);

  /**
   * Initialize WebSocket connection with timeout
   */
  const connectWebSocket = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    // Clear existing connection
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    clearConnectionTimeouts();

    try {
      updateConnectionState(ConnectionState.CONNECTING);

      const wsUrl = `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${agentId}`;
      const ws = new WebSocket(wsUrl);

      // Set connection timeout
      connectionTimeoutRef.current = setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          ws.close();
          handleError(
            WebSocketError.connectionTimeout(wsUrl),
            'connectWebSocket:timeout'
          );
          scheduleReconnect();
        }
      }, CONNECTION_CONFIG.CONNECTION_TIMEOUT);

      ws.onopen = () => {
        console.log('[ElevenLabs] WebSocket connected, waiting for initialization...');
        // Note: Connection state updated when we receive conversation_initiation_metadata
      };

      ws.onmessage = handleWebSocketMessage;

      ws.onerror = (event) => {
        clearConnectionTimeouts();
        const error = WebSocketError.connectionFailed(
          wsUrl,
          'Connection error occurred'
        );
        logError('WebSocket:onerror', error, { event: String(event) });
        // Don't update error state here - let onclose handle it
      };

      ws.onclose = (event) => {
        clearConnectionTimeouts();
        console.log('[ElevenLabs] WebSocket disconnected', {
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean
        });

        wsRef.current = null;

        // Handle abnormal closure
        if (!event.wasClean && event.code !== 1000) {
          scheduleReconnect();
        } else {
          updateConnectionState(ConnectionState.DISCONNECTED);
        }
      };

      wsRef.current = ws;
    } catch (err) {
      clearConnectionTimeouts();
      handleError(
        err instanceof Error ? err : new Error('Failed to create WebSocket'),
        'connectWebSocket'
      );
    }
  }, [agentId, handleWebSocketMessage, updateConnectionState, handleError, clearConnectionTimeouts, scheduleReconnect]);

  /**
   * Disconnect WebSocket cleanly
   */
  const disconnectWebSocket = useCallback(() => {
    clearConnectionTimeouts();
    reconnectAttemptsRef.current = 0;

    if (wsRef.current) {
      wsRef.current.close(1000, 'User disconnected');
      wsRef.current = null;
    }
    updateConnectionState(ConnectionState.DISCONNECTED);
  }, [updateConnectionState, clearConnectionTimeouts]);

  /**
   * Manual reconnection trigger
   */
  const reconnect = useCallback(() => {
    reconnectAttemptsRef.current = 0;
    setError(null);
    connectWebSocket();
  }, [connectWebSocket]);

  /**
   * Create AudioContext with error handling
   */
  const createAudioContext = useCallback(async (): Promise<AudioContext> => {
    try {
      const context = new AudioContext({
        sampleRate: AUDIO_CONFIG.SAMPLE_RATE
      });

      // Handle Safari autoplay restrictions
      if (context.state === 'suspended') {
        await context.resume();
      }

      return context;
    } catch (err) {
      throw AudioError.contextCreationFailed(
        err instanceof Error ? err.message : 'Unknown error'
      );
    }
  }, []);

  /**
   * Start audio recording with comprehensive error handling
   */
  const startRecording = useCallback(async () => {
    if (isRecording) {
      return;
    }

    try {
      // Initialize AudioContext
      if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
        audioContextRef.current = await createAudioContext();
      }

      // Resume if suspended
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }

      // Get microphone access
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            sampleRate: AUDIO_CONFIG.SAMPLE_RATE,
            channelCount: AUDIO_CONFIG.CHANNELS,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        });
      } catch (micError) {
        if (micError instanceof Error) {
          if (micError.name === 'NotAllowedError') {
            throw AudioError.recordingFailed('Microphone permission denied');
          }
          if (micError.name === 'NotFoundError') {
            throw AudioError.recordingFailed('No microphone found');
          }
        }
        throw AudioError.recordingFailed(
          micError instanceof Error ? micError.message : 'Unknown error'
        );
      }

      mediaStreamRef.current = stream;

      // Create MediaStreamSource
      const source = audioContextRef.current.createMediaStreamSource(stream);

      // Create ScriptProcessorNode for audio processing
      const processor = audioContextRef.current.createScriptProcessor(
        AUDIO_CONFIG.BUFFER_SIZE,
        AUDIO_CONFIG.CHANNELS,
        AUDIO_CONFIG.CHANNELS
      );

      processor.onaudioprocess = (event) => {
        const inputData = event.inputBuffer.getChannelData(0);
        sendAudioData(inputData);
      };

      source.connect(processor);
      processor.connect(audioContextRef.current.destination);
      processorRef.current = processor;

      // Connect WebSocket if not connected
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        connectWebSocket();
      }

      setIsRecording(true);
      setError(null);
    } catch (err) {
      const error = err instanceof AudioError
        ? err
        : AudioError.recordingFailed(err instanceof Error ? err.message : 'Unknown error');
      handleError(error, 'startRecording');
    }
  }, [isRecording, sendAudioData, connectWebSocket, handleError, createAudioContext]);

  /**
   * Stop audio recording and clean up resources
   */
  const stopRecording = useCallback(() => {
    if (!isRecording) {
      return;
    }

    try {
      // Stop all media tracks
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(track => {
          try {
            track.stop();
          } catch {
            // Ignore track stop errors
          }
        });
        mediaStreamRef.current = null;
      }

      // Disconnect processor
      if (processorRef.current) {
        try {
          processorRef.current.disconnect();
        } catch {
          // Ignore disconnect errors
        }
        processorRef.current = null;
      }

      setIsRecording(false);
    } catch (err) {
      logError('stopRecording', err);
      setIsRecording(false);
    }
  }, [isRecording]);

  /**
   * Cleanup on unmount or when inactive
   */
  useEffect(() => {
    if (!isActive) {
      stopRecording();
      disconnectWebSocket();

      // Close AudioContext
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        try {
          audioContextRef.current.close();
        } catch {
          // Ignore close errors
        }
        audioContextRef.current = null;
      }

      // Clear playback queue
      playbackQueueRef.current = [];
      isPlayingRef.current = false;
    }

    return () => {
      stopRecording();
      disconnectWebSocket();
      clearConnectionTimeouts();

      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        try {
          audioContextRef.current.close();
        } catch {
          // Ignore close errors
        }
        audioContextRef.current = null;
      }
    };
  }, [isActive, stopRecording, disconnectWebSocket, clearConnectionTimeouts]);

  return {
    connectionState,
    startRecording,
    stopRecording,
    isRecording,
    error,
    reconnect
  };
}
