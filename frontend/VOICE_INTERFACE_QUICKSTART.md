# VoiceInterface Quick Start Guide

Get up and running with the ElevenLabs voice interface in 5 minutes.

## 1. Install Dependencies

Dependencies are already included in `package.json`:
```json
{
  "@google/generative-ai": "^0.21.0",
  "next": "^15.1.3",
  "react": "^19.0.0"
}
```

## 2. Set Environment Variables

Create `frontend/.env.local`:
```env
NEXT_PUBLIC_ELEVENLABS_AGENT_ID=your_agent_id_here
GOOGLE_AI_API_KEY=your_google_ai_key_here
```

## 3. Create Vision API Endpoint

Create `frontend/src/app/api/vision/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY!);

export async function POST(request: NextRequest) {
  try {
    const { image, context } = await request.json();

    if (!image) {
      return NextResponse.json({ error: 'No image provided' }, { status: 400 });
    }

    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const prompt = context || 'Describe this image in detail';
    const base64Image = image.replace(/^data:image\/\w+;base64,/, '');

    const result = await model.generateContent([
      prompt,
      { inlineData: { data: base64Image, mimeType: 'image/jpeg' } }
    ]);

    const analysis = (await result.response).text();

    return NextResponse.json({ analysis });
  } catch (error) {
    console.error('Vision API Error:', error);
    return NextResponse.json({ error: 'Failed to analyze image' }, { status: 500 });
  }
}
```

## 4. Use the Component

Basic usage in any page:

```typescript
'use client';

import { VoiceInterface } from '@/components/VoiceInterface';

export default function MyPage() {
  return (
    <div style={{ padding: '24px', maxWidth: '800px', margin: '0 auto' }}>
      <h1>Voice Assistant</h1>
      <VoiceInterface isActive={true} />
    </div>
  );
}
```

## 5. Test It

1. Start dev server:
   ```bash
   npm run dev
   ```

2. Open browser to your page

3. Click "Record" button

4. Speak: "Hello, can you hear me?"

5. Listen for response

## Common Usage Patterns

### With Image Upload

```typescript
'use client';

import { VoiceInterface } from '@/components/VoiceInterface';
import { useState } from 'react';

export default function ImageAnalysisPage() {
  const [image, setImage] = useState<string>('');

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      setImage(event.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div style={{ padding: '24px' }}>
      <input type="file" accept="image/*" onChange={handleImageUpload} />
      {image && <img src={image} alt="Upload preview" style={{ maxWidth: '400px' }} />}

      <VoiceInterface
        isActive={!!image}
        currentImage={image}
        visionContext="Describe this image in detail"
      />
    </div>
  );
}
```

### With Status Tracking

```typescript
'use client';

import { VoiceInterface } from '@/components/VoiceInterface';
import { ConnectionState } from '@/hooks/useElevenLabs';
import { useState } from 'react';

export default function StatusTrackingPage() {
  const [status, setStatus] = useState<ConnectionState>(ConnectionState.DISCONNECTED);

  return (
    <div style={{ padding: '24px' }}>
      <div>Status: {status}</div>

      <VoiceInterface
        isActive={true}
        onStatusChange={setStatus}
        onTranscript={(text, role) => console.log(`${role}: ${text}`)}
      />
    </div>
  );
}
```

## Troubleshooting

### "Missing NEXT_PUBLIC_ELEVENLABS_AGENT_ID"
- Add agent ID to `.env.local`
- Restart dev server

### "WebSocket connection failed"
- Verify agent ID is correct
- Check network connection
- Ensure HTTPS in production

### "Microphone not working"
- Allow microphone permission in browser
- Use HTTPS (required for getUserMedia)
- Check browser console for errors

### "No audio playback"
- Check system volume
- Verify browser audio permissions
- Look for console errors

## Next Steps

1. Read full documentation: `src/components/README.md`
2. Review examples: `src/components/VoiceInterface.example.tsx`
3. Check setup guide: `ELEVENLABS_SETUP.md`
4. Customize styling with CSS

## File Structure

```
frontend/
├── src/
│   ├── components/
│   │   ├── VoiceInterface.tsx          # Main component
│   │   ├── VoiceInterface.example.tsx  # Usage examples
│   │   └── README.md                   # Full documentation
│   ├── hooks/
│   │   └── useElevenLabs.ts           # Core logic hook
│   ├── types/
│   │   └── elevenlabs.ts              # TypeScript types
│   └── app/
│       └── api/
│           └── vision/
│               └── route.ts           # Vision API endpoint
├── .env.local                         # Environment variables
├── ELEVENLABS_SETUP.md               # Detailed setup guide
└── VOICE_INTERFACE_QUICKSTART.md     # This file
```

## Production Checklist

Before deploying:

- [ ] Set environment variables in hosting platform
- [ ] Enable HTTPS for WebSocket (wss://)
- [ ] Test microphone permissions flow
- [ ] Verify vision API rate limits
- [ ] Add error monitoring
- [ ] Test on target browsers
- [ ] Optimize image upload sizes
- [ ] Configure CORS if needed

## Support

Issues? Check:
- Console errors
- Network tab (WebSocket messages)
- ElevenLabs dashboard (agent status)
- Environment variables

For more help, see `ELEVENLABS_SETUP.md` or open an issue.
