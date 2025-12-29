# ElevenLabs Conversational AI Setup Guide

Complete setup guide for integrating ElevenLabs Conversational AI with VisionVoice.

## Prerequisites

1. **ElevenLabs Account**: Sign up at [elevenlabs.io](https://elevenlabs.io)
2. **API Access**: Ensure you have access to Conversational AI features
3. **Agent Created**: Create a conversational agent in the ElevenLabs dashboard

## Step 1: Create Conversational Agent

### Via ElevenLabs Dashboard

1. Navigate to **Conversational AI** section
2. Click **Create Agent**
3. Configure agent settings:
   - **Name**: VisionVoice Assistant
   - **Voice**: Select preferred voice
   - **Language**: Select primary language
   - **System Prompt**: Configure agent behavior

### Recommended System Prompt

```
You are VisionVoice Assistant, an AI that helps users understand and analyze images through voice conversation.

Your capabilities:
- Describe images in detail when users upload them
- Answer questions about image content
- Provide accessibility descriptions
- Analyze technical aspects of images
- Guide users based on image content

When users ask about an image, use the analyze_image tool to get detailed information. Then provide clear, conversational responses based on the analysis.

Be friendly, concise, and helpful. If you cannot see or analyze an image, politely ask the user to upload one first.
```

## Step 2: Configure Tool Definitions

Add the `analyze_image` tool to your agent:

### Tool Configuration (JSON)

```json
{
  "name": "analyze_image",
  "description": "Analyzes the current uploaded image and returns detailed information about its content",
  "parameters": {
    "type": "object",
    "properties": {
      "focus": {
        "type": "string",
        "description": "Specific aspect to focus on (optional): general, accessibility, technical, objects, text",
        "enum": ["general", "accessibility", "technical", "objects", "text"]
      }
    }
  },
  "required": []
}
```

### Via Dashboard

1. In agent settings, go to **Tools** section
2. Click **Add Tool**
3. Select **Custom Tool**
4. Enter tool name: `analyze_image`
5. Add description and parameters from above
6. Save tool configuration

## Step 3: Get Agent ID

1. Open your agent in the dashboard
2. Navigate to **Settings** or **API** tab
3. Copy the **Agent ID** (format: `agent_xxxxxxxxxx`)
4. Save this ID for environment configuration

## Step 4: Environment Configuration

### Create Environment File

Create or update `frontend/.env.local`:

```env
# ElevenLabs Configuration
NEXT_PUBLIC_ELEVENLABS_AGENT_ID=agent_your_agent_id_here
```

### Environment Variables Explained

- **NEXT_PUBLIC_ELEVENLABS_AGENT_ID**: Your agent's unique identifier
  - Prefix `NEXT_PUBLIC_` exposes variable to browser
  - Required for WebSocket connection
  - Non-sensitive (agent ID is public)

### Security Note

Agent IDs are considered public identifiers. Access control is managed through:
- ElevenLabs account permissions
- API rate limiting
- Tool implementation security

## Step 5: Vision API Setup

The voice interface requires a local `/api/vision` endpoint for image analysis.

### Create Vision API Route

Create `frontend/src/app/api/vision/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY!);

export async function POST(request: NextRequest) {
  try {
    const { image, context } = await request.json();

    if (!image) {
      return NextResponse.json(
        { error: 'No image provided' },
        { status: 400 }
      );
    }

    // Initialize Gemini model
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    // Prepare prompt
    const prompt = context || 'Describe this image in detail';

    // Remove data URL prefix if present
    const base64Image = image.replace(/^data:image\/\w+;base64,/, '');

    // Generate content
    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          data: base64Image,
          mimeType: 'image/jpeg'
        }
      }
    ]);

    const response = await result.response;
    const analysis = response.text();

    return NextResponse.json({
      analysis,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Vision API Error:', error);
    return NextResponse.json(
      { error: 'Failed to analyze image' },
      { status: 500 }
    );
  }
}
```

### Vision API Environment Variables

Add to `frontend/.env.local`:

```env
# Google AI Configuration (for vision analysis)
GOOGLE_AI_API_KEY=your_google_ai_api_key_here
```

## Step 6: Test Configuration

### Test Checklist

- [ ] Agent ID is correctly set in `.env.local`
- [ ] Environment file is in `frontend/.env.local` (not tracked by git)
- [ ] Vision API endpoint exists at `/api/vision`
- [ ] Google AI API key is configured
- [ ] Application restarts after environment changes

### Test WebSocket Connection

Create `frontend/src/app/test-voice/page.tsx`:

```typescript
'use client';

import { VoiceInterface } from '@/components/VoiceInterface';

export default function TestVoicePage() {
  return (
    <div style={{ padding: '24px', maxWidth: '800px', margin: '0 auto' }}>
      <h1>Voice Interface Test</h1>
      <VoiceInterface isActive={true} />
    </div>
  );
}
```

### Test Steps

1. Start development server: `npm run dev`
2. Navigate to `/test-voice`
3. Check browser console for connection status
4. Click "Record" button
5. Verify status changes to "Connected"
6. Speak into microphone
7. Verify audio response plays

### Common Test Issues

**Connection Fails**
```
Solution: Verify agent ID in environment variables
Check: Console for WebSocket connection errors
```

**Microphone Not Working**
```
Solution: Allow microphone permissions in browser
Check: HTTPS enabled (required for getUserMedia)
```

**No Audio Playback**
```
Solution: Check browser audio permissions
Check: System volume and audio output device
```

## Step 7: Production Deployment

### Environment Variables for Production

Set in your hosting platform (Vercel, Netlify, etc.):

```
NEXT_PUBLIC_ELEVENLABS_AGENT_ID=agent_your_agent_id_here
GOOGLE_AI_API_KEY=your_google_ai_api_key_here
```

### Security Checklist

- [ ] Use HTTPS for WebSocket connections (wss://)
- [ ] Validate image sizes to prevent DoS
- [ ] Rate limit vision API calls
- [ ] Monitor API usage and costs
- [ ] Implement error logging and monitoring
- [ ] Set up CORS policies if needed

### Performance Optimization

1. **Image Optimization**
   - Compress images before upload
   - Limit maximum image size (e.g., 5MB)
   - Convert to optimal format (JPEG/WebP)

2. **Audio Buffer Management**
   - Adjust buffer size for latency vs stability
   - Implement queue size limits
   - Clear queues on disconnect

3. **Connection Management**
   - Implement reconnection backoff
   - Handle connection timeouts
   - Clean up resources on unmount

## Monitoring and Debugging

### Enable Debug Logging

Add to component:

```typescript
const DEBUG = process.env.NODE_ENV === 'development';

if (DEBUG) {
  console.log('[VoiceInterface] Connection state:', connectionState);
  console.log('[VoiceInterface] Recording:', isRecording);
}
```

### Monitor WebSocket Traffic

Use browser DevTools:
1. Open DevTools (F12)
2. Navigate to **Network** tab
3. Filter by **WS** (WebSocket)
4. Inspect messages sent/received

### Monitor Audio Pipeline

```typescript
// Add to useElevenLabs hook
console.log('[Audio] Input buffer size:', audioData.length);
console.log('[Audio] Output buffer queued:', playbackQueueRef.current.length);
```

## Best Practices

### Voice Interface Design

1. **Provide Visual Feedback**
   - Show connection status
   - Display transcript in real-time
   - Indicate when agent is speaking

2. **Handle Errors Gracefully**
   - Clear error messages
   - Automatic recovery when possible
   - Fallback options for users

3. **Accessibility**
   - Keyboard controls
   - Screen reader support
   - ARIA labels and live regions

### Conversation Flow

1. **Clear Instructions**
   - Tell users what they can do
   - Provide example prompts
   - Guide new users

2. **Context Management**
   - Keep conversation focused
   - Reference previous exchanges
   - Clear context when switching images

3. **Error Recovery**
   - Handle misunderstandings gracefully
   - Offer clarification prompts
   - Allow users to repeat or rephrase

## Support and Resources

### Documentation

- [ElevenLabs API Docs](https://elevenlabs.io/docs)
- [Conversational AI Guide](https://elevenlabs.io/docs/conversational-ai)
- [Web Audio API MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)

### Community

- ElevenLabs Discord
- GitHub Issues for VisionVoice
- Stack Overflow (tag: elevenlabs)

### Troubleshooting

If issues persist:
1. Check ElevenLabs status page
2. Review API quota limits
3. Test with minimal example
4. Contact ElevenLabs support

## License

Part of the VisionVoice project.
