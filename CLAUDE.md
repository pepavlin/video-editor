# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development
```bash
npm run dev           # Start both API (3001) and Web (3000) concurrently
npm run dev:api       # API only (ts-node-dev with auto-respawn)
npm run dev:web       # Web only (Next.js dev)
docker compose up --build  # Full stack with Docker (recommended)
```

### Building
```bash
npm run build         # Build all: shared → api → web (in order)
npm run build:shared  # Build shared types only
npm run build -w apps/api
npm run build -w apps/web
```

### Testing
```bash
npm run test -w apps/api    # Run API tests (Vitest)
npm run test -w apps/web    # Run Web tests (Vitest + jsdom)
npm run test:watch -w apps/api
npm run test:watch -w apps/web
```

## Architecture

Monorepo with npm workspaces:
- `packages/shared` — TypeScript types only, compiled to `dist/`, consumed by both apps
- `apps/api` — Fastify 4 backend, port 3001
- `apps/web` — Next.js 14 frontend, port 3000
- `scripts/` — Python processing scripts (beat_detect.py, align_lyrics.py, cutout.py)

### Data Flow

All persistent data lives in `./workspace/` (configurable via `WORKSPACE_DIR` env):
- `workspace/assets/<id>/` — original, proxy (540p), audio extract, waveform, beats, mask
- `workspace/projects/<id>/` — project.json (JSON EDL, non-destructive)

The API serves `/files/*` as static files from the workspace dir. Next.js rewrites both `/api/*` and `/files/*` to `http://localhost:3001`.

### API Structure (`apps/api/src/`)

- `index.ts` — Fastify app setup, route registration
- `config.ts` — Environment config
- `routes/assets.ts` — Asset import, listing, waveform, beat detection, cutout
- `routes/projects.ts` — Project CRUD, lyrics alignment, export
- `routes/jobs.ts` — Job status polling, output file download
- `services/workspace.ts` — File I/O, JSON persistence
- `services/jobQueue.ts` — Background job tracking, spawns child processes
- `services/ffmpegService.ts` — ffprobe metadata, import pipeline, export with filter_complex
- `services/waveform.ts` — Waveform data generation

**Background jobs** (tracked via `GET /api/jobs/:id/status`): import, beats, lyrics, cutout, export. Python scripts are spawned as child processes by jobQueue.

### Web Structure (`apps/web/src/`)

- `app/page.tsx` — Single page, dynamically imports Editor (ssr: false for WebAudio)
- `components/Editor.tsx` — Main orchestrator
- `components/Timeline.tsx` — Clip drag/trim/snap UI
- `components/Preview.tsx` — Canvas-based video preview
- `components/Inspector.tsx` — Property panel for selected clip
- `components/MediaBin.tsx` — Asset list and import
- `hooks/useProject.ts` — Project state management
- `hooks/usePlayback.ts` — WebAudio playback (source of truth for timeline sync)
- `hooks/useHistory.ts` — Undo/redo stack
- `lib/api.ts` — API client wrapper

**reactStrictMode is disabled** in next.config.mjs for WebAudio API compatibility.

### Shared Types (`packages/shared/src/types.ts`)

Key types:
- `Project` / `Track` / `Clip` — EDL structure (JSON-serializable)
- `Asset` — Media file with paths to all derived files
- `Effect` — `BeatZoomEffect | CutoutEffect` (union type — requires `as Effect` cast when spreading)
- `Job` — Background job with status, progress, log lines
- `LyricsData` / `WordTimestamp` — Word-level subtitle alignment

## Key Constraints

- **Build order matters**: shared must build before api or web
- **Effect union type**: When constructing/spreading Effect objects, cast with `as Effect`
- **String spreading**: Use `charCodeAt` loop instead of `[...str]` spread in TypeScript
- **WebAudio**: Editor component must be dynamically imported with `ssr: false`
- **Path traversal**: Job output download validates resolved paths are within workspace
- **Python deps**: openai-whisper (~1.5GB) and rembg are optional — features degrade gracefully if absent
