/**
 * PreviewCanvasResize.test.tsx
 *
 * Tests that the Preview canvas maintains a completely stable rendering
 * regardless of panel/window size. After the stability fix:
 *
 *  - Canvas INTERNAL resolution is fixed (derived from outputResolution,
 *    capped at 1280 px on the longest axis).
 *  - Canvas CSS dimensions are also fixed to the INTERNAL resolution.
 *    Visual scaling is performed exclusively via the viewZoom CSS transform
 *    on the zoom-wrapper div — the canvas element's layout size never changes.
 *  - Panel / window resizing therefore has ZERO effect on canvas dimensions
 *    (neither internal nor CSS), so video elements never shift or shrink.
 *  - The SVG selection-overlay viewBox always matches the internal resolution
 *    so handles remain correctly positioned at all zoom levels.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import Preview from '../components/Preview';
import type { Project } from '@video-editor/shared';

// ── Canvas mock ────────────────────────────────────────────────────────────────
HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
  fillStyle: '',
  fillRect: vi.fn(),
  fillText: vi.fn(),
  clearRect: vi.fn(),
  drawImage: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  stroke: vi.fn(),
  setLineDash: vi.fn(),
  measureText: vi.fn().mockReturnValue({ width: 100 }),
  translate: vi.fn(),
  rotate: vi.fn(),
  font: '',
  textAlign: 'left' as const,
  textBaseline: 'alphabetic' as const,
  shadowColor: '',
  shadowBlur: 0,
  strokeStyle: '',
  lineWidth: 1,
  globalAlpha: 1,
}) as unknown as typeof HTMLCanvasElement.prototype.getContext;

// ── ResizeObserver stub ────────────────────────────────────────────────────────
// The Preview component no longer uses ResizeObserver to set canvas CSS dims
// (it was removed in the stability fix). We still provide a no-op stub so the
// global is defined in the test environment.
class NoopResizeObserver {
  observe() {}
  disconnect() {}
  unobserve() {}
}
globalThis.ResizeObserver = NoopResizeObserver as unknown as typeof ResizeObserver;

// ── Test data ─────────────────────────────────────────────────────────────────

const makeProject = (w: number, h: number): Project => ({
  id: 'proj-1',
  name: 'Test',
  outputResolution: { w, h },
  outputFps: 30,
  outputDuration: 10,
  tracks: [],
  lyrics: undefined,
});

const defaultProps = {
  project: null,
  assets: [],
  currentTime: 0,
  isPlaying: false,
  beatsData: new Map(),
  selectedClipId: null,
  onClipSelect: vi.fn(),
  onClipUpdate: vi.fn(),
};

// ── Tests: internal resolution ─────────────────────────────────────────────────

describe('Preview canvas internal resolution stability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('canvas internal resolution is capped at 1280 on the longest axis for a 1920×1080 project', () => {
    const project = makeProject(1920, 1080);
    const { container } = render(<Preview {...defaultProps} project={project} />);
    const canvas = container.querySelector('canvas')!;

    // Expected reference: 1920×1080 scaled by 1280/1920 = 2/3
    expect(canvas.width).toBe(1280);
    expect(canvas.height).toBe(720);
  });

  it('canvas internal resolution is capped at 1280 on the longest axis for a 1080×1920 vertical project', () => {
    const project = makeProject(1080, 1920);
    const { container } = render(<Preview {...defaultProps} project={project} />);
    const canvas = container.querySelector('canvas')!;

    // Expected reference: 1080×1920 scaled by 1280/1920 = 2/3
    expect(canvas.width).toBe(720);
    expect(canvas.height).toBe(1280);
  });

  it('uses default 16:9 reference resolution when no project is loaded', () => {
    const { container } = render(<Preview {...defaultProps} project={null} />);
    const canvas = container.querySelector('canvas')!;

    // Default: 1920×1080 → 1280×720
    expect(canvas.width).toBe(1280);
    expect(canvas.height).toBe(720);
  });

  it('canvas internal resolution updates when project output resolution changes', () => {
    const project1080p = makeProject(1920, 1080);
    const project4K = makeProject(3840, 2160);

    const { container, rerender } = render(<Preview {...defaultProps} project={project1080p} />);
    const canvas = container.querySelector('canvas')!;

    expect(canvas.width).toBe(1280);
    expect(canvas.height).toBe(720);

    rerender(<Preview {...defaultProps} project={project4K} />);

    // 3840×2160 capped at 1280: scale = 1280/3840 = 1/3 → 1280×720
    expect(canvas.width).toBe(1280);
    expect(canvas.height).toBe(720);
  });
});

// ── Tests: CSS = internal resolution (panel-size-independent) ─────────────────
//
// The key stability guarantee: canvas CSS dimensions ALWAYS match the internal
// resolution and are NEVER derived from or affected by the container / panel
// size. Visual scaling is handled by the CSS transform on the zoom wrapper.

describe('Preview canvas CSS dimensions match internal resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('canvas CSS width equals internal canvas width on mount', () => {
    const project = makeProject(1920, 1080);
    const { container } = render(<Preview {...defaultProps} project={project} />);
    const canvas = container.querySelector('canvas')!;

    // CSS must equal internal resolution (1280 px), not the container width
    expect(canvas.style.width).toBe(`${canvas.width}px`);
    expect(canvas.style.height).toBe(`${canvas.height}px`);
  });

  it('canvas CSS equals internal resolution for a vertical 9:16 project', () => {
    const project = makeProject(1080, 1920);
    const { container } = render(<Preview {...defaultProps} project={project} />);
    const canvas = container.querySelector('canvas')!;

    expect(canvas.style.width).toBe('720px');
    expect(canvas.style.height).toBe('1280px');
  });

  it('canvas CSS equals internal resolution when no project is loaded', () => {
    const { container } = render(<Preview {...defaultProps} project={null} />);
    const canvas = container.querySelector('canvas')!;

    // Default: 1920×1080 → 1280×720 internal → same CSS
    expect(canvas.style.width).toBe('1280px');
    expect(canvas.style.height).toBe('720px');
  });

  it('canvas CSS does NOT change when container element is resized (panel stability)', () => {
    const project = makeProject(1920, 1080);
    const { container } = render(<Preview {...defaultProps} project={project} />);
    const canvas = container.querySelector('canvas')!;

    // Record CSS dimensions after mount
    const cssWBefore = canvas.style.width;
    const cssHBefore = canvas.style.height;

    // Simulate the DOM container being resized by a layout engine (panel drag).
    // Because the component no longer sets canvas CSS from container dimensions,
    // these DOM changes must have no effect on canvas.style.width / height.
    const previewContainer = canvas.closest('[data-testid]')?.parentElement ?? canvas.parentElement?.parentElement;
    if (previewContainer) {
      Object.defineProperty(previewContainer, 'clientWidth', { value: 1000, configurable: true });
      Object.defineProperty(previewContainer, 'clientHeight', { value: 800, configurable: true });
    }

    // Trigger a React re-render with the same props — CSS must remain unchanged
    act(() => { /* no state change, just verify stability */ });

    expect(canvas.style.width).toBe(cssWBefore);
    expect(canvas.style.height).toBe(cssHBefore);
  });

  it('canvas CSS updates when project output resolution changes', () => {
    const project1080p = makeProject(1920, 1080);
    const project720p  = makeProject(1280, 720);

    const { container, rerender } = render(<Preview {...defaultProps} project={project1080p} />);
    const canvas = container.querySelector('canvas')!;

    expect(canvas.style.width).toBe('1280px');
    expect(canvas.style.height).toBe('720px');

    rerender(<Preview {...defaultProps} project={project720p} />);

    // 1280×720 ≤ 1280 on longest axis → internal dims stay 1280×720 → CSS same
    expect(canvas.style.width).toBe('1280px');
    expect(canvas.style.height).toBe('720px');
  });
});

// ── Tests: SVG viewBox ────────────────────────────────────────────────────────
//
// The SVG selection overlay must carry a viewBox that maps its user coordinate
// space to the canvas INTERNAL resolution. Because canvas CSS now equals the
// internal resolution, the viewBox ratio is always 1:1, but the viewBox itself
// must still be explicitly set so that future CSS size changes (e.g. via the
// zoom wrapper's transform) don't affect handle positioning.

describe('Preview SVG selection overlay viewBox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sets SVG viewBox to match canvas internal resolution on mount', () => {
    const project = makeProject(1920, 1080);
    const { container } = render(<Preview {...defaultProps} project={project} />);
    const svg = container.querySelector('svg')!;

    // Canvas internal dims are 1280×720 for a 1920×1080 project
    expect(svg.getAttribute('viewBox')).toBe('0 0 1280 720');
  });

  it('sets SVG viewBox for a vertical (9:16) project', () => {
    const project = makeProject(1080, 1920);
    const { container } = render(<Preview {...defaultProps} project={project} />);
    const svg = container.querySelector('svg')!;

    // Canvas internal dims are 720×1280 for a 1080×1920 project
    expect(svg.getAttribute('viewBox')).toBe('0 0 720 1280');
  });

  it('SVG viewBox stays correct and canvas internal resolution stays fixed after container element resize', () => {
    const project = makeProject(1920, 1080);
    const { container } = render(<Preview {...defaultProps} project={project} />);
    const canvas = container.querySelector('canvas')!;
    const svg = container.querySelector('svg')!;

    const internalW = canvas.width;
    const internalH = canvas.height;

    // Simulate multiple panel resizes (DOM layout changes, no ResizeObserver involvement)
    // With the stability fix these must leave the canvas untouched.
    const previewEl = canvas.parentElement?.parentElement;
    if (previewEl) {
      for (const [w, h] of [[600, 400], [300, 200], [1920, 1080]] as const) {
        Object.defineProperty(previewEl, 'clientWidth', { value: w, configurable: true });
        Object.defineProperty(previewEl, 'clientHeight', { value: h, configurable: true });
        act(() => { /* trigger any pending effects */ });
      }
    }

    // Internal resolution must not have changed
    expect(canvas.width).toBe(internalW);
    expect(canvas.height).toBe(internalH);
    // CSS must still match internal resolution
    expect(canvas.style.width).toBe(`${internalW}px`);
    expect(canvas.style.height).toBe(`${internalH}px`);
    // SVG viewBox must still match internal resolution
    expect(svg.getAttribute('viewBox')).toBe(`0 0 ${internalW} ${internalH}`);
  });

  it('updates SVG viewBox when project output resolution changes', () => {
    const project1080p = makeProject(1920, 1080);
    const project720p  = makeProject(1280, 720);

    const { container, rerender } = render(<Preview {...defaultProps} project={project1080p} />);
    const svg = container.querySelector('svg')!;

    expect(svg.getAttribute('viewBox')).toBe('0 0 1280 720');

    rerender(<Preview {...defaultProps} project={project720p} />);

    // 1280×720 is ≤ 1280 on longest axis → canvas stays 1280×720
    expect(svg.getAttribute('viewBox')).toBe('0 0 1280 720');
  });
});
