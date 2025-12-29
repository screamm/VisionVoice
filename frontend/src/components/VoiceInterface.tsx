'use client';

import { useEffect, useState, useCallback } from 'react';
import { useElevenLabs, ConnectionState } from '@/hooks/useElevenLabs';

/**
 * Transcript entry interface
 */
interface TranscriptEntry {
  id: string;
  text: string;
  role: 'user' | 'agent';
  timestamp: number;
}

/**
 * Props for VoiceInterface component
 */
interface VoiceInterfaceProps {
  /** Whether the voice interface is active */
  isActive: boolean;
  /** Current image data (base64) for vision analysis */
  currentImage?: string;
  /** Additional context for vision analysis */
  visionContext?: string;
  /** Callback when new transcript is received */
  onTranscript?: (text: string, role: 'user' | 'agent') => void;
  /** Callback when connection status changes */
  onStatusChange?: (status: ConnectionState) => void;
  /** Optional CSS class name */
  className?: string;
}

/**
 * VoiceInterface Component
 *
 * Provides a complete voice interaction interface using ElevenLabs Conversational AI.
 * Handles real-time audio streaming, transcription, and vision analysis tool calls.
 *
 * @example
 * ```tsx
 * <VoiceInterface
 *   isActive={true}
 *   currentImage={base64ImageData}
 *   visionContext="Analyze this image"
 *   onTranscript={(text, role) => console.log(`${role}: ${text}`)}
 *   onStatusChange={(status) => console.log('Status:', status)}
 * />
 * ```
 */
export function VoiceInterface({
  isActive,
  currentImage,
  visionContext,
  onTranscript,
  onStatusChange,
  className = ''
}: VoiceInterfaceProps) {
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const [agentId, setAgentId] = useState<string>('');
  const [mounted, setMounted] = useState(false);

  /**
   * Handle transcript updates
   */
  const handleTranscript = useCallback((text: string, role: 'user' | 'agent') => {
    const entry: TranscriptEntry = {
      id: `${Date.now()}-${Math.random()}`,
      text,
      role,
      timestamp: Date.now()
    };

    setTranscripts(prev => [...prev, entry]);
    onTranscript?.(text, role);
  }, [onTranscript]);

  /**
   * Initialize agent ID from environment
   */
  useEffect(() => {
    const id = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID;
    if (!id) {
      console.error('[VoiceInterface] Missing NEXT_PUBLIC_ELEVENLABS_AGENT_ID environment variable');
    } else {
      setAgentId(id);
    }
    setMounted(true);
  }, []);

  /**
   * Initialize ElevenLabs hook
   */
  const {
    connectionState,
    startRecording,
    stopRecording,
    isRecording,
    error,
    reconnect
  } = useElevenLabs({
    agentId,
    isActive: isActive && mounted && !!agentId,
    currentImage,
    visionContext,
    onTranscript: handleTranscript,
    onStatusChange,
    onError: (err) => {
      console.error('[VoiceInterface] Error:', err);
    }
  });

  /**
   * Handle record button click
   */
  const handleRecordToggle = useCallback(async () => {
    if (isRecording) {
      stopRecording();
    } else {
      await startRecording();
    }
  }, [isRecording, startRecording, stopRecording]);

  /**
   * Clear transcript history
   */
  const handleClearTranscripts = useCallback(() => {
    setTranscripts([]);
  }, []);

  /**
   * Get status color based on connection state
   */
  const getStatusColor = useCallback(() => {
    switch (connectionState) {
      case ConnectionState.CONNECTED:
        return 'bg-green-500';
      case ConnectionState.CONNECTING:
        return 'bg-yellow-500';
      case ConnectionState.RECONNECTING:
        return 'bg-orange-500 animate-pulse';
      case ConnectionState.ERROR:
        return 'bg-red-500';
      default:
        return 'bg-gray-500';
    }
  }, [connectionState]);

  /**
   * Get status text
   */
  const getStatusText = useCallback(() => {
    switch (connectionState) {
      case ConnectionState.CONNECTED:
        return 'Connected';
      case ConnectionState.CONNECTING:
        return 'Connecting...';
      case ConnectionState.RECONNECTING:
        return 'Reconnecting...';
      case ConnectionState.ERROR:
        return 'Error';
      default:
        return 'Disconnected';
    }
  }, [connectionState]);

  // Don't render until mounted (prevents hydration mismatch)
  if (!mounted) {
    return null;
  }

  // Show error if agent ID is missing
  if (!agentId) {
    return (
      <div className={`voice-interface-error ${className}`}>
        <div className="error-message">
          <svg
            className="error-icon"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <h3>Configuration Error</h3>
          <p>Missing NEXT_PUBLIC_ELEVENLABS_AGENT_ID environment variable</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`voice-interface ${className}`}>
      {/* Header with status indicator */}
      <div className="voice-interface-header">
        <div className="status-indicator">
          <div className={`status-dot ${getStatusColor()}`} />
          <span className="status-text">{getStatusText()}</span>
        </div>

        {transcripts.length > 0 && (
          <button
            onClick={handleClearTranscripts}
            className="clear-button"
            aria-label="Clear transcripts"
          >
            Clear
          </button>
        )}
      </div>

      {/* Transcript display */}
      <div className="transcript-container">
        {transcripts.length === 0 ? (
          <div className="transcript-empty">
            <p>Start recording to begin conversation</p>
          </div>
        ) : (
          <div className="transcript-list">
            {transcripts.map((entry) => (
              <div
                key={entry.id}
                className={`transcript-entry transcript-${entry.role}`}
              >
                <div className="transcript-role">
                  {entry.role === 'user' ? 'You' : 'Agent'}
                </div>
                <div className="transcript-text">{entry.text}</div>
                <div className="transcript-timestamp">
                  {new Date(entry.timestamp).toLocaleTimeString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Error display */}
      {error && (
        <div className="error-banner" role="alert" aria-live="assertive">
          <svg
            className="error-banner-icon"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <span>{error.message}</span>
          {connectionState === ConnectionState.ERROR && (
            <button
              onClick={reconnect}
              className="reconnect-button"
              aria-label="Reconnect to voice service"
            >
              Retry
            </button>
          )}
        </div>
      )}

      {/* Controls */}
      <div className="voice-interface-controls">
        <button
          onClick={handleRecordToggle}
          disabled={!isActive || connectionState === ConnectionState.ERROR}
          className={`record-button ${isRecording ? 'recording' : ''}`}
          aria-label={isRecording ? 'Stop recording' : 'Start recording'}
        >
          {isRecording ? (
            <>
              <svg
                className="record-icon"
                fill="currentColor"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
              <span>Stop</span>
            </>
          ) : (
            <>
              <svg
                className="record-icon"
                fill="currentColor"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <circle cx="12" cy="12" r="8" />
              </svg>
              <span>Record</span>
            </>
          )}
        </button>
      </div>

      <style jsx>{`
        .voice-interface {
          display: flex;
          flex-direction: column;
          height: 100%;
          background: white;
          border-radius: 8px;
          overflow: hidden;
        }

        .voice-interface-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px;
          border-bottom: 1px solid #e5e7eb;
        }

        .status-indicator {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
        }

        .status-text {
          font-size: 14px;
          font-weight: 500;
          color: #374151;
        }

        .clear-button {
          padding: 6px 12px;
          font-size: 14px;
          color: #6b7280;
          background: transparent;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .clear-button:hover {
          background: #f9fafb;
          border-color: #9ca3af;
        }

        .transcript-container {
          flex: 1;
          overflow-y: auto;
          padding: 16px;
          min-height: 200px;
        }

        .transcript-empty {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100%;
          color: #9ca3af;
          font-size: 14px;
        }

        .transcript-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .transcript-entry {
          padding: 12px;
          border-radius: 8px;
          background: #f9fafb;
        }

        .transcript-user {
          background: #eff6ff;
          margin-left: 20%;
        }

        .transcript-agent {
          background: #f3f4f6;
          margin-right: 20%;
        }

        .transcript-role {
          font-size: 12px;
          font-weight: 600;
          color: #6b7280;
          margin-bottom: 4px;
        }

        .transcript-text {
          font-size: 14px;
          color: #1f2937;
          line-height: 1.5;
          margin-bottom: 4px;
        }

        .transcript-timestamp {
          font-size: 11px;
          color: #9ca3af;
        }

        .error-banner {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 12px 16px;
          background: #fef2f2;
          border-top: 1px solid #fecaca;
          color: #991b1b;
          font-size: 14px;
        }

        .error-banner-icon {
          width: 20px;
          height: 20px;
          flex-shrink: 0;
        }

        .reconnect-button {
          margin-left: auto;
          padding: 4px 12px;
          font-size: 12px;
          font-weight: 600;
          color: #991b1b;
          background: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .reconnect-button:hover {
          background: #fef2f2;
        }

        .voice-interface-controls {
          padding: 16px;
          border-top: 1px solid #e5e7eb;
          background: #f9fafb;
        }

        .record-button {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          width: 100%;
          padding: 12px 24px;
          font-size: 16px;
          font-weight: 600;
          color: white;
          background: #3b82f6;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .record-button:hover:not(:disabled) {
          background: #2563eb;
        }

        .record-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .record-button.recording {
          background: #ef4444;
        }

        .record-button.recording:hover:not(:disabled) {
          background: #dc2626;
        }

        .record-icon {
          width: 20px;
          height: 20px;
        }

        .voice-interface-error {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 32px;
          background: #fef2f2;
          border-radius: 8px;
        }

        .error-message {
          text-align: center;
          max-width: 400px;
        }

        .error-icon {
          width: 48px;
          height: 48px;
          margin: 0 auto 16px;
          color: #dc2626;
        }

        .error-message h3 {
          font-size: 18px;
          font-weight: 600;
          color: #991b1b;
          margin-bottom: 8px;
        }

        .error-message p {
          font-size: 14px;
          color: #b91c1c;
        }
      `}</style>
    </div>
  );
}
