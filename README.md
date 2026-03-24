# Local Video Editor — MVP

Fast local video editor for music shorts. Runs entirely offline. UI at `localhost:3000`, API at `localhost:3001`.

## Quick Start

**Docker (recommended):**
```bash
docker compose up --build
open http://localhost:3000
```
First build takes a few minutes (installs ffmpeg, Python, Node deps). Workspace data persists in the `video-editor_workspace` Docker volume.

**Local (macOS):**
```bash
brew install ffmpeg node python3
pip3 install -r requirements.txt
# Optional: pip3 install openai-whisper   # lyrics alignment (~1.5GB)
# Optional: pip3 install rembg onnxruntime pillow  # cutout effect
npm install
npm run dev
```

## Features

- **Import** — MP4, MOV, MP3, WAV, M4A; 540p proxy created on import
- **Timeline** — 2 video tracks + master audio, non-destructive JSON EDL
- **Editing** — drag/trim clips, `S` split, `Delete` remove, `Cmd+C/V` copy-paste, snap to edges & beats
- **Undo/Redo** — `Cmd+Z` / `Shift+Cmd+Z`
- **Beat detection** — librosa, shown as timeline markers
- **Beat Zoom effect** — configurable zoom pulse per beat
- **Lyrics overlay** — Whisper word alignment, auto-split into per-word clips
- **Cutout effect** — rembg person segmentation mask
- **AI style** — painterly stylization via OpenCV + DIS optical flow
- **Export** — ffmpeg filtergraph, H.264, 1080×1920

## Development

```bash
npm run dev          # API :3001 + Web :3000
npm run build        # shared → api → web
npm run test -w apps/api
npm run test -w apps/web
```

Key env vars: `WORKSPACE_DIR` (default `./workspace`), `PORT` (default `3001`).
