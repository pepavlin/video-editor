import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVersionCheck } from '../hooks/useVersionCheck';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BUILD_ID_V1 = 'build-v1';
const BUILD_ID_V2 = 'build-v2';
const VERSION_KEY = 'app_last_seen_version';

function setNextDataBuildId(buildId: string) {
  (window as unknown as Record<string, unknown>).__NEXT_DATA__ = { buildId };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useVersionCheck', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    setNextDataBuildId(BUILD_ID_V1);

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ buildId: BUILD_ID_V1 }), { status: 200 }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete (window as unknown as Record<string, unknown>).__NEXT_DATA__;
  });

  it('returns null status on very first visit (no prior localStorage)', () => {
    const { result } = renderHook(() => useVersionCheck());
    expect(result.current.status).toBeNull();
  });

  it('stores the current build ID in localStorage on first visit', () => {
    renderHook(() => useVersionCheck());
    expect(localStorage.getItem(VERSION_KEY)).toBe(BUILD_ID_V1);
  });

  it('returns null status when user revisits the same version', () => {
    localStorage.setItem(VERSION_KEY, BUILD_ID_V1);
    const { result } = renderHook(() => useVersionCheck());
    expect(result.current.status).toBeNull();
  });

  it('returns "welcome" status when user sees a new build for the first time', () => {
    // User previously saw V1, now loading V2
    localStorage.setItem(VERSION_KEY, BUILD_ID_V1);
    setNextDataBuildId(BUILD_ID_V2);

    const { result } = renderHook(() => useVersionCheck());
    expect(result.current.status).toBe('welcome');
  });

  it('updates localStorage to the new build ID when showing welcome', () => {
    localStorage.setItem(VERSION_KEY, BUILD_ID_V1);
    setNextDataBuildId(BUILD_ID_V2);

    renderHook(() => useVersionCheck());
    expect(localStorage.getItem(VERSION_KEY)).toBe(BUILD_ID_V2);
  });

  it('dismiss() clears the status', () => {
    localStorage.setItem(VERSION_KEY, BUILD_ID_V1);
    setNextDataBuildId(BUILD_ID_V2);

    const { result } = renderHook(() => useVersionCheck());
    expect(result.current.status).toBe('welcome');

    act(() => {
      result.current.dismiss();
    });
    expect(result.current.status).toBeNull();
  });

  it('returns "update-available" when server reports a newer build', async () => {
    // Client is on V1, server returns V2
    setNextDataBuildId(BUILD_ID_V1);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ buildId: BUILD_ID_V2 }), { status: 200 }),
    );

    const { result } = renderHook(() => useVersionCheck());

    // Advance past the initial poll delay (10 s)
    await act(async () => {
      vi.advanceTimersByTime(10_001);
    });

    expect(result.current.status).toBe('update-available');
  });

  it('does not change status when server returns the same build ID', async () => {
    const { result } = renderHook(() => useVersionCheck());

    await act(async () => {
      vi.advanceTimersByTime(10_001);
    });

    expect(result.current.status).toBeNull();
  });

  it('does not throw when fetch fails (network error)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useVersionCheck());

    await act(async () => {
      vi.advanceTimersByTime(10_001);
    });

    expect(result.current.status).toBeNull();
  });

  it('does not change status when server returns non-ok response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Internal Server Error', { status: 500 }),
    );

    const { result } = renderHook(() => useVersionCheck());

    await act(async () => {
      vi.advanceTimersByTime(10_001);
    });

    expect(result.current.status).toBeNull();
  });

  it('polls again after the full interval (60 s)', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ buildId: BUILD_ID_V1 }), { status: 200 }),
    );

    renderHook(() => useVersionCheck());

    // Initial poll at 10 s
    await act(async () => {
      vi.advanceTimersByTime(10_001);
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Second poll at 10 + 60 s
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('cleans up timers on unmount', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ buildId: BUILD_ID_V1 }), { status: 200 }),
    );

    const { unmount } = renderHook(() => useVersionCheck());
    unmount();

    // Advancing time should NOT trigger any fetch after unmount
    await act(async () => {
      vi.advanceTimersByTime(70_001);
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not poll for updates when running in Next.js dev mode (buildId === "development")', async () => {
    // In `next dev`, Next.js always sets __NEXT_DATA__.buildId to 'development'.
    // Polling should be skipped entirely so no false-positive banner appears.
    setNextDataBuildId('development');
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ buildId: 'some-server-build' }), { status: 200 }),
    );

    const { result } = renderHook(() => useVersionCheck());

    await act(async () => {
      vi.advanceTimersByTime(70_001); // past initial delay + full interval
    });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.current.status).toBeNull();
  });

  it('falls back to "dev" build ID when __NEXT_DATA__ is absent', () => {
    delete (window as unknown as Record<string, unknown>).__NEXT_DATA__;
    localStorage.setItem(VERSION_KEY, 'some-old-value');

    const { result } = renderHook(() => useVersionCheck());
    // "dev" !== "some-old-value" → welcome should show
    expect(result.current.status).toBe('welcome');
    expect(localStorage.getItem(VERSION_KEY)).toBe('dev');
  });
});
