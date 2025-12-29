# VisionVoice

**AI Eyes That Speak - Visual Assistance for the Blind**

VisionVoice is an accessibility-focused web application that uses AI to help visually impaired users understand their surroundings through voice interaction.

## Features

- Real-time camera analysis using Google Gemini Vision AI
- Natural voice conversations powered by ElevenLabs Conversational AI
- Text-to-speech for all visual descriptions
- Accessible, mobile-first design
- Works in any modern browser

## Tech Stack

- **Frontend**: Next.js 15, React 19, TypeScript, Tailwind CSS
- **AI Vision**: Google Gemini API
- **Voice**: ElevenLabs Conversational AI & Text-to-Speech

## Getting Started

### Prerequisites

- Node.js 20+
- Google AI API key ([Get one here](https://makersuite.google.com/app/apikey))
- ElevenLabs account with API key ([Sign up](https://elevenlabs.io))

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/screamm/VisionVoice.git
   cd VisionVoice
   ```

2. Install dependencies:
   ```bash
   cd frontend
   npm install
   ```

3. Create environment file:
   ```bash
   cp .env.example .env.local
   ```

4. Add your API keys to `.env.local`:
   ```env
   GOOGLE_API_KEY=your_google_api_key
   NEXT_PUBLIC_ELEVENLABS_AGENT_ID=your_agent_id
   ELEVENLABS_API_KEY=your_elevenlabs_api_key
   ELEVENLABS_VOICE_ID=your_voice_id
   ```

5. Start the development server:
   ```bash
   npm run dev
   ```

6. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Project Structure

```
VisionVoice/
├── frontend/           # Next.js application
│   ├── src/
│   │   ├── app/       # App router pages
│   │   ├── components/ # React components
│   │   └── lib/       # Utilities and API clients
│   └── public/        # Static assets
└── docs/              # Documentation
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `GOOGLE_API_KEY` | Google AI API key for Gemini Vision |
| `NEXT_PUBLIC_ELEVENLABS_AGENT_ID` | ElevenLabs Conversational AI agent ID |
| `ELEVENLABS_API_KEY` | ElevenLabs API key for TTS |
| `ELEVENLABS_VOICE_ID` | Voice ID for consistent TTS voice |

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is open source and available under the [MIT License](LICENSE).

---

Built for the ElevenLabs Challenge | AI Partner Catalyst Hackathon 2025
