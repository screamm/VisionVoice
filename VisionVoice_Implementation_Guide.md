# 👁️ VisionVoice - Technical Implementation Guide

## AI Eyes That Speak - Visual Assistance for the Blind

---

## 🏗️ Project Structure

```
visionvoice/
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.tsx              # Main camera + voice interface
│   │   │   ├── layout.tsx            # PWA layout
│   │   │   └── globals.css           # Accessible styles
│   │   ├── components/
│   │   │   ├── CameraView.tsx        # Camera capture component
│   │   │   ├── VoiceInterface.tsx    # ElevenLabs WebSocket handler
│   │   │   ├── ConversationLog.tsx   # Accessible conversation display
│   │   │   └── AccessibilityControls.tsx
│   │   ├── hooks/
│   │   │   ├── useCamera.ts          # Camera access hook
│   │   │   ├── useVoice.ts           # Voice I/O hook
│   │   │   └── useVisionAI.ts        # Gemini integration hook
│   │   └── lib/
│   │       ├── elevenlabs.ts         # ElevenLabs client
│   │       ├── gemini.ts             # Gemini Vision client
│   │       └── firebase.ts           # Firebase/Firestore client
│   ├── public/
│   │   ├── manifest.json             # PWA manifest
│   │   └── icons/                    # App icons
│   ├── next.config.js
│   └── package.json
├── backend/
│   ├── vision-api/
│   │   ├── index.js                  # Cloud Run vision service
│   │   ├── Dockerfile
│   │   └── package.json
│   └── conversation-api/
│       ├── index.js                  # Conversation orchestrator
│       ├── Dockerfile
│       └── package.json
├── config/
│   ├── elevenlabs-agent.json         # Agent configuration
│   └── system-prompt.txt             # Voice AI personality
├── scripts/
│   ├── deploy.sh                     # Full deployment script
│   └── test-vision.js                # Vision API test
├── .env.example
├── README.md
└── LICENSE
```

---

## 🎙️ ElevenLabs Agent Configuration

### `config/elevenlabs-agent.json`

```json
{
  "agent": {
    "name": "VisionVoice",
    "description": "AI visual assistant for blind and visually impaired users",
    "voice": {
      "voice_id": "21m00Tcm4TlvDq8ikWAM",
      "model_id": "eleven_turbo_v2_5",
      "stability": 0.7,
      "similarity_boost": 0.8,
      "style": 0.3,
      "use_speaker_boost": true
    },
    "conversation": {
      "model": "claude-3-sonnet",
      "temperature": 0.7,
      "max_tokens": 200,
      "system_prompt_path": "./system-prompt.txt"
    },
    "turn_taking": {
      "mode": "server_vad",
      "silence_duration_ms": 1500,
      "prefix_padding_ms": 300,
      "voice_threshold": 0.5
    },
    "interruption": {
      "enabled": true,
      "threshold": 0.7
    },
    "filler_words": {
      "enabled": true,
      "words": ["let me see", "I can see", "looking now"]
    },
    "language": "en",
    "tools": [
      {
        "name": "analyze_image",
        "description": "Analyzes the current camera view using Gemini Vision",
        "parameters": {
          "query": { "type": "string", "required": true, "description": "What to look for or describe" }
        }
      },
      {
        "name": "read_text",
        "description": "Performs OCR and reads text from the current view",
        "parameters": {
          "detail_level": { "type": "string", "enum": ["summary", "full", "specific"], "default": "full" }
        }
      }
    ]
  }
}
```

---

## 📝 System Prompt for VisionVoice

### `config/system-prompt.txt`

```
You are VisionVoice, a friendly and helpful AI assistant designed to help blind and visually impaired people understand the visual world around them. You receive descriptions of what a camera sees and communicate this information through natural conversation.

## YOUR ROLE
You are the user's "eyes" - describing what you see clearly, accurately, and helpfully. You're like a trusted friend walking alongside them, pointing out what's important.

## PERSONALITY
- Warm, patient, and reassuring
- Clear and concise - don't ramble
- Proactive - mention important things without being asked
- Never condescending - treat the user as an intelligent adult
- Calm in all situations, even if you see something concerning

## HOW TO DESCRIBE THINGS

### General Scenes
- Start with the big picture, then details
- Use clock positions for locations: "At 2 o'clock there's a chair"
- Give distances when relevant: "About 3 meters ahead"
- Mention obstacles and hazards first

### Objects
- Name the object, then key details
- For products: brand, name, size, relevant warnings
- For documents: type, sender, key information
- For food: ingredients, allergens, expiration

### People (BE CAREFUL)
- NEVER identify specific individuals by name
- Describe generally: "a person in a blue shirt"
- Describe expressions: "they appear to be smiling"
- Describe body language: "they're waving at you"

### Text/Documents
- Summarize first, then offer to read in full
- For important info (dates, numbers, addresses), read exactly
- For warnings or alerts, emphasize them

## CONVERSATION STYLE
- Keep responses concise unless asked for detail
- Always be ready for follow-up questions
- If you can't see something clearly, say so
- If asked about something not in view, suggest how to find it

## SAFETY FIRST
If you see potential hazards, mention them immediately:
- "Careful, there's a step down ahead"
- "I see a wet floor sign to your left"
- "The stove burner appears to be on"

## WHAT YOU RECEIVE
You'll receive image descriptions from Gemini Vision. Use this information to answer the user's questions naturally. Don't mention "Gemini" or "the image analysis" - just describe what you "see."

## EXAMPLE EXCHANGES

User: "What's in front of me?"
You: "You're facing a kitchen counter. There's a coffee maker on the left, a fruit bowl with apples and bananas in the center, and a stack of mail on the right. The closest thing to you is a cutting board about arm's length away."

User: "Read the top letter"
You: "It's a bill from the electric company. Your current balance is $127.43, due by December 20th. Would you like me to read the full details?"

User: "Is anyone here?"
You: "I see one person sitting at the table to your right, about 4 meters away. They're wearing glasses and looking at a laptop. They haven't looked up."

Remember: You're not just describing images - you're helping someone navigate their world with confidence and independence.
```

---

## 🖥️ Frontend Implementation

### `frontend/src/app/page.tsx`

```tsx
'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { CameraView } from '@/components/CameraView';
import { VoiceInterface } from '@/components/VoiceInterface';
import { ConversationLog } from '@/components/ConversationLog';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export default function Home() {
  const [isActive, setIsActive] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [currentImage, setCurrentImage] = useState<string | null>(null);
  const [visionContext, setVisionContext] = useState<string>('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState<string | null>(null);
  
  const captureIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Capture frame and send to Gemini Vision
  const captureAndAnalyze = useCallback(async (imageData: string) => {
    try {
      const response = await fetch('/api/vision/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          image: imageData,
          context: visionContext 
        })
      });
      
      if (!response.ok) throw new Error('Vision API failed');
      
      const { description } = await response.json();
      setVisionContext(description);
      return description;
    } catch (err) {
      console.error('Vision analysis error:', err);
      return null;
    }
  }, [visionContext]);

  // Handle camera frame capture
  const handleFrameCapture = useCallback((imageData: string) => {
    setCurrentImage(imageData);
    if (isActive) {
      captureAndAnalyze(imageData);
    }
  }, [isActive, captureAndAnalyze]);

  // Handle voice transcript from ElevenLabs
  const handleTranscript = useCallback((text: string, role: 'user' | 'assistant') => {
    setMessages(prev => [...prev, {
      role,
      content: text,
      timestamp: new Date()
    }]);
  }, []);

  // Toggle active state with haptic feedback
  const toggleActive = useCallback(() => {
    if ('vibrate' in navigator) {
      navigator.vibrate(isActive ? [100] : [100, 50, 100]);
    }
    setIsActive(!isActive);
  }, [isActive]);

  // Keyboard accessibility
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        toggleActive();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleActive]);

  // Start/stop continuous capture
  useEffect(() => {
    if (isActive) {
      // Capture every 2 seconds when active
      captureIntervalRef.current = setInterval(() => {
        // Camera component will trigger handleFrameCapture
      }, 2000);
    } else {
      if (captureIntervalRef.current) {
        clearInterval(captureIntervalRef.current);
      }
    }
    
    return () => {
      if (captureIntervalRef.current) {
        clearInterval(captureIntervalRef.current);
      }
    };
  }, [isActive]);

  return (
    <main 
      className="min-h-screen bg-black text-white flex flex-col"
      role="application"
      aria-label="VisionVoice - AI Visual Assistant"
    >
      {/* Accessible status announcer */}
      <div 
        role="status" 
        aria-live="polite" 
        className="sr-only"
      >
        {isActive ? 'VisionVoice is active and listening' : 'VisionVoice is paused'}
      </div>

      {/* Camera View */}
      <div className="flex-1 relative">
        <CameraView 
          isActive={isActive}
          onFrameCapture={handleFrameCapture}
        />
        
        {/* Activation overlay */}
        <button
          onClick={toggleActive}
          className={`absolute inset-0 flex items-center justify-center transition-all ${
            isActive ? 'bg-transparent' : 'bg-black/70'
          }`}
          aria-label={isActive ? 'Tap to pause VisionVoice' : 'Tap anywhere to start VisionVoice'}
          aria-pressed={isActive}
        >
          {!isActive && (
            <div className="text-center p-8">
              <div className="text-6xl mb-4">👁️</div>
              <h1 className="text-2xl font-bold mb-2">VisionVoice</h1>
              <p className="text-lg text-gray-300">Tap anywhere to start</p>
              <p className="text-sm text-gray-500 mt-2">Or press Space</p>
            </div>
          )}
        </button>
      </div>

      {/* Voice Interface */}
      <VoiceInterface
        isActive={isActive}
        visionContext={visionContext}
        currentImage={currentImage}
        onTranscript={handleTranscript}
        onListeningChange={setIsListening}
      />

      {/* Conversation Log (for low-vision users) */}
      <ConversationLog 
        messages={messages}
        isVisible={isActive}
      />

      {/* Status indicator */}
      {isActive && (
        <div 
          className={`fixed bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full ${
            isListening ? 'bg-green-500' : 'bg-blue-500'
          }`}
          role="status"
          aria-label={isListening ? 'Listening for your voice' : 'Processing'}
        >
          {isListening ? '🎤 Listening...' : '🔄 Processing...'}
        </div>
      )}

      {/* Error display */}
      {error && (
        <div 
          role="alert"
          className="fixed top-4 left-4 right-4 bg-red-500 p-4 rounded-lg"
        >
          {error}
          <button 
            onClick={() => setError(null)}
            className="ml-4 underline"
            aria-label="Dismiss error"
          >
            Dismiss
          </button>
        </div>
      )}
    </main>
  );
}
```

---

### `frontend/src/components/CameraView.tsx`

```tsx
'use client';

import { useEffect, useRef, useCallback } from 'react';

interface CameraViewProps {
  isActive: boolean;
  onFrameCapture: (imageData: string) => void;
}

export function CameraView({ isActive, onFrameCapture }: CameraViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Initialize camera
  useEffect(() => {
    async function setupCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'environment', // Back camera on mobile
            width: { ideal: 1280 },
            height: { ideal: 720 }
          },
          audio: false
        });
        
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          streamRef.current = stream;
        }
      } catch (err) {
        console.error('Camera access error:', err);
      }
    }

    setupCamera();

    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  // Capture frame function
  const captureFrame = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    if (!ctx) return;

    // Set canvas size to video size
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    // Draw video frame to canvas
    ctx.drawImage(video, 0, 0);

    // Convert to base64 JPEG (compressed for faster upload)
    const imageData = canvas.toDataURL('image/jpeg', 0.8);
    
    onFrameCapture(imageData);
  }, [onFrameCapture]);

  // Capture frames periodically when active
  useEffect(() => {
    if (!isActive) return;

    // Capture immediately when activated
    captureFrame();

    // Then capture every 2 seconds
    const interval = setInterval(captureFrame, 2000);

    return () => clearInterval(interval);
  }, [isActive, captureFrame]);

  return (
    <div className="relative w-full h-full">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="w-full h-full object-cover"
        aria-hidden="true"
      />
      <canvas ref={canvasRef} className="hidden" />
      
      {/* Visual indicator that camera is active */}
      {isActive && (
        <div className="absolute top-4 right-4 flex items-center gap-2 bg-black/50 px-3 py-1 rounded-full">
          <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
          <span className="text-sm">Camera Active</span>
        </div>
      )}
    </div>
  );
}
```

---

### `frontend/src/components/VoiceInterface.tsx`

```tsx
'use client';

import { useEffect, useRef, useCallback, useState } from 'react';

interface VoiceInterfaceProps {
  isActive: boolean;
  visionContext: string;
  currentImage: string | null;
  onTranscript: (text: string, role: 'user' | 'assistant') => void;
  onListeningChange: (isListening: boolean) => void;
}

export function VoiceInterface({
  isActive,
  visionContext,
  currentImage,
  onTranscript,
  onListeningChange
}: VoiceInterfaceProps) {
  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  // Connect to ElevenLabs WebSocket
  const connect = useCallback(async () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const agentId = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID;
    const wsUrl = `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${agentId}`;

    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('ElevenLabs WebSocket connected');
      setIsConnected(true);
      
      // Send initial configuration with vision context
      ws.send(JSON.stringify({
        type: 'conversation_initiation_client_data',
        custom_llm_extra_body: {
          vision_context: visionContext,
          system_context: `Current scene description: ${visionContext}`
        }
      }));
    };

    ws.onmessage = async (event) => {
      const data = JSON.parse(event.data);

      switch (data.type) {
        case 'audio':
          // Play audio response
          playAudio(data.audio);
          break;

        case 'transcript':
          // Handle transcript
          onTranscript(data.text, data.role);
          if (data.role === 'user') {
            onListeningChange(false);
          }
          break;

        case 'user_started_speaking':
          onListeningChange(true);
          break;

        case 'user_stopped_speaking':
          onListeningChange(false);
          break;

        case 'tool_call':
          // Handle tool calls (analyze_image, read_text)
          handleToolCall(data, ws);
          break;

        case 'error':
          console.error('ElevenLabs error:', data.message);
          break;
      }
    };

    ws.onclose = () => {
      console.log('ElevenLabs WebSocket closed');
      setIsConnected(false);
    };

    ws.onerror = (error) => {
      console.error('ElevenLabs WebSocket error:', error);
    };

    wsRef.current = ws;
  }, [visionContext, onTranscript, onListeningChange]);

  // Handle tool calls from ElevenLabs
  const handleToolCall = useCallback(async (data: any, ws: WebSocket) => {
    const { tool_name, tool_call_id, parameters } = data;

    let result = '';

    if (tool_name === 'analyze_image' && currentImage) {
      // Call our Vision API
      try {
        const response = await fetch('/api/vision/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image: currentImage,
            query: parameters.query
          })
        });
        const { description } = await response.json();
        result = description;
      } catch (err) {
        result = 'I had trouble analyzing the image. Please try again.';
      }
    } else if (tool_name === 'read_text' && currentImage) {
      // Call our OCR API
      try {
        const response = await fetch('/api/vision/ocr', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image: currentImage,
            detail_level: parameters.detail_level || 'full'
          })
        });
        const { text } = await response.json();
        result = text || 'I could not find any readable text in the image.';
      } catch (err) {
        result = 'I had trouble reading the text. Please try again.';
      }
    }

    // Send tool result back to ElevenLabs
    ws.send(JSON.stringify({
      type: 'tool_result',
      tool_call_id,
      result
    }));
  }, [currentImage]);

  // Play audio from base64
  const playAudio = useCallback(async (base64Audio: string) => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }

    const audioContext = audioContextRef.current;
    const audioData = atob(base64Audio);
    const arrayBuffer = new ArrayBuffer(audioData.length);
    const view = new Uint8Array(arrayBuffer);
    
    for (let i = 0; i < audioData.length; i++) {
      view[i] = audioData.charCodeAt(i);
    }

    try {
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContext.destination);
      source.start();
    } catch (err) {
      console.error('Audio playback error:', err);
    }
  }, []);

  // Setup audio input stream
  const setupAudioInput = useCallback(async () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioContext = new AudioContext({ sampleRate: 16000 });
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);

      processor.onaudioprocess = (e) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          const inputData = e.inputBuffer.getChannelData(0);
          const pcmData = convertTo16BitPCM(inputData);
          const base64 = btoa(String.fromCharCode(...new Uint8Array(pcmData)));
          
          wsRef.current.send(JSON.stringify({
            type: 'audio',
            audio: base64
          }));
        }
      };

      source.connect(processor);
      processor.connect(audioContext.destination);

      return () => {
        stream.getTracks().forEach(track => track.stop());
        processor.disconnect();
        source.disconnect();
      };
    } catch (err) {
      console.error('Audio input error:', err);
    }
  }, []);

  // Convert float32 to 16-bit PCM
  const convertTo16BitPCM = (float32Array: Float32Array): ArrayBuffer => {
    const buffer = new ArrayBuffer(float32Array.length * 2);
    const view = new DataView(buffer);
    
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
    
    return buffer;
  };

  // Connect/disconnect based on active state
  useEffect(() => {
    if (isActive) {
      connect().then(() => {
        setupAudioInput();
      });
    } else {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    }

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [isActive, connect, setupAudioInput]);

  // Update vision context when it changes
  useEffect(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN && visionContext) {
      wsRef.current.send(JSON.stringify({
        type: 'context_update',
        vision_context: visionContext
      }));
    }
  }, [visionContext]);

  return null; // This is a logic-only component
}
```

---

## ☁️ Backend Implementation

### `backend/vision-api/index.js`

```javascript
const express = require('express');
const cors = require('cors');
const { VertexAI } = require('@google-cloud/vertexai');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Initialize Vertex AI
const vertexAI = new VertexAI({
  project: process.env.GCP_PROJECT_ID,
  location: 'us-central1'
});

// Use Gemini 1.5 Flash for speed
const visionModel = vertexAI.getGenerativeModel({
  model: 'gemini-1.5-flash',
  generationConfig: {
    temperature: 0.4,
    maxOutputTokens: 500
  }
});

// Main vision analysis endpoint
app.post('/api/vision/analyze', async (req, res) => {
  try {
    const { image, query, context } = req.body;

    if (!image) {
      return res.status(400).json({ error: 'No image provided' });
    }

    // Remove data URL prefix if present
    const base64Image = image.replace(/^data:image\/\w+;base64,/, '');

    // Build the prompt
    const prompt = buildAnalysisPrompt(query, context);

    // Call Gemini Vision
    const result = await visionModel.generateContent({
      contents: [{
        role: 'user',
        parts: [
          {
            inlineData: {
              mimeType: 'image/jpeg',
              data: base64Image
            }
          },
          { text: prompt }
        ]
      }]
    });

    const response = result.response;
    const description = response.candidates[0]?.content?.parts[0]?.text || 
                       'I could not analyze this image.';

    res.json({ 
      description,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Vision API error:', error);
    res.status(500).json({ 
      error: 'Failed to analyze image',
      details: error.message 
    });
  }
});

// OCR/Text reading endpoint
app.post('/api/vision/ocr', async (req, res) => {
  try {
    const { image, detail_level } = req.body;

    if (!image) {
      return res.status(400).json({ error: 'No image provided' });
    }

    const base64Image = image.replace(/^data:image\/\w+;base64,/, '');

    const prompt = buildOCRPrompt(detail_level);

    const result = await visionModel.generateContent({
      contents: [{
        role: 'user',
        parts: [
          {
            inlineData: {
              mimeType: 'image/jpeg',
              data: base64Image
            }
          },
          { text: prompt }
        ]
      }]
    });

    const response = result.response;
    const text = response.candidates[0]?.content?.parts[0]?.text || '';

    res.json({ 
      text,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('OCR API error:', error);
    res.status(500).json({ 
      error: 'Failed to read text',
      details: error.message 
    });
  }
});

// Scene description endpoint
app.post('/api/vision/scene', async (req, res) => {
  try {
    const { image } = req.body;

    if (!image) {
      return res.status(400).json({ error: 'No image provided' });
    }

    const base64Image = image.replace(/^data:image\/\w+;base64,/, '');

    const prompt = `
You are helping a blind person understand their surroundings. Describe this scene in detail:

1. SAFETY FIRST: Mention any hazards, obstacles, or things to be careful about
2. LAYOUT: Describe the space - what room/area is this, how big, what's the layout
3. KEY OBJECTS: List important objects and their approximate positions (use clock positions: "at 2 o'clock", "directly ahead")
4. PEOPLE: If there are people, describe them generally (not by name) - what they're doing, wearing, their approximate position
5. LIGHTING: Is it bright, dim, natural light, artificial?
6. NAVIGATION: If someone wanted to move through this space, what should they know?

Be concise but thorough. Prioritize information by importance for someone who cannot see.
`;

    const result = await visionModel.generateContent({
      contents: [{
        role: 'user',
        parts: [
          {
            inlineData: {
              mimeType: 'image/jpeg',
              data: base64Image
            }
          },
          { text: prompt }
        ]
      }]
    });

    const response = result.response;
    const description = response.candidates[0]?.content?.parts[0]?.text || '';

    res.json({ 
      description,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Scene API error:', error);
    res.status(500).json({ 
      error: 'Failed to describe scene',
      details: error.message 
    });
  }
});

// Build analysis prompt based on query
function buildAnalysisPrompt(query, context) {
  let prompt = `You are helping a blind person understand what they're pointing their camera at.

`;

  if (context) {
    prompt += `Previous context: ${context}\n\n`;
  }

  if (query) {
    prompt += `The user specifically asked: "${query}"\n\n`;
  }

  prompt += `Describe what you see clearly and concisely. Include:
- What the main object/subject is
- Any important text or labels
- Colors, sizes, and identifying features
- Anything that might be relevant for a blind person

If there are potential hazards or safety concerns, mention those first.
Keep your response under 100 words unless more detail is needed.
Speak naturally, as if you're a helpful friend describing what you see.`;

  return prompt;
}

// Build OCR prompt based on detail level
function buildOCRPrompt(detailLevel) {
  switch (detailLevel) {
    case 'summary':
      return `Read any text visible in this image and provide a brief summary of what the document/text is about. 
Include: document type, sender (if applicable), main topic, and any critical information like dates, amounts, or deadlines.
Keep it under 50 words.`;

    case 'specific':
      return `Read all text visible in this image. Look specifically for:
- Names, dates, and numbers
- Addresses and contact information
- Warnings or important notices
- Amounts, prices, or financial figures
Format this as clear, readable text.`;

    case 'full':
    default:
      return `Read ALL text visible in this image, exactly as written.
Organize it logically (headings first, then body text).
Include any fine print, warnings, or footnotes.
For forms or documents, preserve the structure.
If text is partially visible or unclear, indicate that.`;
  }
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`VisionVoice API running on port ${PORT}`);
});
```

---

## 🚀 Deployment Script

### `scripts/deploy.sh`

```bash
#!/bin/bash

# VisionVoice Deployment Script
# Deploys all components to Google Cloud

set -e

PROJECT_ID="${GCP_PROJECT_ID:-your-project-id}"
REGION="us-central1"

echo "🚀 Deploying VisionVoice to project: $PROJECT_ID"

# 1. Enable required APIs
echo "📦 Enabling required APIs..."
gcloud services enable \
  run.googleapis.com \
  aiplatform.googleapis.com \
  firestore.googleapis.com \
  cloudbuild.googleapis.com \
  --project=$PROJECT_ID

# 2. Deploy Vision API to Cloud Run
echo "👁️ Deploying Vision API..."
cd backend/vision-api

gcloud run deploy visionvoice-api \
  --source=. \
  --region=$REGION \
  --platform=managed \
  --allow-unauthenticated \
  --memory=1Gi \
  --cpu=1 \
  --min-instances=0 \
  --max-instances=10 \
  --set-env-vars="GCP_PROJECT_ID=$PROJECT_ID"

VISION_API_URL=$(gcloud run services describe visionvoice-api \
  --region=$REGION \
  --format='value(status.url)')

echo "✅ Vision API deployed at: $VISION_API_URL"

cd ../..

# 3. Deploy Frontend to Cloud Run
echo "🎨 Deploying Frontend..."
cd frontend

# Build with API URL
echo "NEXT_PUBLIC_VISION_API_URL=$VISION_API_URL" > .env.production
echo "NEXT_PUBLIC_ELEVENLABS_AGENT_ID=$ELEVENLABS_AGENT_ID" >> .env.production

gcloud run deploy visionvoice-app \
  --source=. \
  --region=$REGION \
  --platform=managed \
  --allow-unauthenticated \
  --memory=512Mi \
  --cpu=1 \
  --min-instances=0 \
  --max-instances=10

FRONTEND_URL=$(gcloud run services describe visionvoice-app \
  --region=$REGION \
  --format='value(status.url)')

echo "✅ Frontend deployed at: $FRONTEND_URL"

cd ..

# 4. Setup Firestore
echo "🔥 Setting up Firestore..."
gcloud firestore databases create \
  --location=$REGION \
  --project=$PROJECT_ID || true

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "✅ DEPLOYMENT COMPLETE!"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "🌐 Frontend URL: $FRONTEND_URL"
echo "🔌 Vision API URL: $VISION_API_URL"
echo ""
echo "📱 Open $FRONTEND_URL on your phone to test VisionVoice!"
echo ""
```

---

## 📋 Environment Variables

### `.env.example`

```bash
# Google Cloud
GCP_PROJECT_ID=your-project-id

# ElevenLabs
ELEVENLABS_API_KEY=xi_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
ELEVENLABS_AGENT_ID=agent_xxxxxxxx

# Frontend (public)
NEXT_PUBLIC_VISION_API_URL=https://visionvoice-api-xxxxx.run.app
NEXT_PUBLIC_ELEVENLABS_AGENT_ID=agent_xxxxxxxx

# Optional: Firebase (for user preferences)
NEXT_PUBLIC_FIREBASE_API_KEY=AIzaxxxxxxxxxxxxxxxxxxxxxxxxx
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project-id
```

---

## 📖 README Template

### `README.md`

```markdown
# 👁️ VisionVoice

**AI Eyes That Speak - Visual Assistance for the Blind**

[![ElevenLabs Challenge](https://img.shields.io/badge/ElevenLabs-Challenge-blueviolet)](https://lablab.ai/event/ai-partner-catalyst)
[![Google Cloud](https://img.shields.io/badge/Google%20Cloud-Powered-4285F4)](https://cloud.google.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

## 🎯 What is VisionVoice?

VisionVoice is an AI-powered visual assistant that helps blind and visually impaired people "see" the world through natural voice conversation. Point your phone's camera at anything and have a natural conversation about what the AI sees.

**Key Features:**
- 👁️ Real-time visual analysis via Gemini Vision
- 🎤 Natural voice conversation via ElevenLabs
- 📄 Document and text reading (OCR)
- 🏠 Scene and room description
- 🌍 Multi-language support (30+ languages)
- 📱 Works in any browser - no app installation

## 🎥 Demo Video

[Watch the 3-minute demo](https://youtu.be/your-video-id)

## 🛠️ Technology Stack

| Component | Technology |
|-----------|------------|
| Vision AI | Google Gemini 1.5 Pro Vision via Vertex AI |
| Voice | ElevenLabs Conversational AI 2.0 |
| Frontend | Next.js PWA with Camera/Audio APIs |
| Backend | Google Cloud Run |
| Database | Firestore |

## 🚀 Quick Start

### Prerequisites
- Google Cloud account with billing enabled
- ElevenLabs API key
- Node.js 20+

### 1. Clone the repository
```bash
git clone https://github.com/yourusername/visionvoice.git
cd visionvoice
```

### 2. Set up environment variables
```bash
cp .env.example .env
# Edit .env with your API keys
```

### 3. Deploy to Google Cloud
```bash
chmod +x scripts/deploy.sh
./scripts/deploy.sh
```

### 4. Open on your phone
Navigate to the deployed URL and grant camera/microphone permissions.

## 📁 Project Structure

```
visionvoice/
├── frontend/          # Next.js PWA
├── backend/           # Cloud Run APIs
├── config/            # ElevenLabs agent config
└── scripts/           # Deployment scripts
```

## ♿ Accessibility

VisionVoice is designed for accessibility:
- 100% voice-controlled operation
- Screen reader compatible
- Single-tap activation
- Haptic feedback
- High contrast mode for low vision users

## 🙏 Acknowledgments

Built for the [AI Partner Catalyst Hackathon](https://lablab.ai/event/ai-partner-catalyst) using:
- [ElevenLabs](https://elevenlabs.io) Conversational AI
- [Google Cloud](https://cloud.google.com) Vertex AI & Gemini

---

**VisionVoice** - Giving 285 million people AI eyes that speak.
```

---

## ✅ Quick Start Checklist

1. **TODAY:**
   - [ ] Create GCP project
   - [ ] Enable Vertex AI API
   - [ ] Request $50 hackathon credits
   - [ ] Get ElevenLabs Discord coupon

2. **DAY 2:**
   - [ ] Create ElevenLabs Conversational AI agent
   - [ ] Test Gemini Vision API with sample images
   - [ ] Setup Next.js project

3. **DAY 3-4:**
   - [ ] Implement camera capture
   - [ ] Connect to ElevenLabs WebSocket
   - [ ] Basic end-to-end working

4. **WEEK 2:**
   - [ ] Refine conversation flow
   - [ ] Add OCR mode
   - [ ] Add scene description

5. **WEEK 3:**
   - [ ] Accessibility testing
   - [ ] Multi-language support
   - [ ] Performance optimization

6. **WEEK 4:**
   - [ ] Record demo video
   - [ ] Write documentation
   - [ ] Submit to Devpost

---

## 🏆 Let's Win This!

**Estimated cost: $0-15**
**Potential prize: $12,500**
**Impact: 285 million lives**

Good luck! 🍀
