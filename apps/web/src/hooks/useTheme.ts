'use client';

import { useState, useEffect, useCallback } from 'react';

export type Theme = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'video-editor-theme';

function getSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolveTheme(theme: Theme): 'light' | 'dark' {
  return theme === 'system' ? getSystemTheme() : theme;
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (resolveTheme(theme) === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>('light');

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
    const initial = stored ?? 'system';
    setTheme(initial);
    applyTheme(initial);
  }, []);

  // Re-apply when OS preference changes while in system mode
  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => applyTheme('system');
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next: Theme = prev === 'light' ? 'dark' : prev === 'dark' ? 'system' : 'light';
      localStorage.setItem(STORAGE_KEY, next);
      applyTheme(next);
      return next;
    });
  }, []);

  return { theme, isDark: resolveTheme(theme) === 'dark', toggleTheme };
}
