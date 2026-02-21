import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Preview from '../components/Preview';

// ── Mocks ──────────────────────────────────────────────────────────────────────

// jsdom does not implement canvas getContext
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

// jsdom does not implement ResizeObserver
class MockResizeObserver {
  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
  constructor(_cb: ResizeObserverCallback) {}
}
globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

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

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('Preview zoom controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders zoom controls', () => {
    render(<Preview {...defaultProps} />);
    expect(screen.getByTestId('preview-zoom-controls')).toBeDefined();
    expect(screen.getByTestId('zoom-in-btn')).toBeDefined();
    expect(screen.getByTestId('zoom-out-btn')).toBeDefined();
    expect(screen.getByTestId('zoom-reset-btn')).toBeDefined();
  });

  it('shows 100% zoom level by default', () => {
    render(<Preview {...defaultProps} />);
    expect(screen.getByTestId('zoom-reset-btn').textContent).toBe('100%');
  });

  it('clicking zoom-in increases zoom above 100%', () => {
    render(<Preview {...defaultProps} />);
    fireEvent.click(screen.getByTestId('zoom-in-btn'));
    const label = screen.getByTestId('zoom-reset-btn').textContent ?? '';
    const pct = parseInt(label, 10);
    expect(pct).toBeGreaterThan(100);
  });

  it('clicking zoom-out decreases zoom below 100%', () => {
    render(<Preview {...defaultProps} />);
    fireEvent.click(screen.getByTestId('zoom-out-btn'));
    const label = screen.getByTestId('zoom-reset-btn').textContent ?? '';
    const pct = parseInt(label, 10);
    expect(pct).toBeLessThan(100);
  });

  it('clicking zoom-reset restores 100% after zooming in', () => {
    render(<Preview {...defaultProps} />);
    fireEvent.click(screen.getByTestId('zoom-in-btn'));
    fireEvent.click(screen.getByTestId('zoom-in-btn'));
    fireEvent.click(screen.getByTestId('zoom-reset-btn'));
    expect(screen.getByTestId('zoom-reset-btn').textContent).toBe('100%');
  });

  it('clicking zoom-reset restores 100% after zooming out', () => {
    render(<Preview {...defaultProps} />);
    fireEvent.click(screen.getByTestId('zoom-out-btn'));
    fireEvent.click(screen.getByTestId('zoom-reset-btn'));
    expect(screen.getByTestId('zoom-reset-btn').textContent).toBe('100%');
  });

  it('zoom wrapper exists and has transform style', () => {
    render(<Preview {...defaultProps} />);
    const wrapper = screen.getByTestId('preview-zoom-wrapper');
    // At default zoom the transform should include scale(1)
    expect(wrapper.style.transform).toContain('scale(1)');
  });

  it('zoom-in button increases transform scale visually', () => {
    render(<Preview {...defaultProps} />);
    const wrapper = screen.getByTestId('preview-zoom-wrapper');
    fireEvent.click(screen.getByTestId('zoom-in-btn'));
    // After zoom-in the scale should be > 1
    expect(wrapper.style.transform).not.toContain('scale(1)');
    expect(wrapper.style.transform).toMatch(/scale\(1\.[1-9]/);
  });
});
