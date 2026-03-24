# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev                  # Start API (3001) + Web (3000)
npm run build                # Build all: shared → api → web
npm run test -w apps/api     # Vitest (API)
npm run test -w apps/web     # Vitest + jsdom (Web)
docker compose up --build    # Full stack with Docker
```

## Architecture

Monorepo (npm workspaces):
- `packages/shared` — TypeScript types, compiled to `dist/`
- `apps/api` — Fastify 4, port 3001
- `apps/web` — Next.js 14, port 3000
- `scripts/` — Python: beat_detect.py, align_lyrics.py, cutout.py, ai_style.py

All data in `./workspace/` (`WORKSPACE_DIR` env):
- `workspace/assets/<id>/` — original, proxy (540p), audio, waveform, beats, mask
- `workspace/projects/<id>/` — project.json (JSON EDL)

Next.js rewrites `/api/*` and `/files/*` to `http://localhost:3001`.

### API (`apps/api/src/`)
- `routes/assets.ts` — import, waveform, beats, cutout
- `routes/projects.ts` — CRUD, lyrics alignment, export
- `routes/jobs.ts` — job status + output download
- `services/jobQueue.ts` — background jobs, spawns Python child processes
- `services/ffmpegService.ts` — import pipeline, export with filter_complex

### Web (`apps/web/src/`)
- `components/Editor.tsx` — main orchestrator (dynamically imported, `ssr: false`)
- `components/Timeline.tsx` — drag/trim/snap
- `components/Preview.tsx` — canvas video preview
- `hooks/useProject.ts` — project state, `explodeLyricsClipToChunks`
- `hooks/usePlayback.ts` — WebAudio (source of truth for sync)

**reactStrictMode is disabled** in next.config.mjs for WebAudio compatibility.

### Shared Types (`packages/shared/src/types.ts`)
- `Project / Track / Clip` — EDL structure
- `Asset` — media file with derived file paths
- `Effect` — `BeatZoomEffect | CutoutEffect` union (requires `as Effect` cast when spreading)
- `Job` — background job with status, progress, log

### Lyrics Timing Model
Lyrics are split into per-chunk clips via `explodeLyricsClipToChunks`. Each clip's `lyricsWords` use **clip-relative timestamps**. On export, absolute time = `clip.timelineStart + word.start`.

## Key Constraints

- **Build order**: shared must build before api or web
- **Effect union**: cast with `as Effect` when constructing/spreading
- **String spreading**: use `charCodeAt` loop instead of `[...str]` in TypeScript
- **WebAudio**: Editor must be dynamically imported with `ssr: false`
- **Path traversal**: job output download validates paths are within workspace
- **Python deps**: openai-whisper and rembg are optional — degrade gracefully if absent
