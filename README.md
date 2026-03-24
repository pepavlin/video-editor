# Local Video Editor

Fast local video editor for music shorts. Runs entirely offline.

## Quick Start

### Docker (recommended)

```bash
docker compose up --build
open http://localhost:3000
```

First build takes a few minutes (installs ffmpeg, Python, Node deps). Workspace data persists in a Docker volume.

### Local (macOS)

```bash
brew install ffmpeg node python3
pip3 install -r requirements.txt

# Optional: lyrics alignment (~1.5GB)
pip3 install openai-whisper

# Optional: cutout effect
pip3 install rembg onnxruntime pillow

npm install
npm run dev
```

Open `http://localhost:3000`.

---

## Features

- **Import** — MP4, MOV, MP3, WAV, M4A; 540p proxy created on import
- **Timeline** — 2 video tracks + master audio, non-destructive JSON EDL
- **Editing** — drag to move, drag edges to trim, snap to clips & beats
- **Beat detection** — librosa; beat markers on timeline + Beat Zoom effect
- **Lyrics overlay** — Whisper word alignment, auto-split into per-word clips
- **Cutout effect** — rembg person segmentation mask
- **AI style** — painterly stylization with optical-flow temporal consistency
- **Export** — ffmpeg filtergraph, H.264, 1080×1920

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play / Pause |
| `S` | Split clip at playhead |
| `Delete` | Delete selected clip |
| `Cmd+Z` / `Shift+Cmd+Z` | Undo / Redo |
| `Cmd+C` / `Cmd+V` | Copy / Paste clip |

---

## Architecture

```
apps/api/       Fastify 4 backend (port 3001)
apps/web/       Next.js 14 frontend (port 3000)
packages/shared TypeScript types
scripts/        Python processing scripts
workspace/      Assets & projects (configurable via WORKSPACE_DIR)
```

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/assets/import` | Upload file |
| GET | `/api/assets` | List assets |
| POST | `/api/assets/:id/analyze-beats` | Beat detection job |
| POST | `/api/assets/:id/cutout` | Person cutout job |
| POST | `/api/assets/:id/ai-style` | AI stylization job |
| POST/GET/PUT | `/api/projects[/:id]` | Project CRUD |
| POST | `/api/projects/:id/align-lyrics` | Lyrics alignment job |
| POST | `/api/projects/:id/export` | Export job |
| GET | `/api/jobs/:id/status` | Job status + log |
| GET | `/files/**` | Serve workspace files |

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | API port |
| `WORKSPACE_DIR` | `./workspace` | Assets & projects storage |
| `PYTHON_BIN` | `python3` | Python executable |
| `FFMPEG_BIN` | `ffmpeg` | ffmpeg executable |
| `CORS_ORIGIN` | `http://localhost:3000` | Allowed CORS origin |

---

## Development

```bash
npm run dev          # API + Web concurrently
npm run build        # shared → api → web
npm run test -w apps/api
npm run test -w apps/web
```
