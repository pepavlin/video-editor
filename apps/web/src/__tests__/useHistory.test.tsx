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

  it('canUndo becomes true after pushSnapshot', () => {
    vi.useFakeTimers();
    const setProject = vi.fn();
    const project = makeProject('A');
    const { result } = renderHook(() => useHistory(project, setProject));

    act(() => {
      result.current.pushSnapshot(project);
      vi.runAllTimers();
    });

    expect(result.current.canUndo).toBe(true);
    vi.useRealTimers();
  });

  it('undo calls setProject with previous snapshot', async () => {
    vi.useFakeTimers();
    const setProject = vi.fn();
    const projectV1 = makeProject('Version 1');
    const projectV2 = makeProject('Version 2');

    // Start with V1
    const { result, rerender } = renderHook(
      ({ project }) => useHistory(project, setProject),
      { initialProps: { project: projectV1 } }
    );

    // Push V1 snapshot
    act(() => { result.current.pushSnapshot(projectV1); });
    act(() => { vi.runAllTimers(); });

    // Switch to V2
    rerender({ project: projectV2 });

    // Undo should restore V1
    act(() => { result.current.undo(); });

    expect(setProject).toHaveBeenCalledWith(expect.objectContaining({ name: 'Version 1' }));
    vi.useRealTimers();
  });

  it('canRedo becomes true after undo', async () => {
    vi.useFakeTimers();
    const setProject = vi.fn();
    const projectV1 = makeProject('V1');
    const projectV2 = makeProject('V2');

    const { result, rerender } = renderHook(
      ({ project }) => useHistory(project, setProject),
      { initialProps: { project: projectV1 } }
    );

    act(() => { result.current.pushSnapshot(projectV1); });
    act(() => { vi.runAllTimers(); });
    rerender({ project: projectV2 });

    act(() => { result.current.undo(); });

    expect(result.current.canRedo).toBe(true);
    vi.useRealTimers();
  });

  it('redo restores the undone state', async () => {
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

    act(() => { result.current.undo(); });
    // After undo, setProject called with V1
    expect(setProject).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'V1' }));

    // Now redo
    rerender({ project: v1 }); // simulate setProject effect
    act(() => { result.current.redo(); });
    expect(setProject).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'V2' }));
    vi.useRealTimers();
  });

  it('canRedo becomes false after new pushSnapshot', async () => {
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
    act(() => { result.current.undo(); });
    expect(result.current.canRedo).toBe(true);

    // Push a new snapshot - future should clear
    rerender({ project: v1 });
    act(() => { result.current.pushSnapshot(v3); });
    act(() => { vi.runAllTimers(); });
    expect(result.current.canRedo).toBe(false);
    vi.useRealTimers();
  });

  it('does not push duplicate snapshots', async () => {
    vi.useFakeTimers();
    const setProject = vi.fn();
    const project = makeProject('Same');

    const { result } = renderHook(() => useHistory(project, setProject));

    act(() => { result.current.pushSnapshot(project); });
    act(() => { vi.runAllTimers(); });
    act(() => { result.current.pushSnapshot(project); }); // same content
    act(() => { vi.runAllTimers(); });

    // Should only have 1 history entry (no duplicate)
    expect(result.current.canUndo).toBe(true);
    act(() => { result.current.undo(); });
    // After one undo, no more past
    expect(result.current.canUndo).toBe(false);
    vi.useRealTimers();
  });

  it('undo does nothing when no history', () => {
    const setProject = vi.fn();
    const project = makeProject('P');
    const { result } = renderHook(() => useHistory(project, setProject));
    act(() => { result.current.undo(); });
    expect(setProject).not.toHaveBeenCalled();
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

  it('limits history to 50 entries', async () => {
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

    // Undo 50 times (history is limited to 50)
    let undoCount = 0;
    while (result.current.canUndo) {
      act(() => { result.current.undo(); });
      undoCount++;
      if (undoCount > 60) break; // safety guard
    }
    expect(undoCount).toBeLessThanOrEqual(50);
    vi.useRealTimers();
  });
});
