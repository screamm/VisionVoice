/**
 * VisionVoice Error Types and Classes
 * Centralized error handling for the application
 */

// ============================================================================
// Error Type Enums
// ============================================================================

/**
 * Application error categories
 */
export enum ErrorCategory {
  CAMERA = 'camera',
  MICROPHONE = 'microphone',
  NETWORK = 'network',
  API = 'api',
  WEBSOCKET = 'websocket',
  AUDIO = 'audio',
  SPEECH = 'speech',
  VISION = 'vision',
  GENERAL = 'general'
}

/**
 * Error severity levels
 */
export enum ErrorSeverity {
  /** Informational - does not block functionality */
  INFO = 'info',
  /** Warning - degraded functionality but still usable */
  WARNING = 'warning',
  /** Error - functionality blocked but recoverable */
  ERROR = 'error',
  /** Critical - application cannot continue */
  CRITICAL = 'critical'
}

// ============================================================================
// Error Interfaces
// ============================================================================

/**
 * Structured application error
 */
export interface AppError {
  /** Error category for classification */
  category: ErrorCategory;
  /** Error severity level */
  severity: ErrorSeverity;
  /** User-friendly error message */
  message: string;
  /** Technical error details (for logging) */
  details?: string;
  /** Error code for programmatic handling */
  code?: string;
  /** Whether the error can be recovered from */
  recoverable: boolean;
  /** Suggested action for the user */
  action?: string;
  /** Number of retry attempts made */
  retryCount?: number;
  /** Maximum retry attempts allowed */
  maxRetries?: number;
  /** Original error object */
  originalError?: Error;
  /** Timestamp when error occurred */
  timestamp: number;
}

/**
 * WebSocket-specific error info
 */
export interface WebSocketErrorInfo {
  code?: number;
  reason?: string;
  wasClean?: boolean;
  url?: string;
  readyState?: number;
}

/**
 * Audio processing error info
 */
export interface AudioErrorInfo {
  operation: 'encode' | 'decode' | 'playback' | 'record' | 'context';
  sampleRate?: number;
  bufferSize?: number;
  channels?: number;
}

// ============================================================================
// Custom Error Classes
// ============================================================================

/**
 * Base error class for VisionVoice
 */
export class VisionVoiceError extends Error {
  public readonly category: ErrorCategory;
  public readonly severity: ErrorSeverity;
  public readonly recoverable: boolean;
  public readonly code?: string;
  public readonly timestamp: number;

  constructor(
    message: string,
    category: ErrorCategory = ErrorCategory.GENERAL,
    severity: ErrorSeverity = ErrorSeverity.ERROR,
    recoverable: boolean = true,
    code?: string
  ) {
    super(message);
    this.name = 'VisionVoiceError';
    this.category = category;
    this.severity = severity;
    this.recoverable = recoverable;
    this.code = code;
    this.timestamp = Date.now();

    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, VisionVoiceError);
    }
  }

  toAppError(): AppError {
    return {
      category: this.category,
      severity: this.severity,
      message: this.message,
      code: this.code,
      recoverable: this.recoverable,
      timestamp: this.timestamp,
      originalError: this
    };
  }
}

/**
 * WebSocket connection errors
 */
export class WebSocketError extends VisionVoiceError {
  public readonly wsInfo?: WebSocketErrorInfo;

  constructor(
    message: string,
    wsInfo?: WebSocketErrorInfo,
    recoverable: boolean = true
  ) {
    super(message, ErrorCategory.WEBSOCKET, ErrorSeverity.ERROR, recoverable, 'WEBSOCKET_ERROR');
    this.name = 'WebSocketError';
    this.wsInfo = wsInfo;
  }

  static connectionTimeout(url: string): WebSocketError {
    return new WebSocketError(
      'WebSocket connection timed out. The server may be unavailable.',
      { url },
      true
    );
  }

  static connectionFailed(url: string, reason?: string): WebSocketError {
    return new WebSocketError(
      `WebSocket connection failed${reason ? `: ${reason}` : ''}`,
      { url, reason },
      true
    );
  }

  static messageParseFailed(details?: string): WebSocketError {
    return new WebSocketError(
      `Failed to parse WebSocket message${details ? `: ${details}` : ''}`,
      undefined,
      true
    );
  }
}

/**
 * Audio processing errors
 */
export class AudioError extends VisionVoiceError {
  public readonly audioInfo?: AudioErrorInfo;

  constructor(
    message: string,
    audioInfo?: AudioErrorInfo,
    recoverable: boolean = true
  ) {
    super(message, ErrorCategory.AUDIO, ErrorSeverity.ERROR, recoverable, 'AUDIO_ERROR');
    this.name = 'AudioError';
    this.audioInfo = audioInfo;
  }

  static contextCreationFailed(details?: string): AudioError {
    return new AudioError(
      `Failed to create AudioContext${details ? `: ${details}` : ''}. Please refresh the page.`,
      { operation: 'context' },
      true
    );
  }

  static encodingFailed(details?: string): AudioError {
    return new AudioError(
      `Failed to encode audio${details ? `: ${details}` : ''}`,
      { operation: 'encode' },
      true
    );
  }

  static decodingFailed(details?: string): AudioError {
    return new AudioError(
      `Failed to decode audio${details ? `: ${details}` : ''}`,
      { operation: 'decode' },
      true
    );
  }

  static playbackFailed(details?: string): AudioError {
    return new AudioError(
      `Audio playback failed${details ? `: ${details}` : ''}`,
      { operation: 'playback' },
      true
    );
  }

  static recordingFailed(details?: string): AudioError {
    return new AudioError(
      `Failed to start recording${details ? `: ${details}` : ''}`,
      { operation: 'record' },
      true
    );
  }
}

/**
 * Vision API errors
 */
export class VisionError extends VisionVoiceError {
  public readonly statusCode?: number;

  constructor(
    message: string,
    statusCode?: number,
    recoverable: boolean = true
  ) {
    const code = statusCode ? `VISION_${statusCode}` : 'VISION_ERROR';
    super(message, ErrorCategory.VISION, ErrorSeverity.ERROR, recoverable, code);
    this.name = 'VisionError';
    this.statusCode = statusCode;
  }

  static timeout(): VisionError {
    return new VisionError('Image analysis took too long. Please try again.', 504, true);
  }

  static rateLimited(): VisionError {
    return new VisionError('Too many requests. Please wait a moment and try again.', 429, true);
  }

  static serverError(details?: string): VisionError {
    return new VisionError(
      `Server error${details ? `: ${details}` : ''}. Please try again.`,
      500,
      true
    );
  }

  static invalidImage(): VisionError {
    return new VisionError('The image could not be processed. Please try a different image.', 400, true);
  }
}

/**
 * Network-related errors
 */
export class NetworkError extends VisionVoiceError {
  constructor(message: string, recoverable: boolean = true) {
    super(message, ErrorCategory.NETWORK, ErrorSeverity.ERROR, recoverable, 'NETWORK_ERROR');
    this.name = 'NetworkError';
  }

  static offline(): NetworkError {
    return new NetworkError('No internet connection. Please check your network.', true);
  }

  static timeout(): NetworkError {
    return new NetworkError('Request timed out. Please check your connection and try again.', true);
  }
}

// ============================================================================
// Error Helper Functions
// ============================================================================

/**
 * Create a standardized AppError from any error
 */
export function createAppError(
  error: unknown,
  defaultCategory: ErrorCategory = ErrorCategory.GENERAL
): AppError {
  const timestamp = Date.now();

  // Handle VisionVoiceError instances
  if (error instanceof VisionVoiceError) {
    return error.toAppError();
  }

  // Handle standard Error
  if (error instanceof Error) {
    return {
      category: defaultCategory,
      severity: ErrorSeverity.ERROR,
      message: error.message || 'An unexpected error occurred',
      details: error.stack,
      recoverable: true,
      timestamp,
      originalError: error
    };
  }

  // Handle string errors
  if (typeof error === 'string') {
    return {
      category: defaultCategory,
      severity: ErrorSeverity.ERROR,
      message: error,
      recoverable: true,
      timestamp
    };
  }

  // Handle unknown errors
  return {
    category: defaultCategory,
    severity: ErrorSeverity.ERROR,
    message: 'An unexpected error occurred',
    details: String(error),
    recoverable: true,
    timestamp
  };
}

/**
 * Check if an error is recoverable
 */
export function isRecoverableError(error: unknown): boolean {
  if (error instanceof VisionVoiceError) {
    return error.recoverable;
  }
  return true; // Assume recoverable by default
}

/**
 * Get user-friendly message for common error scenarios
 */
export function getUserFriendlyMessage(error: unknown): string {
  if (error instanceof VisionVoiceError) {
    return error.message;
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    // Network errors
    if (message.includes('network') || message.includes('fetch')) {
      return 'Network error. Please check your connection.';
    }

    // Permission errors
    if (message.includes('permission') || message.includes('denied')) {
      return 'Permission denied. Please grant access and try again.';
    }

    // Timeout errors
    if (message.includes('timeout') || message.includes('abort')) {
      return 'Request timed out. Please try again.';
    }

    return error.message;
  }

  return 'An unexpected error occurred. Please try again.';
}

/**
 * Log error with consistent formatting
 */
export function logError(
  context: string,
  error: unknown,
  additionalInfo?: Record<string, unknown>
): void {
  const appError = createAppError(error);

  console.error(`[${context}]`, {
    category: appError.category,
    severity: appError.severity,
    message: appError.message,
    code: appError.code,
    recoverable: appError.recoverable,
    timestamp: new Date(appError.timestamp).toISOString(),
    ...additionalInfo,
    originalError: appError.originalError
  });
}
