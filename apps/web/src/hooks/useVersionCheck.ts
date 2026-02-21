'use client';

import { useEffect, useState, useCallback, useRef } from 'react';

const VERSION_KEY = 'app_last_seen_version';
const DISMISSED_BUILD_KEY = 'app_dismissed_build';
const POLL_INTERVAL_MS = 60_000; // check every 60 s
const INITIAL_POLL_DELAY_MS = 10_000; // first check after 10 s

export type VersionStatus = 'welcome' | 'update-available' | null;

/**
 * Detects two kinds of version changes:
 *
 * 1. "welcome"          – The user just loaded a build they haven't seen before
 *                         (compared against the last version stored in localStorage).
 *                         Shows a short "Welcome to the new version!" toast.
 *
 * 2. "update-available" – A newer build has been deployed while the user is still
 *                         on the old page (detected by polling /app-version).
 *                         Shows a persistent banner with a "Refresh" button.
 *
 * The build ID comes from Next.js's built-in __NEXT_DATA__.buildId, which is
 * automatically regenerated on every `next build` (see next.config.mjs).
 */
export function useVersionCheck(): { status: VersionStatus; dismiss: () => void } {
  const [status, setStatus] = useState<VersionStatus>(null);

  // Track which server build the user has already dismissed so polling
  // doesn't re-show the banner for the same build after the user closes it.
  const dismissedServerBuildRef = useRef<string | null>(null);
  const detectedServerBuildRef = useRef<string | null>(null);

  const dismiss = useCallback(() => {
    setStatus(null);
    // Remember the dismissed server build so the poll doesn't re-trigger it —
    // both in-memory (ref) and in localStorage so it persists across page loads.
    if (detectedServerBuildRef.current) {
      dismissedServerBuildRef.current = detectedServerBuildRef.current;
      localStorage.setItem(DISMISSED_BUILD_KEY, detectedServerBuildRef.current);
    }
  }, []);

  useEffect(() => {
    const currentBuildId: string =
      (window as unknown as { __NEXT_DATA__?: { buildId?: string } }).__NEXT_DATA__?.buildId ??
      'dev';

    // ── Restore previously dismissed server build from localStorage ───────────
    const persistedDismissed = localStorage.getItem(DISMISSED_BUILD_KEY);
    if (persistedDismissed) {
      dismissedServerBuildRef.current = persistedDismissed;
    }

    // ── Welcome detection ─────────────────────────────────────────────────────
    const lastSeenVersion = localStorage.getItem(VERSION_KEY);
    if (lastSeenVersion !== null && lastSeenVersion !== currentBuildId) {
      setStatus('welcome');
    }
    localStorage.setItem(VERSION_KEY, currentBuildId);

    // ── New-deploy polling ─────────────────────────────────────────────────────
    const checkServerVersion = async () => {
      try {
        const res = await fetch('/app-version', { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as { buildId?: string };
        if (
          data.buildId &&
          data.buildId !== currentBuildId &&
          data.buildId !== dismissedServerBuildRef.current
        ) {
          detectedServerBuildRef.current = data.buildId;
          setStatus('update-available');
        }
      } catch {
        // Silently ignore network errors — the user may be offline.
      }
    };

    const initialTimeout = setTimeout(checkServerVersion, INITIAL_POLL_DELAY_MS);
    const interval = setInterval(checkServerVersion, POLL_INTERVAL_MS);

    return () => {
      clearTimeout(initialTimeout);
      clearInterval(interval);
    };
  }, []); // runs once on mount

  return { status, dismiss };
}
