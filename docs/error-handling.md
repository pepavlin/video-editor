# Error Handling

## Overview

The application has a multi-layered error handling system that ensures errors are always visible and debuggable.

## Layers

### 1. Toast Notifications (transient)
- Auto-dismiss after 5 seconds
- Max 4 visible at once
- Fixed bottom-right position
- Used for both success/info messages and error summaries

### 2. Error Log Panel (persistent)
- Fixed bottom-left toggle button with error count badge
- Collapsible panel showing all errors with:
  - Source label (AI Style, Cutout, Export, etc.)
  - Timestamp
  - Error message
  - Expandable log details (last stderr lines from the process)
- Errors persist until manually dismissed or cleared
- Unread indicator dot when new errors arrive while panel is closed
- Max 50 errors retained (rolling buffer)

### 3. Global Error Catcher
- `window.error` and `window.unhandledrejection` listeners
- Catches any uncaught exceptions and promise rejections
- Automatically logged to the Error Log panel

## Error Flow

1. **Backend process fails** → `jobQueue.ts` captures last 20 stderr lines, builds descriptive error message with exit code + last 5 meaningful stderr lines
2. **Job status polling** → `Editor.tsx` polling loop detects `ERROR` status, calls `notifyError()` with the job's error message and `lastLogLines`
3. **`notifyError()`** → Shows transient toast AND adds persistent entry to ErrorLog with full details
4. **API call fails** → `apiFetch()` in `api.ts` throws with server error message, caught in handler, logged via `notifyError()`

## Key Files

- `apps/web/src/hooks/useErrorLog.ts` — Error state management hook
- `apps/web/src/components/ErrorLog.tsx` — Error log panel UI
- `apps/web/src/components/Editor.tsx` — `notifyError()` helper, global error listeners, job polling error detection
- `apps/api/src/services/jobQueue.ts` — Process stderr capture, descriptive error messages
- `apps/api/src/routes/assets.ts` — Endpoint-level try-catch with descriptive errors

## Error Sources

| Source | Label | Typical Cause |
|--------|-------|---------------|
| `aiStyle` | AI Style | Python script failure, missing dependencies, GPU issues |
| `cutout` | Cutout | rembg not installed, model download failure |
| `headStab` | Head Stabilization | Face detection failure, ffmpeg error |
| `export` | Export | FFmpeg filter error, missing assets |
| `beats` | Beat Detection | Audio analysis failure |
| `lyrics` | Lyrics | Whisper not installed, alignment failure |
| `sync` | Audio Sync | Cross-correlation failure |
| `import` | Import | File format not supported |
| `network` | Network | API unreachable |
| `unknown` | Error | Uncaught exceptions |
