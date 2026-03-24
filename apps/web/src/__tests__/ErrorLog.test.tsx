import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ErrorLog from '../components/ErrorLog';
import type { ErrorLog as ErrorLogType } from '../hooks/useErrorLog';

function makeErrorLog(overrides: Partial<ErrorLogType> = {}): ErrorLogType {
  return {
    errors: [],
    isOpen: false,
    hasUnread: false,
    addError: vi.fn(),
    clearErrors: vi.fn(),
    removeError: vi.fn(),
    open: vi.fn(),
    close: vi.fn(),
    toggle: vi.fn(),
    ...overrides,
  };
}

describe('ErrorLog component', () => {
  it('renders toggle button with "Log" when no errors', () => {
    const log = makeErrorLog();
    render(<ErrorLog errorLog={log} />);
    expect(screen.getByText('Log')).toBeTruthy();
  });

  it('renders error count when there are errors', () => {
    const log = makeErrorLog({
      errors: [
        { id: 'err-1', timestamp: new Date(), title: 'Test', message: 'msg', source: 'aiStyle' },
      ],
    });
    render(<ErrorLog errorLog={log} />);
    expect(screen.getByText('1 error')).toBeTruthy();
  });

  it('renders plural error count', () => {
    const log = makeErrorLog({
      errors: [
        { id: 'err-1', timestamp: new Date(), title: 'A', message: 'a', source: 'aiStyle' },
        { id: 'err-2', timestamp: new Date(), title: 'B', message: 'b', source: 'export' },
      ],
    });
    render(<ErrorLog errorLog={log} />);
    expect(screen.getByText('2 errors')).toBeTruthy();
  });

  it('calls toggle when button is clicked', () => {
    const toggle = vi.fn();
    const log = makeErrorLog({ toggle });
    render(<ErrorLog errorLog={log} />);
    fireEvent.click(screen.getByText('Log'));
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it('shows panel with error details when isOpen', () => {
    const log = makeErrorLog({
      isOpen: true,
      errors: [
        { id: 'err-1', timestamp: new Date(), title: 'AI Style failed', message: 'Script not found', source: 'aiStyle', details: ['line1', 'line2'] },
      ],
    });
    render(<ErrorLog errorLog={log} />);
    expect(screen.getByText('Error Log')).toBeTruthy();
    expect(screen.getByText('AI Style failed')).toBeTruthy();
    expect(screen.getByText('Script not found')).toBeTruthy();
    expect(screen.getByText('AI Style')).toBeTruthy(); // source label
  });

  it('shows "No errors recorded" when open with empty list', () => {
    const log = makeErrorLog({ isOpen: true, errors: [] });
    render(<ErrorLog errorLog={log} />);
    expect(screen.getByText('No errors recorded')).toBeTruthy();
  });

  it('calls clearErrors when "Clear all" is clicked', () => {
    const clearErrors = vi.fn();
    const log = makeErrorLog({
      isOpen: true,
      clearErrors,
      errors: [
        { id: 'err-1', timestamp: new Date(), title: 'Test', message: 'msg', source: 'unknown' },
      ],
    });
    render(<ErrorLog errorLog={log} />);
    fireEvent.click(screen.getByText('Clear all'));
    expect(clearErrors).toHaveBeenCalledTimes(1);
  });

  it('calls removeError when dismiss button is clicked', () => {
    const removeError = vi.fn();
    const log = makeErrorLog({
      isOpen: true,
      removeError,
      errors: [
        { id: 'err-42', timestamp: new Date(), title: 'Test', message: 'msg', source: 'unknown' },
      ],
    });
    render(<ErrorLog errorLog={log} />);
    fireEvent.click(screen.getByTitle('Dismiss'));
    expect(removeError).toHaveBeenCalledWith('err-42');
  });
});
