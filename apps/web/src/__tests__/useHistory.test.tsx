import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useHistory } from '../hooks/useHistory';
import type { Project } from '@video-editor/shared';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeProject(name: string): Project {
  const now = new Date().toISOString();
  return {
    id: 'proj_1',
    name,
    duration: 0,
    aspectRatio: '9:16',
    outputResolution: { w: 1080, h: 1920 },
    tracks: [],
    createdAt: now,
    updatedAt: now,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useHistory', () => {
  it('initialises with canUndo=false, canRedo=false', () => {
    const setProject = vi.fn();
    const project = makeProject('Initial');
    const { result } = renderHook(() => useHistory(project, setProject));
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it('canUndo remains false after only one pushSnapshot (need 2+ states)', () => {
    vi.useFakeTimers();
    const setProject = vi.fn();
    const project = makeProject('A');
    const { result } = renderHook(() => useHistory(project, setProject));

    act(() => {
      result.current.pushSnapshot(project);
      vi.runAllTimers();
    });

    // One snapshot = current state only; need at least 2 to be able to undo
    expect(result.current.canUndo).toBe(false);
    vi.useRealTimers();
  });

  it('canUndo becomes true after two distinct pushSnapshots', () => {
    vi.useFakeTimers();
    const setProject = vi.fn();
    const v1 = makeProject('V1');
    const v2 = makeProject('V2');
    const { result } = renderHook(() => useHistory(v1, setProject));

    act(() => { result.current.pushSnapshot(v1); vi.runAllTimers(); });
    act(() => { result.current.pushSnapshot(v2); vi.runAllTimers(); });

    expect(result.current.canUndo).toBe(true);
    vi.useRealTimers();
  });

  it('undo calls setProject with the state BEFORE the last change', () => {
    vi.useFakeTimers();
    const setProject = vi.fn();
    const v1 = makeProject('Version 1');
    const v2 = makeProject('Version 2');

    const { result, rerender } = renderHook(
      ({ project }) => useHistory(project, setProject),
      { initialProps: { project: v1 } }
    );

    // Simulate the real flow: push V1 (initial state), then push V2 (after change)
    act(() => { result.current.pushSnapshot(v1); });
    act(() => { vi.runAllTimers(); });

    rerender({ project: v2 });
    act(() => { result.current.pushSnapshot(v2); });
    act(() => { vi.runAllTimers(); });

    // Undo should restore V1 (the state before the V2 change)
    act(() => { result.current.undo(); });

    expect(setProject).toHaveBeenCalledWith(expect.objectContaining({ name: 'Version 1' }));
    vi.useRealTimers();
  });

  it('canRedo becomes true after undo', () => {
    vi.useFakeTimers();
    const setProject = vi.fn();
    const v1 = makeProject('V1');
    const v2 = makeProject('V2');

    const { result, rerender } = renderHook(
      ({ project }) => useHistory(project, setProject),
      { initialProps: { project: v1 } }
    );

    act(() => { result.current.pushSnapshot(v1); });
    act(() => { vi.runAllTimers(); });

    rerender({ project: v2 });
    act(() => { result.current.pushSnapshot(v2); });
    act(() => { vi.runAllTimers(); });

    act(() => { result.current.undo(); });

    expect(result.current.canRedo).toBe(true);
    vi.useRealTimers();
  });

  it('redo restores the undone state', () => {
    vi.useFakeTimers();
    const setProject = vi.fn();
    const v1 = makeProject('V1');
    const v2 = makeProject('V2');

    const { result, rerender } = renderHook(
      ({ project }) => useHistory(project, setProject),
      { initialProps: { project: v1 } }
    );

    act(() => { result.current.pushSnapshot(v1); });
    act(() => { vi.runAllTimers(); });

    rerender({ project: v2 });
    act(() => { result.current.pushSnapshot(v2); });
    act(() => { vi.runAllTimers(); });

    act(() => { result.current.undo(); });
    // After undo, setProject called with V1
    expect(setProject).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'V1' }));

    // Simulate project reverting to v1
    rerender({ project: v1 });

    // Now redo
    act(() => { result.current.redo(); });
    expect(setProject).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'V2' }));
    vi.useRealTimers();
  });

  it('canRedo becomes false after new pushSnapshot', () => {
    vi.useFakeTimers();
    const setProject = vi.fn();
    const v1 = makeProject('V1');
    const v2 = makeProject('V2');
    const v3 = makeProject('V3');

    const { result, rerender } = renderHook(
      ({ project }) => useHistory(project, setProject),
      { initialProps: { project: v1 } }
    );

    act(() => { result.current.pushSnapshot(v1); });
    act(() => { vi.runAllTimers(); });

    rerender({ project: v2 });
    act(() => { result.current.pushSnapshot(v2); });
    act(() => { vi.runAllTimers(); });

    act(() => { result.current.undo(); });
    expect(result.current.canRedo).toBe(true);

    // Simulate reverting to v1 and then making a new change (clears future)
    rerender({ project: v1 });
    act(() => { result.current.pushSnapshot(v3); });
    act(() => { vi.runAllTimers(); });
    expect(result.current.canRedo).toBe(false);
    vi.useRealTimers();
  });

  it('does not push duplicate snapshots', () => {
    vi.useFakeTimers();
    const setProject = vi.fn();
    const v1 = makeProject('V1');
    const v2 = makeProject('V2');

    const { result } = renderHook(() => useHistory(v1, setProject));

    // Push V1 twice — second push should be deduplicated
    act(() => { result.current.pushSnapshot(v1); vi.runAllTimers(); });
    act(() => { result.current.pushSnapshot(v1); vi.runAllTimers(); }); // duplicate

    // Push V2 — this is a real new state
    act(() => { result.current.pushSnapshot(v2); vi.runAllTimers(); });

    // past = [V1, V2] — only 2 unique entries
    expect(result.current.canUndo).toBe(true);
    act(() => { result.current.undo(); }); // restore V1; past = [V1], future = [V2]
    expect(result.current.canUndo).toBe(false); // only V1 left, nothing to undo to
    vi.useRealTimers();
  });

  it('undo does nothing when no history', () => {
    const setProject = vi.fn();
    const project = makeProject('P');
    const { result } = renderHook(() => useHistory(project, setProject));
    act(() => { result.current.undo(); });
    expect(setProject).not.toHaveBeenCalled();
  });

  it('undo does nothing when only one snapshot exists (current state only)', () => {
    vi.useFakeTimers();
    const setProject = vi.fn();
    const project = makeProject('P');
    const { result } = renderHook(() => useHistory(project, setProject));

    act(() => { result.current.pushSnapshot(project); vi.runAllTimers(); });

    // Only 1 snapshot = current state; no previous state to restore
    act(() => { result.current.undo(); });
    expect(setProject).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('redo does nothing when no future', () => {
    const setProject = vi.fn();
    const project = makeProject('P');
    const { result } = renderHook(() => useHistory(project, setProject));
    act(() => { result.current.redo(); });
    expect(setProject).not.toHaveBeenCalled();
  });

  it('handles null project gracefully in undo', () => {
    const setProject = vi.fn();
    const { result } = renderHook(() => useHistory(null, setProject));
    expect(() => {
      act(() => { result.current.undo(); });
    }).not.toThrow();
    expect(setProject).not.toHaveBeenCalled();
  });

  it('limits history to 50 entries', () => {
    vi.useFakeTimers();
    const setProject = vi.fn();
    let project = makeProject('P0');

    const { result, rerender } = renderHook(
      ({ project }) => useHistory(project, setProject),
      { initialProps: { project } }
    );

    // Push 55 unique snapshots
    for (let i = 0; i < 55; i++) {
      project = makeProject(`P${i}`);
      rerender({ project });
      act(() => { result.current.pushSnapshot(project); });
      act(() => { vi.runAllTimers(); });
    }

    // Undo until canUndo is false (history is limited to 50, so at most 49 undos)
    let undoCount = 0;
    while (result.current.canUndo) {
      act(() => { result.current.undo(); });
      undoCount++;
      if (undoCount > 60) break; // safety guard
    }
    expect(undoCount).toBeLessThanOrEqual(50);
    vi.useRealTimers();
  });

  it('multiple undo/redo cycles work correctly', () => {
    vi.useFakeTimers();
    const setProject = vi.fn();
    const v1 = makeProject('V1');
    const v2 = makeProject('V2');
    const v3 = makeProject('V3');

    const { result, rerender } = renderHook(
      ({ project }) => useHistory(project, setProject),
      { initialProps: { project: v1 } }
    );

    // Build history: V1 → V2 → V3
    act(() => { result.current.pushSnapshot(v1); vi.runAllTimers(); });
    rerender({ project: v2 });
    act(() => { result.current.pushSnapshot(v2); vi.runAllTimers(); });
    rerender({ project: v3 });
    act(() => { result.current.pushSnapshot(v3); vi.runAllTimers(); });

    // Undo twice: V3 → V2 → V1
    act(() => { result.current.undo(); }); // restores V2
    expect(setProject).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'V2' }));

    rerender({ project: v2 });
    act(() => { result.current.undo(); }); // restores V1
    expect(setProject).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'V1' }));
    expect(result.current.canUndo).toBe(false);

    // Redo twice: V1 → V2 → V3
    rerender({ project: v1 });
    act(() => { result.current.redo(); }); // restores V2
    expect(setProject).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'V2' }));

    rerender({ project: v2 });
    act(() => { result.current.redo(); }); // restores V3
    expect(setProject).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'V3' }));
    expect(result.current.canRedo).toBe(false);
    vi.useRealTimers();
  });
});
