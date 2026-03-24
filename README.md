# Local Video Editor

Fast local video editor for music shorts. Runs entirely offline.

## Quick Start

**Docker (recommended):**
```bash
docker compose up --build
# open http://localhost:3000
```

**Local (macOS):**
```bash
brew install ffmpeg node python3
pip3 install -r requirements.txt
npm install && npm run dev
# open http://localhost:3000
```

Optional Python deps: `openai-whisper` (~1.5GB, for lyrics alignment), `rembg onnxruntime pillow` (for cutout effect).

## Features

- Import MP4/MOV/MP3/WAV — 540p proxy created automatically
- Multi-track timeline — drag, trim, split (`S`), delete, copy-paste
- Snap to clip edges and beat markers
- Beat detection (librosa) + Beat Zoom effect
- Lyrics alignment (Whisper) with word-level timestamps
- Canvas preview synced to WebAudio playback
- Undo/Redo (`Cmd+Z` / `Shift+Cmd+Z`)
- Export to 1080×1920 H.264 via ffmpeg filtergraph

## Stack

| Layer | Tech |
|-------|------|
| UI | Next.js 14 (`localhost:3000`) |
| API | Fastify 4 (`localhost:3001`) |
| Processing | Python scripts (beat, lyrics, cutout, ai-style) |
| Storage | Local `./workspace/` (assets + project JSON EDL) |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | API port |
| `WORKSPACE_DIR` | `./workspace` | Assets/projects storage |
| `PYTHON_BIN` | `python3` | Python executable |
| `FFMPEG_BIN` | `ffmpeg` | ffmpeg executable |
| `CORS_ORIGIN` | `http://localhost:3000` | Allowed CORS origin |
