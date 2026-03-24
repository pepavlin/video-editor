# Local Video Editor — MVP

Fast local video editor for music shorts. Runs entirely offline.

## Quick Start

**Docker (recommended):**
```bash
docker compose up --build
# open http://localhost:3000
```
First build takes a few minutes (installs ffmpeg, Python, Node deps). Data persists in `video-editor_workspace` volume.

**Local (macOS):**
```bash
brew install ffmpeg node python3
pip3 install -r requirements.txt
npm install && npm run dev
# open http://localhost:3000
```

Optional features: `pip3 install openai-whisper` (lyrics, ~1.5GB) · `pip3 install rembg onnxruntime pillow` (cutout)

---

## Features

- Import MP4/MOV/MP3/WAV — proxy (540p) created automatically
- Multi-track timeline — drag, trim, split (`S`), delete, copy-paste (`Cmd+C/V`)
- Snap to clip edges and beat markers · Undo/Redo (`Cmd+Z`)
- Beat detection (librosa) → Beat Zoom effect
- Lyrics alignment (Whisper) → word-level subtitle clips
- Export: ffmpeg filtergraph, H.264, 1080×1920

**Shortcuts:** `Space` play/pause · `S` split · `Delete` delete · `Cmd+Z/Shift+Cmd+Z` undo/redo

---

## Structure

```
packages/shared/     # TypeScript types
apps/api/            # Fastify API (:3001)
apps/web/            # Next.js UI (:3000)
scripts/             # Python: beat_detect, align_lyrics, cutout, ai_style
workspace/           # Assets & projects (auto-created)
```

## Dev Commands

```bash
npm run dev          # API + Web concurrently
npm run build        # shared → api → web
npm run test -w apps/api
npm run test -w apps/web
```

## Key API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/assets/import` | Upload file |
| POST | `/api/assets/:id/analyze-beats` | Beat detection job |
| POST | `/api/assets/:id/cutout` | Person cutout job |
| POST | `/api/assets/:id/ai-style` | AI stylization job |
| POST | `/api/projects/:id/align-lyrics` | Lyrics alignment job |
| POST | `/api/projects/:id/export` | Export job |
| GET | `/api/jobs/:id/status` | Job status + log |
| GET | `/files/**` | Serve workspace files |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | API port |
| `WORKSPACE_DIR` | `./workspace` | Data directory |
| `PYTHON_BIN` | `python3` | Python executable |
| `FFMPEG_BIN` | `ffmpeg` | ffmpeg executable |
| `CORS_ORIGIN` | `http://localhost:3000` | Allowed origin |
