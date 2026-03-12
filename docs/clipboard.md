# Clipboard (Copy / Paste)

## Overview

The clipboard feature allows users to duplicate visual elements in the preview by selecting a clip and pressing `Ctrl+C` (copy) followed by `Ctrl+V` (paste). The pasted clip is placed in a new timeline track with a slight diagonal offset so it's visually distinguishable from the original.

## How It Works

### Copy (`Ctrl+C` / `Cmd+C`)

1. Requires a selected clip in the editor
2. Deep-clones the selected clip's data (transform, styles, effects config, timing)
3. If the clip belongs to a **video track**, also collects all associated **effect tracks** whose clips overlap the copied clip's time range
4. Stores everything in an in-memory `ClipboardData` object (not the OS clipboard)

### Paste (`Ctrl+V` / `Cmd+V`)

1. Creates a **new track** of the same type as the source (e.g., video → video, text → text)
2. Generates new unique IDs for the pasted clip and track
3. Applies a **diagonal offset** (+30px right, +30px down) to the clip's `transform` so the copy doesn't overlap the original exactly
4. Recreates associated **effect tracks** linked to the new video track (with new IDs)
5. Automatically selects the newly pasted clip
6. The paste updates the undo history so it can be reversed with `Ctrl+Z`

### What Gets Copied

| Clip type | Copied data |
|-----------|-------------|
| Video     | assetId, transform, audio settings, source trim, **all overlapping effect tracks** |
| Text      | textContent, textStyle, transform |
| Rectangle | rectangleStyle, transform |
| Lyrics    | lyricsContent, lyricsWords, lyricsStyle, transform |
| Audio     | assetId, source trim (no transform offset since audio has no position) |

### What Does NOT Get Copied

- Effect clips cannot be copied directly (they are always copied as part of their parent video clip)
- The OS clipboard is not used — copy/paste is internal to the editor session

## Architecture

```
packages/shared/src/types.ts
  └── ClipboardData, ClipboardEffectTrack  ← type definitions

apps/web/src/hooks/useClipboard.ts
  ├── buildClipboardData()   ← pure function: project + clipId → ClipboardData
  ├── applyPaste()           ← pure function: project + clipboard → updated project
  └── useClipboard()         ← React hook wrapping state + copy/paste callbacks

apps/web/src/components/Editor.tsx
  └── Keyboard handler (Ctrl+C / Ctrl+V) → calls clipboard.copy() / clipboard.paste()
```

### Design Decisions

- **Pure functions** (`buildClipboardData`, `applyPaste`) are separated from the React hook for testability. All logic can be unit-tested without rendering React components.
- **New track per paste**: Each paste creates a new track rather than adding to an existing one. This avoids conflicts with overlapping clips and matches the user expectation of creating an independent copy.
- **Diagonal offset**: The 30px offset (defined as `PASTE_OFFSET` constant) ensures the pasted element is visually distinguishable in the preview canvas. Only applies to clips that have a `transform` property.
- **Effect track cloning**: Effect tracks are cloned with their `parentTrackId` pointing to the new video track, maintaining the same parent-child relationship as the original.

## Testing

Tests are in `apps/web/src/__tests__/useClipboard.test.ts` and cover:
- Copy of each clip type (video, text, rectangle, audio)
- Effect track inclusion/exclusion based on overlap
- Deep clone independence (no shared references)
- Paste ID generation uniqueness
- Transform offset application
- Multiple paste operations producing independent copies
- Full copy→paste integration cycle
