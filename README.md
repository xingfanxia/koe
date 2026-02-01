# Koe

Voice transcription desktop app for macOS with global hotkey support.

## Download

Download the latest `.dmg` from [Releases](https://github.com/nickguyai/koe/releases).

## Features

- Global hotkey-triggered audio recording
- Real-time voice transcription (OpenAI Whisper & Google Gemini)
- AI-powered text polishing
- Floating recording indicator
- Automatic text insertion at cursor

## Development

### Prerequisites

- Node.js 18+
- macOS (arm64)

### Setup

```bash
npm install
```

### Run

```bash
npm run dev
```

### Build

```bash
npm run dist
```

## Configuration

Koe requires API keys for transcription services. Configure them in the app settings:

- **OpenAI API Key** - for Whisper transcription and GPT text processing
- **Google Gemini API Key** - for Gemini-based transcription (optional)

## License

This project is licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE). You may use, modify, and distribute for noncommercial purposes only.
