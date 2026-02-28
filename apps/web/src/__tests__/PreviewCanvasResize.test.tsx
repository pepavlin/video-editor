/**
 * PreviewCanvasResize.test.tsx
 *
 * Tests that the Preview canvas maintains a stable internal resolution when the
 * surrounding panel is resized. Before the fix, the canvas pixel dimensions were
 * set to match the container, causing transform.x / transform.y coordinates to
 * shift visually on every panel resize. After the fix the canvas has a fixed
 * internal resolution and only its CSS display size changes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
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

// ── ResizeObserver mock that exposes the callback for manual triggering ────────

type ROCallback = (entries: ResizeObserverEntry[]) => void;
let capturedROCallback: ROCallback | null = null;
let capturedContainer: Element | null = null;

class ControllableResizeObserver {
  private cb: ROCallback;
  constructor(cb: ROCallback) {
    this.cb = cb;
    capturedROCallback = cb;
  }
  observe(target: Element) {
    capturedContainer = target;
  }
  disconnect() {}
  unobserve() {}
}

globalThis.ResizeObserver = ControllableResizeObserver as unknown as typeof ResizeObserver;

/** Simulate a container resize by calling the captured ResizeObserver callback. */
function simulateContainerResize(w: number, h: number) {
  if (!capturedROCallback || !capturedContainer) return;
  // Override clientWidth / clientHeight on the captured container element
  Object.defineProperty(capturedContainer, 'clientWidth', { value: w, configurable: true });
  Object.defineProperty(capturedContainer, 'clientHeight', { value: h, configurable: true });
  capturedROCallback([] as unknown as ResizeObserverEntry[]);
}

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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Preview canvas internal resolution stability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedROCallback = null;
    capturedContainer = null;
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

  it('canvas internal resolution stays fixed when container is resized', () => {
    const project = makeProject(1920, 1080);
    const { container } = render(<Preview {...defaultProps} project={project} />);
    const canvas = container.querySelector('canvas')!;

    const widthBefore = canvas.width;
    const heightBefore = canvas.height;

    // Simulate a large container resize
    simulateContainerResize(1200, 900);

    expect(canvas.width).toBe(widthBefore);
    expect(canvas.height).toBe(heightBefore);
  });

  it('canvas CSS display size changes to fit container while preserving aspect ratio', () => {
    const project = makeProject(1920, 1080);
    const { container } = render(<Preview {...defaultProps} project={project} />);
    const canvas = container.querySelector('canvas')!;

    // Simulate a 600×400 container (wider than 16:9, height-constrained)
    simulateContainerResize(600, 400);

    // 16:9 aspect ratio: h-constrained → cssW = 400 * (1920/1080) ≈ 711
    // w-constrained  → cssH = 600 * (1080/1920) = 337.5 → 338px
    // 600 / (16/9) = 337.5px → fits within 400px → width-constrained
    const cssW = parseInt(canvas.style.width, 10);
    const cssH = parseInt(canvas.style.height, 10);
    expect(cssW).toBe(600);
    expect(cssH).toBe(338);
  });

  it('canvas CSS is height-constrained when container is taller than 16:9', () => {
    const project = makeProject(1920, 1080);
    const { container } = render(<Preview {...defaultProps} project={project} />);
    const canvas = container.querySelector('canvas')!;

    // 300×400 container: 300/(16/9)=168.75 → fits in 400 → width-constrained
    simulateContainerResize(300, 400);
    expect(parseInt(canvas.style.width, 10)).toBe(300);
    expect(parseInt(canvas.style.height, 10)).toBe(169);
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
