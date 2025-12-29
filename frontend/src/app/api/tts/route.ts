import { NextRequest, NextResponse } from 'next/server';

// ElevenLabs API configuration
const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1';

// Default voice ID - "Rachel" as fallback
const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM';

// Request timeout (15 seconds)
const REQUEST_TIMEOUT = 15000;

// Cache for agent voice ID (refreshes every 5 minutes)
let cachedAgentVoiceId: string | null = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch the voice ID from the ElevenLabs agent configuration
 * This ensures TTS uses the same voice as the conversational AI agent
 */
async function getAgentVoiceId(apiKey: string): Promise<string | null> {
  const agentId = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID;
  if (!agentId) return null;

  // Return cached value if still valid
  if (cachedAgentVoiceId && Date.now() - cacheTimestamp < CACHE_DURATION) {
    return cachedAgentVoiceId;
  }

  try {
    const response = await fetch(
      `${ELEVENLABS_API_URL}/convai/agents/${agentId}`,
      {
        headers: { 'xi-api-key': apiKey },
      }
    );

    if (!response.ok) {
      // API key might not have convai_read permission
      console.log('[TTS] Could not fetch agent config, using fallback voice');
      return null;
    }

    const agent = await response.json();

    // Extract voice ID from agent's TTS configuration
    const voiceId = agent?.conversation_config?.tts?.voice_id;

    if (voiceId) {
      cachedAgentVoiceId = voiceId;
      cacheTimestamp = Date.now();
      console.log(`[TTS] Using agent voice: ${voiceId}`);
      return voiceId;
    }
  } catch (error) {
    console.log('[TTS] Failed to fetch agent config:', error);
  }

  return null;
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    // Check API key
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      console.error('ELEVENLABS_API_KEY is not configured');
      return NextResponse.json(
        {
          error: 'TTS not configured',
          details: 'ElevenLabs API key is missing. Please add ELEVENLABS_API_KEY to your environment variables.',
          code: 'API_KEY_MISSING'
        },
        { status: 500 }
      );
    }

    // Parse request body
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid request body', details: 'Could not parse JSON', code: 'INVALID_JSON' },
        { status: 400 }
      );
    }

    const { text, voiceId } = body;

    // Validate text
    if (!text || typeof text !== 'string') {
      return NextResponse.json(
        { error: 'No text provided', details: 'Please provide text to convert to speech', code: 'NO_TEXT' },
        { status: 400 }
      );
    }

    // Limit text length (ElevenLabs has limits)
    if (text.length > 5000) {
      return NextResponse.json(
        { error: 'Text too long', details: 'Text must be under 5000 characters', code: 'TEXT_TOO_LONG' },
        { status: 400 }
      );
    }

    // Voice selection priority:
    // 1. Explicit voiceId from request
    // 2. Agent's configured voice (auto-synced)
    // 3. ELEVENLABS_VOICE_ID environment variable
    // 4. Default fallback voice
    let selectedVoiceId = voiceId;

    if (!selectedVoiceId) {
      // Try to get voice from agent config (auto-sync feature)
      const agentVoiceId = await getAgentVoiceId(apiKey);
      selectedVoiceId = agentVoiceId || process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;
    }

    // Call ElevenLabs TTS API
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    let response;
    try {
      response = await fetch(
        `${ELEVENLABS_API_URL}/text-to-speech/${selectedVoiceId}`,
        {
          method: 'POST',
          headers: {
            'Accept': 'audio/mpeg',
            'Content-Type': 'application/json',
            'xi-api-key': apiKey,
          },
          body: JSON.stringify({
            text,
            model_id: 'eleven_turbo_v2_5',
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.75,
              style: 0.0,
              use_speaker_boost: true
            }
          }),
          signal: controller.signal
        }
      );
    } finally {
      clearTimeout(timeoutId);
    }

    // Handle API errors
    if (!response.ok) {
      const errorText = await response.text();
      console.error('ElevenLabs TTS error:', response.status, errorText);

      if (response.status === 401) {
        return NextResponse.json(
          { error: 'Invalid API key', details: 'Please check your ElevenLabs API key', code: 'INVALID_API_KEY' },
          { status: 401 }
        );
      }

      if (response.status === 429) {
        return NextResponse.json(
          { error: 'Rate limited', details: 'Too many requests. Please wait and try again.', code: 'RATE_LIMITED' },
          { status: 429 }
        );
      }

      if (response.status === 400 && errorText.includes('voice_id')) {
        return NextResponse.json(
          { error: 'Invalid voice', details: 'The selected voice ID is not valid', code: 'INVALID_VOICE' },
          { status: 400 }
        );
      }

      return NextResponse.json(
        { error: 'TTS failed', details: errorText || 'Unknown error', code: 'TTS_ERROR' },
        { status: response.status }
      );
    }

    // Get audio data
    const audioBuffer = await response.arrayBuffer();
    const processingTime = Date.now() - startTime;
    console.log(`TTS processed in ${processingTime}ms (${text.length} chars)`);

    // Return audio as MP3
    return new NextResponse(audioBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': audioBuffer.byteLength.toString(),
        'X-Processing-Time': processingTime.toString(),
      },
    });

  } catch (error: unknown) {
    const processingTime = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('TTS API error:', errorMessage, `(after ${processingTime}ms)`);

    // Handle abort/timeout
    if (error instanceof Error && error.name === 'AbortError') {
      return NextResponse.json(
        { error: 'Request timeout', details: 'The request took too long to process', code: 'TIMEOUT' },
        { status: 504 }
      );
    }

    // Handle network errors
    if (error instanceof Error && (error.message.includes('fetch') || error.message.includes('network'))) {
      return NextResponse.json(
        { error: 'Connection failed', details: 'Could not connect to ElevenLabs service', code: 'CONNECTION_ERROR' },
        { status: 503 }
      );
    }

    // Generic error
    return NextResponse.json(
      { error: 'TTS failed', details: errorMessage, code: 'UNKNOWN_ERROR' },
      { status: 500 }
    );
  }
}

// Handle OPTIONS for CORS
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
