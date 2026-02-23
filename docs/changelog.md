# Changelog Feature

## Overview

The changelog lets users see what changed after a new version is deployed. It integrates with the existing version-check system: when a user lands on a newly deployed build, the "Vítejte v nové verzi!" (Welcome to the new version!) banner includes a **"Co je nového?"** (What's new?) button that opens the changelog modal.

## Architecture

```
apps/web/src/
  data/changelog.ts        ← changelog data (TypeScript array, update on each deploy)
  components/
    ChangelogModal.tsx     ← self-contained modal, listens for 'open-changelog' event
    VersionBanner.tsx      ← shows "Co je nového?" button in welcome state
  app/layout.tsx           ← renders <ChangelogModal /> so it's globally available
```

## How It Works

1. `ChangelogModal` mounts in `layout.tsx` but renders `null` until opened.
2. Anything can open it by dispatching `window.dispatchEvent(new CustomEvent('open-changelog'))`.
3. `VersionBanner` dispatches this event when the user clicks "Co je nového?" on the welcome banner.
4. The modal reads from `src/data/changelog.ts` — no API calls, data is bundled at build time.

## How to Update the Changelog

After merging a set of changes and before deploying, add an entry at the **top** of the `CHANGELOG` array in `apps/web/src/data/changelog.ts`:

```ts
{
  date: 'YYYY-MM-DD',
  title: 'DD. měsíce YYYY',   // Czech date format, e.g. "23. února 2026"
  items: [
    'Popis změny 1',
    'Popis změny 2',
  ],
},
```

Keep items short and user-facing (avoid internal refactor notes). The most recent entry is automatically labeled **"nejnovější"** in the UI.

## Custom Event

The constant `OPEN_CHANGELOG_EVENT = 'open-changelog'` is exported from `ChangelogModal.tsx`. Import it anywhere you need to trigger the modal programmatically:

```ts
import { OPEN_CHANGELOG_EVENT } from '@/components/ChangelogModal';
window.dispatchEvent(new CustomEvent(OPEN_CHANGELOG_EVENT));
```
