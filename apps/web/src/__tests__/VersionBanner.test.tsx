import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import VersionBanner from '../components/VersionBanner';
import * as useVersionCheckModule from '../hooks/useVersionCheck';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mockVersionCheck(status: useVersionCheckModule.VersionStatus) {
  const dismiss = vi.fn();
  vi.spyOn(useVersionCheckModule, 'useVersionCheck').mockReturnValue({ status, dismiss });
  return { dismiss };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('VersionBanner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders nothing when status is null', () => {
    mockVersionCheck(null);
    const { container } = render(<VersionBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the welcome banner when status is "welcome"', () => {
    mockVersionCheck('welcome');
    render(<VersionBanner />);
    expect(screen.getByText(/vítejte v nové verzi/i)).toBeDefined();
  });

  it('renders the update-available banner when status is "update-available"', () => {
    mockVersionCheck('update-available');
    render(<VersionBanner />);
    expect(screen.getByText(/dostupná nová verze/i)).toBeDefined();
  });

  it('shows an "Obnovit" button in update-available state', () => {
    mockVersionCheck('update-available');
    render(<VersionBanner />);
    expect(screen.getByRole('button', { name: /obnovit/i })).toBeDefined();
  });

  it('"Obnovit" button calls dismiss() and window.location.reload()', () => {
    const { dismiss } = mockVersionCheck('update-available');
    const reloadMock = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, reload: reloadMock },
      writable: true,
    });

    render(<VersionBanner />);
    fireEvent.click(screen.getByRole('button', { name: /obnovit/i }));
    // dismiss() must be called first so the dismissed buildId is persisted
    // to localStorage before the page reloads – otherwise the banner can
    // reappear when the browser serves a cached old page after reload.
    expect(dismiss).toHaveBeenCalledOnce();
    expect(reloadMock).toHaveBeenCalledOnce();
  });

  it('dismiss button calls dismiss() in update-available state', () => {
    const { dismiss } = mockVersionCheck('update-available');
    render(<VersionBanner />);
    fireEvent.click(screen.getByRole('button', { name: /zavřít/i }));
    expect(dismiss).toHaveBeenCalledOnce();
  });

  it('dismiss button calls dismiss() in welcome state', () => {
    const { dismiss } = mockVersionCheck('welcome');
    render(<VersionBanner />);
    fireEvent.click(screen.getByRole('button', { name: /zavřít/i }));
    expect(dismiss).toHaveBeenCalledOnce();
  });

  it('auto-dismisses the welcome banner after 6 s', () => {
    const { dismiss } = mockVersionCheck('welcome');
    render(<VersionBanner />);

    act(() => {
      vi.advanceTimersByTime(6_001);
    });

    expect(dismiss).toHaveBeenCalledOnce();
  });

  it('does NOT auto-dismiss the update-available banner', () => {
    const { dismiss } = mockVersionCheck('update-available');
    render(<VersionBanner />);

    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(dismiss).not.toHaveBeenCalled();
  });

  it('banner has role="status" for accessibility', () => {
    mockVersionCheck('welcome');
    render(<VersionBanner />);
    expect(screen.getByRole('status')).toBeDefined();
  });
});
