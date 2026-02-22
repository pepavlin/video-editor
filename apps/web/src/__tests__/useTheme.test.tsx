import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTheme } from '../hooks/useTheme';

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();

// Mock matchMedia
function mockMatchMedia(prefersDark: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: prefersDark && query === '(prefers-color-scheme: dark)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useTheme', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', { value: localStorageMock, writable: true });
    localStorageMock.clear();
    document.documentElement.classList.remove('dark');
    mockMatchMedia(false);
  });

  afterEach(() => {
    document.documentElement.classList.remove('dark');
  });

  it('defaults to light mode when no preference is stored', () => {
    const { result } = renderHook(() => useTheme());
    // After effect runs
    expect(result.current.theme).toBe('light');
    expect(result.current.isDark).toBe(false);
  });

  it('reads stored dark theme from localStorage', () => {
    localStorageMock.setItem('video-editor-theme', 'dark');
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('dark');
    expect(result.current.isDark).toBe(true);
  });

  it('reads stored light theme from localStorage', () => {
    localStorageMock.setItem('video-editor-theme', 'light');
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('light');
    expect(result.current.isDark).toBe(false);
  });

  it('respects system dark preference when nothing is stored', () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('dark');
    expect(result.current.isDark).toBe(true);
  });

  it('toggleTheme switches from light to dark', () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('light');

    act(() => {
      result.current.toggleTheme();
    });

    expect(result.current.theme).toBe('dark');
    expect(result.current.isDark).toBe(true);
    expect(localStorageMock.getItem('video-editor-theme')).toBe('dark');
  });

  it('toggleTheme switches from dark to light', () => {
    localStorageMock.setItem('video-editor-theme', 'dark');
    const { result } = renderHook(() => useTheme());

    act(() => {
      result.current.toggleTheme();
    });

    expect(result.current.theme).toBe('light');
    expect(result.current.isDark).toBe(false);
    expect(localStorageMock.getItem('video-editor-theme')).toBe('light');
  });

  it('toggleTheme adds dark class to document element', () => {
    const { result } = renderHook(() => useTheme());

    act(() => {
      result.current.toggleTheme();
    });

    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('toggleTheme removes dark class when switching to light', () => {
    localStorageMock.setItem('video-editor-theme', 'dark');
    document.documentElement.classList.add('dark');
    const { result } = renderHook(() => useTheme());

    act(() => {
      result.current.toggleTheme();
    });

    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('persists theme across multiple toggles', () => {
    const { result } = renderHook(() => useTheme());

    act(() => { result.current.toggleTheme(); }); // light -> dark
    expect(result.current.theme).toBe('dark');

    act(() => { result.current.toggleTheme(); }); // dark -> light
    expect(result.current.theme).toBe('light');

    act(() => { result.current.toggleTheme(); }); // light -> dark
    expect(result.current.theme).toBe('dark');

    expect(localStorageMock.getItem('video-editor-theme')).toBe('dark');
  });
});
