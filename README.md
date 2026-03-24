# Local Video Editor

Fast local video editor for music shorts. Runs entirely offline.

## Quick Start

**Docker (recommended):**
```bash
docker compose up --build
open http://localhost:3000
```

**Local (macOS):**
```bash
brew install ffmpeg node python3
pip3 install -r requirements.txt
npm install && npm run dev
```
Optional: `pip3 install openai-whisper` (lyrics, ~1.5GB) · `pip3 install rembg onnxruntime pillow` (cutout)

---

## Features

- Import MP4/MOV/MP3/WAV/M4A — 540p proxy created automatically
- Multi-track timeline — drag, trim, split (`S`), delete, copy/paste
- Snap to clip edges and beat markers
- Beat detection (librosa) + Beat Zoom effect
- Lyrics overlay — paste lyrics → Whisper word-level alignment
- Canvas preview synced to WebAudio playback
- Export: 1080×1920 H.264 via ffmpeg filtergraph
- Undo/Redo (`Cmd+Z` / `Shift+Cmd+Z`)

---

## Development

```bash
npm run dev        # API :3001 + Web :3000
npm run build      # shared → api → web
npm run test -w apps/api
npm run test -w apps/web
```

Key env vars: `WORKSPACE_DIR` (default `./workspace`), `PORT` (default `3001`).

---

## Stack

- `apps/api` — Fastify 4 (Node.js + TypeScript)
- `apps/web` — Next.js 14
- `packages/shared` — shared TypeScript types
- `scripts/` — Python: `beat_detect.py`, `align_lyrics.py`, `cutout.py`, `ai_style.py`
