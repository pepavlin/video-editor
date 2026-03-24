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

Optional Python deps: `openai-whisper` (~1.5GB, for lyrics), `rembg onnxruntime pillow` (for cutout).

---

## Features

- Import MP4/MOV/MP3/WAV/M4A — proxy + waveform auto-generated
- Multi-track timeline — drag, trim, split (`S`), delete, copy/paste
- Beat detection — librosa, shown as timeline markers
- Beat Zoom effect — zoom pulse on each beat
- Lyrics overlay — Whisper word alignment, per-chunk clips
- Export — ffmpeg filtergraph, H.264, 1080×1920

**Shortcuts:** `Space` play/pause · `S` split · `Del` delete · `Cmd+Z/Y` undo/redo · `Cmd+C/V` copy/paste

---

## Architecture

```
packages/shared/   — TypeScript types
apps/api/          — Fastify 4, port 3001
apps/web/          — Next.js 14, port 3000
scripts/           — Python: beat_detect, align_lyrics, cutout, ai_style
workspace/         — assets/<id>/, projects/<id>/
```

Data persisted in `./workspace/` (Docker volume: `video-editor_workspace`).

---

## API

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/assets/import` | Upload file |
| GET | `/api/assets` | List assets |
| POST | `/api/assets/:id/analyze-beats` | Beat detection job |
| POST | `/api/assets/:id/cutout` | Cutout job |
| POST | `/api/assets/:id/ai-style` | AI style job |
| POST | `/api/projects` | Create project |
| GET/PUT | `/api/projects/:id` | Load/save project |
| POST | `/api/projects/:id/align-lyrics` | Lyrics alignment job |
| POST | `/api/projects/:id/export` | Export job |
| GET | `/api/jobs/:id/status` | Job status |
| GET | `/files/**` | Serve workspace files |

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | API port |
| `WORKSPACE_DIR` | `./workspace` | Data directory |
| `PYTHON_BIN` | `python3` | Python executable |
| `FFMPEG_BIN` | `ffmpeg` | ffmpeg executable |
| `CORS_ORIGIN` | `http://localhost:3000` | Allowed origin |
