# Local Video Editor — MVP

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

Optional: `pip3 install openai-whisper` (lyrics, ~1.5GB), `pip3 install rembg onnxruntime pillow` (cutout)

---

## Features

- Import MP4/MOV/MP3/WAV/M4A — proxy (540p) + waveform generated automatically
- Multi-track timeline — drag, trim, split (`S`), delete, copy/paste, snap to beats
- Beat detection (librosa) + Beat Zoom effect
- Lyrics alignment (Whisper) — word-level, auto-split into clips
- AI style / cutout effects (OpenCV, rembg)
- Export — ffmpeg filter_complex, H.264, 1080×1920

**Shortcuts:** `Space` play/pause · `S` split · `Delete` delete · `Cmd+Z/Shift+Z` undo/redo · `Cmd+C/V` copy/paste

---

## Stack

- `apps/api` — Fastify (port 3001)
- `apps/web` — Next.js 14 (port 3000)
- `packages/shared` — TypeScript types
- `scripts/` — Python (beat_detect, align_lyrics, cutout, ai_style)

Data stored in `workspace/assets/` and `workspace/projects/` (or Docker volume `video-editor_workspace`).

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | API port |
| `WORKSPACE_DIR` | `./workspace` | Assets/projects storage |
| `PYTHON_BIN` | `python3` | Python executable |
| `FFMPEG_BIN` | `ffmpeg` | ffmpeg executable |
| `CORS_ORIGIN` | `http://localhost:3000` | Allowed CORS origin |
