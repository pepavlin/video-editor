# Local Video Editor — MVP

Fast local video editor for music shorts. Runs entirely offline.

## Quick Start

**Docker (recommended):**
```bash
docker compose up --build
open http://localhost:3000
```
First build takes a few minutes (ffmpeg, Python, Node deps). Data persists in `video-editor_workspace` volume.

**Local (macOS):**
```bash
brew install ffmpeg node python3
pip3 install -r requirements.txt
npm install && npm run dev
```
Open `http://localhost:3000`. Optional: `pip3 install openai-whisper` (lyrics, ~1.5GB), `pip3 install rembg onnxruntime pillow` (cutout).

---

## Features

- Import MP4/MOV/MP3/WAV/M4A → 540p proxy for fast editing
- Multi-track timeline — drag, trim, split (`S`), delete, copy/paste
- Beat detection (librosa) with snap and Beat Zoom effect
- Lyrics alignment (Whisper) → word-level subtitle clips
- AI painterly stylization and person cutout (optional)
- Export to 1080×1920 H.264 via ffmpeg filter_complex
- Undo/Redo, non-destructive JSON EDL

**Shortcuts:** `Space` play/pause · `S` split · `Delete` delete · `Cmd+Z/Y` undo/redo · `Cmd+C/V` copy/paste

---

## Architecture

```
packages/shared/   TypeScript types
apps/api/          Fastify 4, port 3001
apps/web/          Next.js 14, port 3000
scripts/           Python: beat_detect, align_lyrics, cutout, ai_style
workspace/         Assets, projects, exports (WORKSPACE_DIR env)
```

**Background jobs** (import, beats, lyrics, cutout, export) are Python child processes tracked via `GET /api/jobs/:id/status`.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | API port |
| `WORKSPACE_DIR` | `./workspace` | Data directory |
| `PYTHON_BIN` | `python3` | Python executable |
| `FFMPEG_BIN` | `ffmpeg` | ffmpeg executable |
| `CORS_ORIGIN` | `http://localhost:3000` | Allowed origin |
| `NEXT_PUBLIC_API_URL` | `http://localhost:3001` | API URL |

---

## Development

```bash
npm run dev          # API :3001 + Web :3000
npm run build        # shared → api → web
npm run test -w apps/api
npm run test -w apps/web
```
