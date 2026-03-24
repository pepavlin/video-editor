# Local Video Editor — MVP

Fast local video editor for music shorts. Runs entirely offline. UI at `localhost:3000`, API at `localhost:3001`.

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

Optional features:
- Lyrics alignment: `pip3 install openai-whisper` (~1.5GB)
- Cutout effect: `pip3 install rembg onnxruntime pillow`

---

## Features

- **Import** — MP4, MOV, MP3, WAV, M4A; auto-generates 540p proxy + waveform
- **Timeline** — 2 video tracks + master audio, non-destructive JSON EDL
- **Clip ops** — drag/trim, `S` split, `Delete`, `Cmd+C/V` copy-paste, snap to edges & beats
- **Undo/Redo** — `Cmd+Z` / `Shift+Cmd+Z`
- **Beat detection** — librosa; beat markers on timeline + Beat Zoom effect
- **Lyrics** — paste text → Whisper aligns word timestamps → per-word clips on timeline
- **Export** — ffmpeg filtergraph, H.264, 1080×1920

---

## Architecture

Monorepo (`npm workspaces`):
- `packages/shared` — TypeScript types
- `apps/api` — Fastify 4, port 3001
- `apps/web` — Next.js 14, port 3000
- `scripts/` — Python: `beat_detect.py`, `align_lyrics.py`, `cutout.py`, `ai_style.py`

Workspace data in `./workspace/` (`WORKSPACE_DIR` env):
- `assets/<id>/` — original, proxy, audio, waveform, beats, mask, ai_style
- `projects/<id>/` — project.json EDL, words.json, lyrics.ass, exports/

---

## Development

```bash
npm run dev         # API :3001 + Web :3000
npm run build       # shared → api → web
npm run test -w apps/api
npm run test -w apps/web
```

Key env vars — API: `PORT`, `WORKSPACE_DIR`, `PYTHON_BIN`, `FFMPEG_BIN`; Web: `NEXT_PUBLIC_API_URL`.
