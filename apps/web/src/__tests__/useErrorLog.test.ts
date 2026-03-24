import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useErrorLog } from '../hooks/useErrorLog';

describe('useErrorLog', () => {
  it('starts with empty errors and closed state', () => {
    const { result } = renderHook(() => useErrorLog());
    expect(result.current.errors).toEqual([]);
    expect(result.current.isOpen).toBe(false);
    expect(result.current.hasUnread).toBe(false);
  });

  it('addError creates an error entry with correct fields', () => {
    const { result } = renderHook(() => useErrorLog());
    act(() => {
      result.current.addError('Test title', 'Test message', 'aiStyle', ['line1', 'line2']);
    });
    expect(result.current.errors).toHaveLength(1);
    const entry = result.current.errors[0];
    expect(entry.title).toBe('Test title');
    expect(entry.message).toBe('Test message');
    expect(entry.source).toBe('aiStyle');
    expect(entry.details).toEqual(['line1', 'line2']);
    expect(entry.timestamp).toBeInstanceOf(Date);
    expect(entry.id).toMatch(/^err-/);
  });

  it('sets hasUnread to true when error is added', () => {
    const { result } = renderHook(() => useErrorLog());
    act(() => {
      result.current.addError('Err', 'msg', 'unknown');
    });
    expect(result.current.hasUnread).toBe(true);
  });

  it('open clears hasUnread', () => {
    const { result } = renderHook(() => useErrorLog());
    act(() => {
      result.current.addError('Err', 'msg', 'unknown');
    });
    expect(result.current.hasUnread).toBe(true);
    act(() => {
      result.current.open();
    });
    expect(result.current.isOpen).toBe(true);
    expect(result.current.hasUnread).toBe(false);
  });

  it('close sets isOpen to false', () => {
    const { result } = renderHook(() => useErrorLog());
    act(() => { result.current.open(); });
    expect(result.current.isOpen).toBe(true);
    act(() => { result.current.close(); });
    expect(result.current.isOpen).toBe(false);
  });

  it('toggle opens/closes and clears hasUnread on open', () => {
    const { result } = renderHook(() => useErrorLog());
    act(() => {
      result.current.addError('Err', 'msg', 'unknown');
    });
    act(() => { result.current.toggle(); });
    expect(result.current.isOpen).toBe(true);
    expect(result.current.hasUnread).toBe(false);
    act(() => { result.current.toggle(); });
    expect(result.current.isOpen).toBe(false);
  });

  it('removeError removes a specific error', () => {
    const { result } = renderHook(() => useErrorLog());
    act(() => {
      result.current.addError('First', 'msg1', 'cutout');
      result.current.addError('Second', 'msg2', 'export');
    });
    expect(result.current.errors).toHaveLength(2);
    const idToRemove = result.current.errors[0].id;
    act(() => { result.current.removeError(idToRemove); });
    expect(result.current.errors).toHaveLength(1);
    expect(result.current.errors[0].title).toBe('Second');
  });

  it('clearErrors removes all errors and clears hasUnread', () => {
    const { result } = renderHook(() => useErrorLog());
    act(() => {
      result.current.addError('A', 'a', 'unknown');
      result.current.addError('B', 'b', 'unknown');
    });
    expect(result.current.errors).toHaveLength(2);
    act(() => { result.current.clearErrors(); });
    expect(result.current.errors).toEqual([]);
    expect(result.current.hasUnread).toBe(false);
  });

  it('keeps max 50 errors', () => {
    const { result } = renderHook(() => useErrorLog());
    act(() => {
      for (let i = 0; i < 60; i++) {
        result.current.addError(`Error ${i}`, `msg ${i}`, 'unknown');
      }
    });
    expect(result.current.errors).toHaveLength(50);
    expect(result.current.errors[0].title).toBe('Error 10');
    expect(result.current.errors[49].title).toBe('Error 59');
  });
});
