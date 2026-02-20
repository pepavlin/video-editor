# Local Video Editor — MVP

Fast local video editor for music shorts. Runs entirely offline. UI at `localhost:3000`, API at `localhost:3001`.

## Quick Start — Docker Compose (recommended)

```bash
# Clone / enter project
cd video-editor

# Build and start both services
docker compose up --build

# Open browser
open http://localhost:3000
```

**Note:** First build installs ffmpeg, Python, and Node.js deps — takes a few minutes. Subsequent starts are fast.

The workspace data (assets, projects) is persisted in a Docker volume `video-editor_workspace`.

---

## Quick Start — Local (macOS)

### Prerequisites

```bash
# Install ffmpeg
brew install ffmpeg

# Install Node.js 20+
brew install node

# Install Python 3.10+ and pip
brew install python3

# Install Python dependencies
pip3 install -r requirements.txt

# For lyrics alignment (optional, ~1.5GB download)
pip3 install openai-whisper

# For cutout effect (optional)
pip3 install rembg onnxruntime pillow
```

### Install & Run

```bash
# Install all Node packages
npm install

# Start both API (port 3001) and Web (port 3000)
npm run dev
```

Open `http://localhost:3000`.

---

## Architecture

```
video-editor/
├── docker-compose.yml         # Docker orchestration
├── requirements.txt           # Python deps
├── packages/
│   └── shared/                # Shared TypeScript types
└── apps/
    ├── api/                   # Fastify API (Node.js + TypeScript)
    │   └── Dockerfile
    └── web/                   # Next.js UI
        └── Dockerfile
scripts/
├── beat_detect.py             # librosa beat detection
├── align_lyrics.py            # Whisper word alignment
└── cutout.py                  # rembg person cutout
```

### Workspace layout

```
workspace/
├── assets.json                # Asset index
├── assets/
│   └── <assetId>/
│       ├── original.*         # Original file
│       ├── proxy.mp4          # 540p proxy (for editing)
│       ├── audio.wav          # Extracted PCM audio
│       ├── waveform.json      # Amplitude data for UI
│       ├── beats.json         # Beat timestamps (optional)
│       └── mask.mp4           # Person mask (optional)
└── projects/
    └── <projectId>/
        ├── project.json       # Project EDL
        ├── words.json         # Aligned lyrics (optional)
        ├── lyrics.ass         # Generated subtitles (optional)
        └── exports/           # Exported MP4 files
```

---

## Features

### MVP
- **Asset import** — drag & drop or click Import (MP4, MOV, MP3, WAV, M4A)
- **Proxy rendering** — 540p proxy created on import for fast editing
- **Waveform** — computed from extracted audio WAV
- **Multi-track timeline** — 2 video tracks + master audio
- **Non-destructive editing** — project is a JSON EDL, originals untouched
- **Clip operations** — drag to move, drag edges to trim, `S` to split, `Delete` to delete
- **Snap** — snaps to clip edges and beat markers
- **Undo/Redo** — `Cmd+Z` / `Shift+Cmd+Z`
- **Audio playback** — master song via WebAudio API (audio is source of truth for sync)
- **Canvas preview** — proxy videos rendered to canvas, synced to audio playhead
- **Beat markers** — click "Analyze Beats" → librosa detects beats, shown on timeline
- **Beat Zoom effect** — automatic zoom pulse on each beat (configurable per-clip)
- **Lyrics overlay** — paste lyrics → "Align Lyrics" → Whisper aligns word timestamps
- **Export** — ffmpeg filtergraph, H.264, default 1080×1920

### Keyboard Shortcuts
| Key | Action |
|-----|--------|
| `Space` | Play / Pause |
| `S` | Split clip at playhead |
| `Delete` | Delete selected clip |
| `Cmd+Z` | Undo |
| `Shift+Cmd+Z` | Redo |

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/assets/import` | Upload video/audio file |
| GET | `/api/assets` | List all assets |
| GET | `/api/assets/:id/waveform` | Get waveform data |
| GET | `/api/assets/:id/beats` | Get beat timestamps |
| POST | `/api/assets/:id/analyze-beats` | Start beat detection job |
| POST | `/api/assets/:id/cutout` | Start person cutout job |
| POST | `/api/projects` | Create new project |
| GET | `/api/projects` | List projects |
| GET | `/api/projects/:id` | Load project |
| PUT | `/api/projects/:id` | Save project |
| POST | `/api/projects/:id/align-lyrics` | Start lyrics alignment job |
| POST | `/api/projects/:id/export` | Start export job |
| GET | `/api/jobs/:id/status` | Get job status + log |
| GET | `/api/jobs/:id/output` | Download job output |
| GET | `/files/**` | Serve workspace files (proxy, audio, etc.) |

---

## Python Scripts

All scripts are run by the API as child processes.

### beat_detect.py
```bash
python3 scripts/beat_detect.py <audio.wav> <beats.json>
```
Uses `librosa.beat.beat_track()`. Outputs `{ tempo, beats: [...timestamps...] }`.

### align_lyrics.py
```bash
python3 scripts/align_lyrics.py <audio.wav> <lyrics.txt> <words.json>
```
Uses OpenAI Whisper with `word_timestamps=True`. Maps Whisper transcription to provided lyrics via fuzzy matching. Outputs `[{ word, start, end }, ...]`.

### cutout.py
```bash
python3 scripts/cutout.py <input.mp4> <mask.mp4>
```
Uses `rembg` with `u2net_human_seg` model. Extracts frames, removes background, outputs grayscale mask video. Requires: `pip3 install rembg onnxruntime pillow`.

---

## Export Pipeline

Export uses ffmpeg's `filter_complex` to:
1. Layer video clips on a black canvas with correct timing (`overlay` with `enable='between(t,...)'`)
2. Apply smart crop / scaling per clip
3. Beat Zoom: per-beat `scale` filter with `enable` expression
4. Mix audio: master song + optional clip audio via `amix`
5. Burn-in lyrics via `subtitles=lyrics.ass` filter

Output: 1080×1920 (default), H.264, CRF 20, preset medium.

---

## Development

```bash
# Watch mode
npm run dev:api   # API on :3001 with ts-node-dev
npm run dev:web   # Web on :3000 with Next.js dev server

# Build
npm run build

# Just shared types
npm run build:shared
```

### Environment Variables

**API** (`apps/api`):
| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | API port |
| `WORKSPACE_DIR` | `./workspace` | Where assets/projects are stored |
| `SCRIPTS_DIR` | `../../scripts` | Path to Python scripts |
| `PYTHON_BIN` | `python3` | Python executable |
| `FFMPEG_BIN` | `ffmpeg` | ffmpeg executable |
| `CORS_ORIGIN` | `http://localhost:3000` | Allowed CORS origin |

**Web** (`apps/web`):
| Variable | Default | Description |
|----------|---------|-------------|
| `NEXT_PUBLIC_API_URL` | `http://localhost:3001` | API URL (used in rewrites) |

---

## Not Implemented (out of scope for MVP)

- Automatic cuts / AI editing
- Keyframing (except Beat Zoom which is procedural)
- Face tracking
- Complex audio mixer (just master + clip audio toggle)
- Cloud storage, accounts, databases
- Timeline zoom keyboard shortcut (use Ctrl+Scroll)
