import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import ChangelogModal, { OPEN_CHANGELOG_EVENT } from '../components/ChangelogModal';
import * as changelogData from '../data/changelog';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ChangelogModal', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders nothing by default', () => {
    const { container } = render(<ChangelogModal />);
    expect(container.firstChild).toBeNull();
  });

  it('opens when the "open-changelog" custom event is dispatched', () => {
    render(<ChangelogModal />);
    act(() => {
      window.dispatchEvent(new CustomEvent(OPEN_CHANGELOG_EVENT));
    });
    expect(screen.getByRole('dialog')).toBeDefined();
    expect(screen.getByText(/co je nového/i)).toBeDefined();
  });

  it('closes when the close button is clicked', () => {
    render(<ChangelogModal />);
    act(() => {
      window.dispatchEvent(new CustomEvent(OPEN_CHANGELOG_EVENT));
    });
    fireEvent.click(screen.getByRole('button', { name: /zavřít/i }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes on Escape key', () => {
    render(<ChangelogModal />);
    act(() => {
      window.dispatchEvent(new CustomEvent(OPEN_CHANGELOG_EVENT));
    });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('displays changelog entries from the data file', () => {
    const mockChangelog: changelogData.ChangelogEntry[] = [
      { date: '2026-01-01', title: '1. ledna 2026', items: ['Testovací změna A', 'Testovací změna B'] },
    ];
    vi.spyOn(changelogData, 'CHANGELOG', 'get').mockReturnValue(mockChangelog);

    render(<ChangelogModal />);
    act(() => {
      window.dispatchEvent(new CustomEvent(OPEN_CHANGELOG_EVENT));
    });

    expect(screen.getByText('1. ledna 2026')).toBeDefined();
    expect(screen.getByText('Testovací změna A')).toBeDefined();
    expect(screen.getByText('Testovací změna B')).toBeDefined();
  });

  it('labels the most recent entry as "nejnovější"', () => {
    const mockChangelog: changelogData.ChangelogEntry[] = [
      { date: '2026-02-01', title: '1. února 2026', items: ['Změna'] },
      { date: '2026-01-01', title: '1. ledna 2026', items: ['Starší změna'] },
    ];
    vi.spyOn(changelogData, 'CHANGELOG', 'get').mockReturnValue(mockChangelog);

    render(<ChangelogModal />);
    act(() => {
      window.dispatchEvent(new CustomEvent(OPEN_CHANGELOG_EVENT));
    });

    expect(screen.getByText('nejnovější')).toBeDefined();
  });

  it('shows empty state message when changelog is empty', () => {
    vi.spyOn(changelogData, 'CHANGELOG', 'get').mockReturnValue([]);

    render(<ChangelogModal />);
    act(() => {
      window.dispatchEvent(new CustomEvent(OPEN_CHANGELOG_EVENT));
    });

    expect(screen.getByText(/žádné záznamy/i)).toBeDefined();
  });

  it('has aria-modal and aria-label for accessibility', () => {
    render(<ChangelogModal />);
    act(() => {
      window.dispatchEvent(new CustomEvent(OPEN_CHANGELOG_EVENT));
    });
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toBeTruthy();
  });

  it('removes event listener on unmount', () => {
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = render(<ChangelogModal />);
    unmount();
    expect(removeEventListenerSpy).toHaveBeenCalledWith(OPEN_CHANGELOG_EVENT, expect.any(Function));
  });
});
