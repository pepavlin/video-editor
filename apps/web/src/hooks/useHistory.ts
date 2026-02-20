import { useCallback, useRef, useState } from 'react';
import type { Project } from '@video-editor/shared';

const MAX_HISTORY = 50;

interface HistoryState {
  past: string[];   // JSON snapshots
  future: string[];
}

export function useHistory(
  project: Project | null,
  setProject: (p: Project) => void
) {
  const [historyState, setHistoryState] = useState<HistoryState>({ past: [], future: [] });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Store the last pushed snapshot to avoid duplicates
  const lastSnapshotRef = useRef<string>('');

  const pushSnapshot = useCallback((p: Project) => {
    const snap = JSON.stringify(p);
    if (snap === lastSnapshotRef.current) return;
    lastSnapshotRef.current = snap;

    setHistoryState((prev) => ({
      past: [...prev.past.slice(-(MAX_HISTORY - 1)), snap],
      future: [],
    }));
  }, []);

  const debouncedPush = useCallback(
    (p: Project) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        pushSnapshot(p);
      }, 300);
    },
    [pushSnapshot]
  );

  const undo = useCallback(() => {
    if (!project) return;
    setHistoryState((prev) => {
      if (prev.past.length === 0) return prev;
      const newPast = [...prev.past];
      const snapshot = newPast.pop()!;
      const currentSnap = JSON.stringify(project);
      setProject(JSON.parse(snapshot) as Project);
      lastSnapshotRef.current = snapshot;
      return {
        past: newPast,
        future: [currentSnap, ...prev.future],
      };
    });
  }, [project, setProject]);

  const redo = useCallback(() => {
    setHistoryState((prev) => {
      if (prev.future.length === 0) return prev;
      const [snapshot, ...newFuture] = prev.future;
      setProject(JSON.parse(snapshot) as Project);
      lastSnapshotRef.current = snapshot;
      return {
        past: [...prev.past, JSON.stringify(project)],
        future: newFuture,
      };
    });
  }, [project, setProject]);

  return {
    pushSnapshot: debouncedPush,
    undo,
    redo,
    canUndo: historyState.past.length > 0,
    canRedo: historyState.future.length > 0,
  };
}
