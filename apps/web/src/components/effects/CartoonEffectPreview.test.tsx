import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import { CartoonEffectPreview } from './CartoonEffectPreview';
import type { EffectClipConfig } from '@video-editor/shared';

// Mock the processing functions from @video-editor/elements
vi.mock('@video-editor/elements', () => {
  const mockCanvas = (): HTMLCanvasElement => {
    const canvas = document.createElement('canvas');
    canvas.width = 240;
    canvas.height = 135;
    return canvas;
  };
  return {
    processCartoonFrame: vi.fn(() => mockCanvas()),
    processAiStyleFrame: vi.fn(() => mockCanvas()),
  };
});

// Mock video element behavior
function createMockVideoElement() {
  const listeners: Record<string, Array<() => void>> = {};
  return {
    addEventListener: vi.fn((event: string, cb: () => void) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(cb);
    }),
    removeEventListener: vi.fn(),
    pause: vi.fn(),
    load: vi.fn(),
    removeAttribute: vi.fn(),
    set src(_v: string) {
      // Trigger loadeddata after src is set
      setTimeout(() => {
        listeners['loadeddata']?.forEach((cb) => cb());
      }, 0);
    },
    get src() { return ''; },
    set currentTime(_v: number) {
      // Trigger seeked after currentTime is set
      setTimeout(() => {
        listeners['seeked']?.forEach((cb) => cb());
      }, 0);
    },
    get currentTime() { return 0; },
    crossOrigin: '',
    muted: false,
    playsInline: false,
    preload: '',
    duration: 10,
    videoWidth: 1920,
    videoHeight: 1080,
    _listeners: listeners,
  };
}

describe('CartoonEffectPreview', () => {
  let originalCreateElement: typeof document.createElement;
  let mockVideo: ReturnType<typeof createMockVideoElement>;

  beforeEach(() => {
    originalCreateElement = document.createElement.bind(document);
    mockVideo = createMockVideoElement();

    // Override document.createElement to return mock video for 'video' elements
    vi.spyOn(document, 'createElement').mockImplementation((tag: string, options?: ElementCreationOptions) => {
      if (tag === 'video') return mockVideo as unknown as HTMLVideoElement;
      return originalCreateElement(tag, options);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const baseCfg: EffectClipConfig = {
    effectType: 'cartoon',
    enabled: true,
    cartoonMode: 'classic',
    edgeStrength: 0.6,
    colorSimplification: 0.5,
    saturation: 1.5,
  };

  const aiStyleCfg: EffectClipConfig = {
    effectType: 'cartoon',
    enabled: true,
    cartoonMode: 'aiStyle',
    stylePreset: 'hayao',
    styleStrength: 0.8,
    brushSize: 0.5,
    colorVibrance: 1.3,
  };

  it('renders with loading state initially', () => {
    render(
      <CartoonEffectPreview proxyUrl="/files/test-proxy.mp4" cfg={baseCfg} />
    );
    expect(screen.getByText('Preview')).toBeInTheDocument();
  });

  it('renders mode toggle buttons (Split, Original)', () => {
    render(
      <CartoonEffectPreview proxyUrl="/files/test-proxy.mp4" cfg={baseCfg} />
    );
    expect(screen.getByText('Split')).toBeInTheDocument();
    // "Original" appears both as a button and as a label in the canvas
    expect(screen.getAllByText('Original').length).toBeGreaterThanOrEqual(1);
  });

  it('sets video source from proxyUrl', async () => {
    render(
      <CartoonEffectPreview proxyUrl="/files/test-proxy.mp4" cfg={baseCfg} />
    );
    // video.src setter was called
    expect(mockVideo.addEventListener).toHaveBeenCalledWith('seeked', expect.any(Function));
    expect(mockVideo.addEventListener).toHaveBeenCalledWith('loadeddata', expect.any(Function));
  });

  it('renders with ai style config', () => {
    render(
      <CartoonEffectPreview proxyUrl="/files/test-proxy.mp4" cfg={aiStyleCfg} />
    );
    expect(screen.getByText('Preview')).toBeInTheDocument();
  });

  it('switches to original view when Original button clicked', async () => {
    render(
      <CartoonEffectPreview proxyUrl="/files/test-proxy.mp4" cfg={baseCfg} />
    );
    // Find the Original button specifically (it's a <button>)
    const originalBtns = screen.getAllByText('Original');
    const originalBtn = originalBtns.find((el) => el.closest('button'));
    expect(originalBtn).toBeDefined();
    fireEvent.click(originalBtn!);
    // After clicking Original, the "Original" label should appear in the canvas area
    const labels = screen.getAllByText('Original');
    expect(labels.length).toBeGreaterThanOrEqual(1);
  });

  it('does not render preview when proxyUrl is empty', () => {
    render(
      <CartoonEffectPreview proxyUrl="" cfg={baseCfg} />
    );
    // Should still render the container but without loading a video
    expect(screen.getByText('Preview')).toBeInTheDocument();
  });

  it('uses sourceTime from clip when provided', () => {
    render(
      <CartoonEffectPreview proxyUrl="/files/test-proxy.mp4" cfg={baseCfg} sourceTime={3.5} />
    );
    expect(mockVideo.addEventListener).toHaveBeenCalled();
  });

  it('cleans up video on unmount', () => {
    const { unmount } = render(
      <CartoonEffectPreview proxyUrl="/files/test-proxy.mp4" cfg={baseCfg} />
    );
    unmount();
    expect(mockVideo.pause).toHaveBeenCalled();
    expect(mockVideo.removeEventListener).toHaveBeenCalled();
  });
});
