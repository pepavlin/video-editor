# Local Video Editor — MVP

Fast local video editor for music shorts. Runs entirely offline.

## Quick Start

**Docker (recommended):**
```bash
docker compose up --build
# Open http://localhost:3000
```
First build takes a few minutes (ffmpeg, Python, Node deps). Workspace data persists in `video-editor_workspace` volume.

**Local (macOS):**
```bash
brew install ffmpeg node python3
pip3 install -r requirements.txt
npm install
npm run dev
# Open http://localhost:3000
```

Optional deps: `pip3 install openai-whisper` (lyrics, ~1.5GB) · `pip3 install rembg onnxruntime pillow` (cutout)

---

## Features

- **Import** — MP4, MOV, MP3, WAV, M4A → auto 540p proxy + waveform
- **Timeline** — 2 video tracks + master audio, drag/trim/split/copy-paste
- **Snap** — to clip edges and beat markers
- **Undo/Redo** — full history
- **Beat detection** — librosa, shown as timeline markers
- **Beat Zoom effect** — zoom pulse on each beat (configurable per clip)
- **Lyrics overlay** — Whisper word-level alignment, auto-split into clips
- **Cutout** — rembg person mask
- **AI Style** — painterly stylization (OpenCV + optical flow)
- **Export** — ffmpeg filter_complex, H.264, 1080×1920

### Keyboard Shortcuts
| Key | Action |
|-----|--------|
| `Space` | Play / Pause |
| `S` | Split at playhead |
| `Delete` | Delete selected clip |
| `Cmd+Z` / `Shift+Cmd+Z` | Undo / Redo |
| `Cmd+C` / `Cmd+V` | Copy / Paste clip |

---

## Architecture

```
packages/shared     — TypeScript types
apps/api            — Fastify 4, port 3001
apps/web            — Next.js 14, port 3000
scripts/            — Python: beat_detect, align_lyrics, cutout, ai_style
workspace/          — assets/<id>/ + projects/<id>/
```

Projects are stored as JSON EDL — originals are never modified.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | API port |
| `WORKSPACE_DIR` | `./workspace` | Assets/projects storage |
| `PYTHON_BIN` | `python3` | Python executable |
| `FFMPEG_BIN` | `ffmpeg` | ffmpeg executable |
| `CORS_ORIGIN` | `http://localhost:3000` | Allowed CORS origin |
| `NEXT_PUBLIC_API_URL` | `http://localhost:3001` | API URL for web rewrites |
