import { GoogleGenerativeAI, GoogleGenerativeAIError } from '@google/generative-ai';
import { NextRequest, NextResponse } from 'next/server';

// Initialize the Google AI client (with validation)
const apiKey = process.env.GOOGLE_API_KEY;
const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;

// Maximum image size (5MB)
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

// Request timeout (25 seconds to allow for slow responses)
const REQUEST_TIMEOUT = 25000;

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    // Check API key configuration first
    if (!apiKey || !genAI) {
      console.error('GOOGLE_API_KEY is not configured');
      return NextResponse.json(
        {
          error: 'API not configured',
          details: 'Google API key is missing. Please add GOOGLE_API_KEY to your environment variables.',
          code: 'API_KEY_MISSING'
        },
        { status: 500 }
      );
    }

    // Parse request body with error handling
    let body;
    try {
      body = await request.json();
    } catch (parseError) {
      return NextResponse.json(
        { error: 'Invalid request body', details: 'Could not parse JSON', code: 'INVALID_JSON' },
        { status: 400 }
      );
    }

    const { image, query } = body;

    // Validate image
    if (!image) {
      return NextResponse.json(
        { error: 'No image provided', details: 'Please provide an image in the request', code: 'NO_IMAGE' },
        { status: 400 }
      );
    }

    if (typeof image !== 'string') {
      return NextResponse.json(
        { error: 'Invalid image format', details: 'Image must be a base64 string', code: 'INVALID_IMAGE_FORMAT' },
        { status: 400 }
      );
    }

    // Check image size (rough estimate from base64)
    const estimatedSize = (image.length * 3) / 4;
    if (estimatedSize > MAX_IMAGE_SIZE) {
      return NextResponse.json(
        { error: 'Image too large', details: 'Please use an image smaller than 5MB', code: 'IMAGE_TOO_LARGE' },
        { status: 400 }
      );
    }

    // Remove data URL prefix to get raw base64
    const base64Image = image.replace(/^data:image\/\w+;base64,/, '');

    // Validate base64
    if (!/^[A-Za-z0-9+/=]+$/.test(base64Image)) {
      return NextResponse.json(
        { error: 'Invalid image data', details: 'Image is not valid base64', code: 'INVALID_BASE64' },
        { status: 400 }
      );
    }

    // Use Gemini 2.5 Flash for speed and vision capabilities
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: {
        maxOutputTokens: 500,
        temperature: 0.4,
      }
    });

    // Build the prompt based on user query
    const prompt = buildVisionPrompt(query);

    // Call Gemini Vision API with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    let result;
    try {
      result = await model.generateContent([
        prompt,
        {
          inlineData: {
            mimeType: 'image/jpeg',
            data: base64Image
          }
        }
      ]);
    } finally {
      clearTimeout(timeoutId);
    }

    const response = result.response;
    const description = response.text();

    // Check for empty response
    if (!description || description.trim().length === 0) {
      return NextResponse.json(
        { error: 'Empty response', details: 'The AI could not analyze this image', code: 'EMPTY_RESPONSE' },
        { status: 500 }
      );
    }

    const processingTime = Date.now() - startTime;
    console.log(`Vision API processed in ${processingTime}ms`);

    return NextResponse.json({
      description,
      timestamp: new Date().toISOString(),
      processingTime
    });

  } catch (error: any) {
    const processingTime = Date.now() - startTime;
    console.error('Vision API error:', error.message || error, `(after ${processingTime}ms)`);

    // Handle abort/timeout
    if (error.name === 'AbortError') {
      return NextResponse.json(
        { error: 'Request timeout', details: 'The request took too long to process', code: 'TIMEOUT' },
        { status: 504 }
      );
    }

    // Handle Google AI specific errors
    if (error instanceof GoogleGenerativeAIError || error.constructor?.name === 'GoogleGenerativeAIError') {
      const errorMessage = error.message || '';

      if (errorMessage.includes('API key')) {
        return NextResponse.json(
          { error: 'Invalid API key', details: 'Please check your Google API key', code: 'INVALID_API_KEY' },
          { status: 401 }
        );
      }

      if (errorMessage.includes('quota') || errorMessage.includes('rate')) {
        return NextResponse.json(
          { error: 'Rate limited', details: 'Too many requests. Please wait and try again.', code: 'RATE_LIMITED' },
          { status: 429 }
        );
      }

      if (errorMessage.includes('safety') || errorMessage.includes('blocked')) {
        return NextResponse.json(
          { error: 'Content blocked', details: 'The image could not be processed due to safety filters', code: 'SAFETY_BLOCKED' },
          { status: 400 }
        );
      }

      if (errorMessage.includes('not found') || errorMessage.includes('404')) {
        return NextResponse.json(
          { error: 'Model not available', details: 'The AI model is temporarily unavailable', code: 'MODEL_NOT_FOUND' },
          { status: 503 }
        );
      }
    }

    // Handle network errors
    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || error.message?.includes('fetch')) {
      return NextResponse.json(
        { error: 'Connection failed', details: 'Could not connect to the AI service', code: 'CONNECTION_ERROR' },
        { status: 503 }
      );
    }

    // Generic error
    return NextResponse.json(
      { error: 'Failed to analyze image', details: error.message || 'Unknown error', code: 'UNKNOWN_ERROR' },
      { status: 500 }
    );
  }
}

function buildVisionPrompt(query: string | undefined): string {
  const baseContext = `You are VisionVoice, an AI assistant helping a blind or visually impaired person understand what they're looking at through their phone's camera.

Your personality:
- Warm, patient, and reassuring
- Clear and concise - don't ramble
- Proactive about mentioning important things
- Never condescending - treat the user as an intelligent adult

Guidelines:
- Mention potential hazards or safety concerns FIRST
- Use spatial language: "to your left", "directly ahead", "at 2 o'clock"
- Give distances when relevant: "about 2 meters away"
- Read any visible text exactly as written
- Describe people generally (clothing, posture) but NEVER identify specific individuals
- Keep responses under 100 words unless more detail is explicitly needed
- Speak naturally, like a helpful friend`;

  const userQuery = query || 'What do you see?';

  return `${baseContext}

The user asked: "${userQuery}"

Based on what you see in the image, provide a helpful, natural response. Remember to prioritize safety information and be concise.`;
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
