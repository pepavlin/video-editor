# Theming — Dark / Light Mode

## Overview

The app supports full dark/light mode switching with:
- Automatic detection of the OS/browser preference (`prefers-color-scheme`)
- Persistence across sessions via `localStorage` (`video-editor-theme`)
- No flash-of-wrong-theme on page load (inline script in `<head>`)
- Smooth `0.25s` transition on background and text colors

## Architecture

### CSS Custom Properties

All color tokens are defined as CSS custom properties in `apps/web/src/app/globals.css`:

```css
:root {
  --surface-bg, --surface-raised, --surface-topbar, ...
  --text-primary, --text-secondary, --text-muted, --text-subtle
  --border-subtle, --border-default, --border-strong
  --input-bg, --input-bg-hover
  --scrollbar-thumb, --scrollbar-thumb-hover
  --progress-track
}

.dark {
  /* dark mode overrides for all tokens */
}
```

### Tailwind Dark Mode

Configured as `darkMode: 'class'` in `tailwind.config.ts`. The `dark` class is applied to `<html>` by the `useTheme` hook.

### Key Files

| File | Purpose |
|------|---------|
| `apps/web/src/hooks/useTheme.ts` | Manages theme state, localStorage, `<html>` class |
| `apps/web/src/contexts/ThemeContext.tsx` | React context provider; exposes `isDark`, `toggleTheme` |
| `apps/web/src/app/layout.tsx` | Wraps app with `ThemeProvider`; includes anti-FOUC script |
| `apps/web/src/app/globals.css` | CSS variable definitions for both themes |
| `apps/web/tailwind.config.ts` | `darkMode: 'class'` configuration |

### Using the Theme in Components

```tsx
import { useThemeContext } from '@/contexts/ThemeContext';

function MyComponent() {
  const { isDark, toggleTheme } = useThemeContext();

  return (
    <div style={{ background: 'var(--surface-bg)', color: 'var(--text-primary)' }}>
      <button onClick={toggleTheme}>
        {isDark ? '☀ Light' : '◑ Dark'}
      </button>
    </div>
  );
}
```

Prefer CSS variables (`var(--surface-bg)`) in inline styles where possible. Use `isDark` boolean for conditional logic (e.g., shadow colors, icon selection).

### Toggle Button

The theme toggle button (`◑` / `☀`) appears:
- In the **top bar** of the main editor view (always visible)
- In the **project picker** screen (top-right corner)
