'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import type { Asset, BeatsData, WaveformData } from '@video-editor/shared';
import { useProject } from '@/hooks/useProject';
import { usePlayback } from '@/hooks/usePlayback';
import { useHistory } from '@/hooks/useHistory';
import * as api from '@/lib/api';
import MediaBin from './MediaBin';
import Preview from './Preview';
import Timeline from './Timeline';
import Inspector from './Inspector';
import TransportControls from './TransportControls';
import ProjectBar from './ProjectBar';

// ─── Draggable panel types ────────────────────────────────────────────────────

type PanelId = 'project-bar' | 'preview' | 'transport';
const DEFAULT_PANEL_ORDER: PanelId[] = ['project-bar', 'preview', 'transport'];

function loadPanelOrder(): PanelId[] {
  try {
    const stored = typeof window !== 'undefined' ? localStorage.getItem('ve-panel-order') : null;
    if (stored) {
      const parsed = JSON.parse(stored) as PanelId[];
      if (
        parsed.length === DEFAULT_PANEL_ORDER.length &&
        DEFAULT_PANEL_ORDER.every((id) => parsed.includes(id))
      ) {
        return parsed;
      }
    }
  } catch {}
  return DEFAULT_PANEL_ORDER;
}

/** Grip icon rendered in each draggable panel's handle */
function GripIcon() {
  return (
    <svg width="20" height="8" viewBox="0 0 20 8" fill="rgba(255,255,255,0.25)">
      <circle cx="4" cy="2" r="1.5" />
      <circle cx="10" cy="2" r="1.5" />
      <circle cx="16" cy="2" r="1.5" />
      <circle cx="4" cy="6" r="1.5" />
      <circle cx="10" cy="6" r="1.5" />
      <circle cx="16" cy="6" r="1.5" />
    </svg>
  );
}

// ─── Resize handle ───────────────────────────────────────────────────────────

function useResizeHandle(
  sizeRef: React.MutableRefObject<number>,
  setSize: (s: number) => void,
  direction: 'horizontal' | 'vertical',
  min: number,
  max: number,
  storageKey: string
) {
  return useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startPos = direction === 'horizontal' ? e.clientX : e.clientY;
      const startSize = sizeRef.current;

      const onMove = (ev: MouseEvent) => {
        const delta = (direction === 'horizontal' ? ev.clientX : ev.clientY) - startPos;
        const sign = direction === 'horizontal' ? 1 : -1;
        const next = Math.max(min, Math.min(max, startSize + sign * delta));
        setSize(next);
        localStorage.setItem(storageKey, String(next));
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
      document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [direction, min, max, storageKey]
  );
}

// ─── Log line picker ─────────────────────────────────────────────────────────

function pickLogLine(lines: string[]): string | null {
  if (!lines || lines.length === 0) return null;
  // Walk from most recent backward to find something meaningful
  for (let i = lines.length - 1; i >= 0; i--) {
    const raw = lines[i].trim();
    if (!raw) continue;
    // ffmpeg encoding line: extract short summary
    const frameMatch = raw.match(/frame=\s*(\d+).*fps=\s*([\d.]+).*time=([\d:]+)/);
    if (frameMatch) return `frame ${frameMatch[1]} · ${frameMatch[2]} fps · ${frameMatch[3]}`;
    // Skip very long codec/header dumps
    if (raw.length > 120) continue;
    // Strip leading [tag] prefix
    return raw.replace(/^\[[\w_]+\]\s*/, '').slice(0, 80);
  }
  return null;
}

// ─── Editor ──────────────────────────────────────────────────────────────────

export default function Editor() {
  const projectHook = useProject();
  const {
    project,
    setProject,
    saving,
    createProject,
    updateProject,
    addTrack,
    addTextTrack,
    addClip,
    updateClip,
    deleteClip,
    splitClip,
    addEffect,
    removeEffect,
    updateEffect,
    findClip,
    reorderTrack,
  } = projectHook;

  const [assets, setAssets] = useState<Asset[]>([]);
  const [draggedAssetId, setDraggedAssetId] = useState<string | null>(null);
  const [waveforms, setWaveforms] = useState(new Map<string, WaveformData>());
  const [beatsData, setBeatsData] = useState(new Map<string, BeatsData>());
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [showProjectPicker, setShowProjectPicker] = useState(true);
  const [projects, setProjects] = useState<any[]>([]);
  const [newProjectName, setNewProjectName] = useState('My Short');
  const [jobNotifications, setJobNotifications] = useState<string[]>([]);
  const [beatsProgress, setBeatsProgress] = useState<number | null>(null);
  const [beatsLogLine, setBeatsLogLine] = useState<string | null>(null);
  const [exportProgress, setExportProgress] = useState<number | null>(null);
  const [exportLogLine, setExportLogLine] = useState<string | null>(null);
  const [completedExportJobId, setCompletedExportJobId] = useState<string | null>(null);

  // ── Panel order (draggable sections, persisted) ────────────────────────────
  const [panelOrder, setPanelOrder] = useState<PanelId[]>(loadPanelOrder);
  const [draggingPanel, setDraggingPanel] = useState<PanelId | null>(null);
  const [dropTargetIdx, setDropTargetIdx] = useState<number | null>(null);

  const handlePanelDragStart = useCallback((id: PanelId) => setDraggingPanel(id), []);
  const handlePanelDragEnd = useCallback(() => {
    setDraggingPanel(null);
    setDropTargetIdx(null);
  }, []);
  const handleDropZoneOver = useCallback((idx: number) => setDropTargetIdx(idx), []);
  const handleDropZoneDrop = useCallback(
    (idx: number) => {
      if (!draggingPanel) return;
      const without = panelOrder.filter((id) => id !== draggingPanel);
      const fromIdx = panelOrder.indexOf(draggingPanel);
      const insertIdx = idx > fromIdx ? idx - 1 : idx;
      without.splice(Math.max(0, Math.min(insertIdx, without.length)), 0, draggingPanel);
      setPanelOrder(without);
      localStorage.setItem('ve-panel-order', JSON.stringify(without));
      setDraggingPanel(null);
      setDropTargetIdx(null);
    },
    [draggingPanel, panelOrder]
  );

  // ── Panel sizes (persisted) ────────────────────────────────────────────────
  const storedLeft = typeof window !== 'undefined' ? parseInt(localStorage.getItem('ve-left-width') || '300', 10) : 300;
  const storedRight = typeof window !== 'undefined' ? parseInt(localStorage.getItem('ve-right-width') || '360', 10) : 360;
  const storedTimeline = typeof window !== 'undefined' ? parseInt(localStorage.getItem('ve-timeline-h') || '260', 10) : 260;

  const [leftWidth, setLeftWidth] = useState(storedLeft);
  const [rightWidth, setRightWidth] = useState(storedRight);
  const [timelineHeight, setTimelineHeight] = useState(storedTimeline);

  const leftWidthRef = useRef(leftWidth);
  leftWidthRef.current = leftWidth;
  const rightWidthRef = useRef(rightWidth);
  rightWidthRef.current = rightWidth;
  const timelineHeightRef = useRef(timelineHeight);
  timelineHeightRef.current = timelineHeight;

  const onLeftResize = useResizeHandle(leftWidthRef, setLeftWidth, 'horizontal', 200, 520, 've-left-width');
  const onRightResize = useResizeHandle(rightWidthRef, setRightWidth, 'horizontal', 240, 560, 've-right-width');
  const onTimelineResize = useResizeHandle(timelineHeightRef, setTimelineHeight, 'vertical', 120, 520, 've-timeline-h');

  const beatsRef = useRef(beatsData);
  beatsRef.current = beatsData;

  // Derive effective work area from project (fallback to full duration when absent)
  const workArea = project?.workArea
    ? { start: project.workArea.start, end: project.workArea.end }
    : project
    ? { start: 0, end: project.duration }
    : null;

  const handleWorkAreaChange = useCallback(
    (start: number, end: number) => {
      updateProject((p) => ({ ...p, workArea: { start, end, isManual: true } }));
    },
    [updateProject]
  );

  const playback = usePlayback(project, assets, beatsData, workArea);
  const history = useHistory(project, setProject);

  const refreshAssets = useCallback(async () => {
    try {
      const { assets: list } = await api.listAssets();
      setAssets(list);
      for (const asset of list) {
        if (asset.waveformPath && !waveforms.has(asset.id)) {
          api.getWaveform(asset.id)
            .then((wf) => setWaveforms((prev) => new Map(prev).set(asset.id, wf)))
            .catch(() => {});
        }
        if (asset.beatsPath && !beatsRef.current.has(asset.id)) {
          api.getBeats(asset.id)
            .then((b) => setBeatsData((prev) => new Map(prev).set(asset.id, b)))
            .catch(() => {});
        }
      }
    } catch (e) {
      console.warn('Failed to load assets', e);
    }
  }, [waveforms]);

  const refreshProjects = useCallback(async () => {
    try {
      const { projects: list } = await api.listProjects();
      setProjects(list);
    } catch (e) {
      console.warn('Failed to load projects', e);
    }
  }, []);

  const refreshAssetsRef = useRef(refreshAssets);
  useEffect(() => { refreshAssetsRef.current = refreshAssets; }, [refreshAssets]);

  // Persist open project ID to URL and restore on page load
  const setUrlProject = (id: string | null) => {
    const url = id ? `?p=${id}` : window.location.pathname;
    window.history.replaceState(null, '', url);
  };

  useEffect(() => {
    refreshProjects();

    const params = new URLSearchParams(window.location.search);
    const urlProjectId = params.get('p');
    if (urlProjectId) {
      projectHook.loadProject(urlProjectId)
        .then(() => {
          refreshAssetsRef.current();
          setShowProjectPicker(false);
        })
        .catch(() => {
          // Project not found — clear stale URL param and show picker
          setUrlProject(null);
          refreshAssetsRef.current();
        });
    } else {
      refreshAssetsRef.current();
    }

    const iv = setInterval(() => refreshAssetsRef.current(), 3000);
    return () => clearInterval(iv);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      if (e.code === 'Space') {
        e.preventDefault();
        playback.toggle();
      } else if (e.code === 'KeyS' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        if (selectedClipId) splitClip(selectedClipId, playback.currentTime);
      } else if (e.code === 'Delete' || e.code === 'Backspace') {
        if (selectedClipId) { deleteClip(selectedClipId); setSelectedClipId(null); }
      } else if (e.code === 'KeyZ' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (e.shiftKey) history.redo(); else history.undo();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [playback, selectedClipId, splitClip, deleteClip, history]);

  useEffect(() => {
    if (project) history.pushSnapshot(project);
  }, [project]);

  const notify = (msg: string) => {
    setJobNotifications((prev) => [...prev.slice(-4), msg]);
    setTimeout(() => setJobNotifications((prev) => prev.filter((m) => m !== msg)), 5000);
  };

  // Clear dragged asset when drag ends anywhere on the document
  useEffect(() => {
    const onDragEnd = () => setDraggedAssetId(null);
    document.addEventListener('dragend', onDragEnd);
    return () => document.removeEventListener('dragend', onDragEnd);
  }, []);

  const draggedAsset = assets.find((a) => a.id === draggedAssetId) ?? null;

  // Handle drop that creates a new track + adds clip atomically
  const handleDropAssetNewTrack = useCallback(
    (assetType: 'video' | 'audio', assetId: string, timelineStart: number, duration: number) => {
      updateProject((p) => {
        const count = p.tracks.filter((t) => t.type === assetType).length;
        const name = assetType === 'audio' ? `Audio ${count + 1}` : `Video ${count + 1}`;
        const trackId = `track_${Date.now()}`;
        const isVideo = assetType === 'video';
        const newClip = {
          id: `clip_${Date.now()}`,
          assetId,
          trackId,
          timelineStart,
          timelineEnd: timelineStart + duration,
          sourceStart: 0,
          sourceEnd: duration,
          effects: [] as any[],
          ...(isVideo && {
            useClipAudio: false,
            clipAudioVolume: 1,
            transform: { scale: 1, x: 0, y: 0, rotation: 0, opacity: 1 },
          }),
        };
        const newTrack = {
          id: trackId,
          type: assetType,
          name,
          isMaster: false,
          muted: false,
          clips: [newClip],
        };
        return { ...p, tracks: [...p.tracks, newTrack] };
      });
    },
    [updateProject]
  );

  const masterTrack = project?.tracks.find((t) => t.type === 'audio' && t.isMaster);
  const masterClip = masterTrack?.clips[0];
  const masterAssetId = masterClip?.assetId;
  const masterAsset = masterAssetId ? assets.find((a) => a.id === masterAssetId) ?? null : null;

  const handleAnalyzeBeats = async (assetId?: string) => {
    const id = assetId ?? masterAssetId;
    if (!id) return;
    setBeatsProgress(0);
    setBeatsLogLine(null);
    try {
      const { jobId } = await api.analyzeBeats(id);
      await api.pollJob(jobId, (j) => {
        setBeatsProgress(j.progress);
        const line = pickLogLine(j.lastLogLines);
        if (line) setBeatsLogLine(line);
      });
      const beats = await api.getBeats(id);
      setBeatsData((prev) => new Map(prev).set(id, beats));
      refreshAssets();
    } catch (e: any) { notify(`Beat analysis failed: ${e.message}`); }
    finally { setBeatsProgress(null); setBeatsLogLine(null); }
  };

  const handleAlignLyrics = async (text: string) => {
    if (!project) return;
    notify('Starting lyrics alignment...');
    try {
      const { jobId } = await api.alignLyrics(project.id, text, masterAssetId);
      await api.pollJob(jobId, (j) => notify(`Lyrics: ${j.progress}%`));
      const { project: updated } = await api.loadProject(project.id);
      setProject(updated);
      notify('Lyrics aligned!');
    } catch (e: any) { notify(`Lyrics alignment failed: ${e.message}`); }
  };

  const handleStartCutout = async (clipId: string) => {
    const clip = findClip(clipId);
    if (!clip) return;
    notify('Starting cutout processing...');
    try {
      const { jobId } = await api.startCutout(clip.assetId);
      updateEffect(clipId, 'cutout', { maskStatus: 'processing' });
      api.pollJob(jobId, (j) => notify(`Cutout: ${j.progress}%`)).then(() => {
        updateEffect(clipId, 'cutout', { maskStatus: 'done' });
        notify('Cutout done!');
        refreshAssets();
      }).catch((e) => {
        updateEffect(clipId, 'cutout', { maskStatus: 'error' });
        notify(`Cutout failed: ${e.message}`);
      });
    } catch (e: any) { notify(`Cutout error: ${e.message}`); }
  };

  const handleSyncAudio = async (clipId: string) => {
    if (!project) return;
    notify('Analyzing audio alignment...');
    try {
      const result = await api.syncClipAudio(project.id, clipId);
      const clip = findClip(clipId);
      if (!clip) return;
      const clipDuration = clip.timelineEnd - clip.timelineStart;
      updateClip(clipId, {
        timelineStart: result.newTimelineStart,
        timelineEnd: result.newTimelineStart + clipDuration,
      });
      const pct = Math.round(result.confidence * 100);
      notify(`Audio synced! Confidence: ${pct}%`);
    } catch (e: any) {
      notify(`Auto sync failed: ${e.message}`);
    }
  };

  const handleExport = async () => {
    if (!project) return;
    setExportProgress(0);
    setExportLogLine(null);
    setCompletedExportJobId(null);
    try {
      const wa = project.workArea;
      const exportOpts = wa
        ? { startTime: wa.start, endTime: wa.end }
        : {};
      const { jobId } = await api.exportProject(project.id, exportOpts);
      api.pollJob(jobId, (j) => {
        setExportProgress(j.progress);
        const line = pickLogLine(j.lastLogLines);
        if (line) setExportLogLine(line);
      }, 800).then(() => {
        setExportProgress(null);
        setExportLogLine(null);
        setCompletedExportJobId(jobId);
      }).catch((e) => {
        setExportProgress(null);
        setExportLogLine(null);
        notify(`Export failed: ${e.message}`);
      });
    } catch (e: any) {
      setExportProgress(null);
      setExportLogLine(null);
      notify(`Export error: ${e.message}`);
    }
  };

  const handleDownload = () => {
    if (!completedExportJobId) return;
    window.open(api.getJobOutputUrl(completedExportJobId), '_blank');
    setCompletedExportJobId(null);
  };

  // ── Project picker ─────────────────────────────────────────────────────────
  if (showProjectPicker) {
    return (
      <div className="h-screen flex items-center justify-center" style={{ background: 'inherit' }}>
        <div className="glass rounded-2xl p-10 w-[480px] space-y-8 shadow-panel">
          {/* Logo / Title */}
          <div>
            <h1 className="text-3xl font-bold text-gradient">Video Editor</h1>
            <p className="text-sm mt-2" style={{ color: 'rgba(255,255,255,0.38)' }}>Craft your story, frame by frame</p>
          </div>

          {/* New project */}
          <div className="space-y-4">
            <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'rgba(0,212,160,0.65)', letterSpacing: '0.1em' }}>New Project</p>
            <input
              type="text"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              placeholder="Project name"
              style={{ fontSize: 15 }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  createProject(newProjectName).then((proj) => {
                    if (proj?.id) setUrlProject(proj.id);
                    refreshAssets();
                    setShowProjectPicker(false);
                  });
                }
              }}
            />
            <button
              className="btn btn-primary w-full"
              style={{ padding: '12px 16px', fontSize: 15 }}
              onClick={async () => {
                const proj = await createProject(newProjectName);
                if (proj?.id) setUrlProject(proj.id);
                await refreshAssets();
                setShowProjectPicker(false);
              }}
            >
              Create Project
            </button>
          </div>

          {/* Recent */}
          {projects.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'rgba(0,212,160,0.65)', letterSpacing: '0.1em' }}>Recent</p>
              <div className="space-y-2 max-h-56 overflow-y-auto">
                {projects.map((p) => (
                  <button
                    key={p.id}
                    className="w-full text-left rounded-xl p-4 transition-all duration-150"
                    style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}
                    onMouseEnter={(e) => {
                      const el = e.currentTarget as HTMLElement;
                      el.style.background = 'rgba(0,212,160,0.09)';
                      el.style.borderColor = 'rgba(0,212,160,0.28)';
                      el.style.transform = 'translateY(-1px)';
                    }}
                    onMouseLeave={(e) => {
                      const el = e.currentTarget as HTMLElement;
                      el.style.background = 'rgba(255,255,255,0.04)';
                      el.style.borderColor = 'rgba(255,255,255,0.07)';
                      el.style.transform = '';
                    }}
                    onClick={async () => {
                      await projectHook.loadProject(p.id);
                      setUrlProject(p.id);
                      await refreshAssets();
                      setShowProjectPicker(false);
                    }}
                  >
                    <div className="text-sm font-semibold" style={{ color: '#d0ece6' }}>{p.name}</div>
                    <div className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.28)' }}>{new Date(p.updatedAt).toLocaleDateString()}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Main editor layout ─────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-screen overflow-hidden">

      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <div
        className="flex items-center px-5 flex-shrink-0 gap-4 border-b"
        style={{
          height: 56,
          background: 'rgba(8,16,30,0.97)',
          backdropFilter: 'blur(24px)',
          borderColor: 'rgba(255,255,255,0.07)',
          boxShadow: 'inset 0 -1px 0 rgba(0,212,160,0.08)',
        }}
      >
        <span className="font-bold text-gradient" style={{ fontSize: 16 }}>
          {project?.name ?? 'Video Editor'}
        </span>
        {project && (
          <span
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1 transition-all"
            style={{
              fontSize: 12,
              color: saving ? 'rgba(255,255,255,0.45)' : 'rgba(0,212,160,0.80)',
              background: saving ? 'rgba(255,255,255,0.05)' : 'rgba(0,212,160,0.08)',
              border: `1px solid ${saving ? 'rgba(255,255,255,0.08)' : 'rgba(0,212,160,0.20)'}`,
              letterSpacing: '0.01em',
            }}
          >
            {saving ? (
              <>
                <span className="inline-block w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'rgba(255,255,255,0.40)' }} />
                Ukládání...
              </>
            ) : (
              <>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path d="M1.5 5L4 7.5L8.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Uloženo
              </>
            )}
          </span>
        )}

        <div className="flex-1" />

        <button
          className="btn btn-ghost"
          style={{ fontSize: 13 }}
          onClick={() => { setShowProjectPicker(true); refreshProjects(); }}
        >
          Projects
        </button>

        <div className="w-px h-5" style={{ background: 'rgba(255,255,255,0.10)' }} />

        <button
          className="btn btn-ghost disabled:opacity-25"
          style={{ fontSize: 18, padding: '4px 10px' }}
          disabled={!history.canUndo}
          onClick={history.undo}
          title="Undo (Cmd+Z)"
        >
          ↺
        </button>
        <button
          className="btn btn-ghost disabled:opacity-25"
          style={{ fontSize: 18, padding: '4px 10px' }}
          disabled={!history.canRedo}
          onClick={history.redo}
          title="Redo (Shift+Cmd+Z)"
        >
          ↻
        </button>

        <div className="w-px h-5" style={{ background: 'rgba(255,255,255,0.10)' }} />

        <button
          className="btn btn-ghost"
          style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, opacity: project ? 1 : 0.4 }}
          disabled={!project}
          title="Add a text element to the timeline"
          onClick={() => {
            if (!project) return;
            const start = playback.currentTime;
            const duration = 3;
            const clipId = addTextTrack(start, duration, 'Text');
            setSelectedClipId(clipId);
          }}
        >
          <span style={{ fontSize: 15, fontWeight: 700 }}>T</span>
          Add Text
        </button>
      </div>

      {/* ── Main area ───────────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0">

        {/* Left: Media Bin */}
        <div
          className="flex-shrink-0 border-r panel flex flex-col"
          style={{ width: leftWidth, borderColor: 'rgba(255,255,255,0.07)' }}
        >
          <MediaBin assets={assets} onAssetsChange={refreshAssets} onDragAsset={setDraggedAssetId} />
        </div>

        {/* Left resize handle */}
        <div
          className="resize-handle-h flex-shrink-0 transition-colors duration-100"
          style={{ width: 5, background: 'rgba(255,255,255,0.04)' }}
          onMouseDown={onLeftResize}
        />

        {/* Center: draggable panels + Timeline */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0">

          {/* ── Draggable panel area (project-bar, preview, transport) ────── */}
          {panelOrder.map((panelId, idx) => (
            <div
              key={panelId}
              style={{ display: 'contents' }}
            >
              {/* Drop zone before this panel */}
              <div
                onDragOver={(e) => { e.preventDefault(); handleDropZoneOver(idx); }}
                onDragLeave={() => setDropTargetIdx(null)}
                onDrop={() => handleDropZoneDrop(idx)}
                style={{
                  flexShrink: 0,
                  height: draggingPanel && draggingPanel !== panelId ? 4 : 0,
                  background: dropTargetIdx === idx && draggingPanel !== panelId
                    ? 'rgba(0,212,160,0.8)'
                    : 'transparent',
                  transition: 'background 0.1s, height 0.1s',
                  boxShadow: dropTargetIdx === idx && draggingPanel !== panelId
                    ? '0 0 8px rgba(0,212,160,0.6)'
                    : 'none',
                }}
              />

              {/* Panel content */}
              {panelId === 'project-bar' && (
                <div
                  className="flex-shrink-0"
                  style={{ opacity: draggingPanel === 'project-bar' ? 0.45 : 1, transition: 'opacity 0.15s' }}
                >
                  {/* Drag handle */}
                  <div
                    draggable
                    onDragStart={() => handlePanelDragStart('project-bar')}
                    onDragEnd={handlePanelDragEnd}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      height: 10,
                      cursor: 'grab',
                      background: 'rgba(255,255,255,0.02)',
                      borderBottom: '1px solid rgba(255,255,255,0.05)',
                    }}
                    title="Drag to reorder panel"
                  >
                    <GripIcon />
                  </div>
                  <ProjectBar
                    masterAsset={masterAsset}
                    beatsData={beatsData}
                    onAnalyzeBeats={handleAnalyzeBeats}
                    onExport={handleExport}
                    beatsProgress={beatsProgress}
                    beatsLogLine={beatsLogLine}
                    exportProgress={exportProgress}
                    exportLogLine={exportLogLine}
                    completedExportJobId={completedExportJobId}
                    onDownload={handleDownload}
                  />
                </div>
              )}

              {panelId === 'preview' && (
                <Preview
                  project={project}
                  assets={assets}
                  currentTime={playback.currentTime}
                  isPlaying={playback.isPlaying}
                  beatsData={beatsData}
                  selectedClipId={selectedClipId}
                  onClipSelect={setSelectedClipId}
                  onClipUpdate={updateClip}
                />
              )}

              {panelId === 'transport' && (
                <div
                  className="flex-shrink-0"
                  style={{ opacity: draggingPanel === 'transport' ? 0.45 : 1, transition: 'opacity 0.15s' }}
                >
                  {/* Drag handle */}
                  <div
                    draggable
                    onDragStart={() => handlePanelDragStart('transport')}
                    onDragEnd={handlePanelDragEnd}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      height: 10,
                      cursor: 'grab',
                      background: 'rgba(255,255,255,0.02)',
                      borderBottom: '1px solid rgba(255,255,255,0.05)',
                    }}
                    title="Drag to reorder panel"
                  >
                    <GripIcon />
                  </div>
                  <TransportControls
                    isPlaying={playback.isPlaying}
                    currentTime={playback.currentTime}
                    duration={playback.duration || project?.duration || 0}
                    isLooping={playback.isLooping}
                    workArea={workArea}
                    onToggle={playback.toggle}
                    onLoopToggle={playback.toggleLoop}
                    onSeek={playback.seek}
                    getTime={playback.getTime}
                    onWorkAreaChange={handleWorkAreaChange}
                  />
                </div>
              )}
            </div>
          ))}

          {/* Final drop zone (after last panel, before timeline) */}
          <div
            onDragOver={(e) => { e.preventDefault(); handleDropZoneOver(panelOrder.length); }}
            onDragLeave={() => setDropTargetIdx(null)}
            onDrop={() => handleDropZoneDrop(panelOrder.length)}
            style={{
              flexShrink: 0,
              height: draggingPanel ? 4 : 0,
              background: dropTargetIdx === panelOrder.length
                ? 'rgba(0,212,160,0.8)'
                : 'transparent',
              transition: 'background 0.1s, height 0.1s',
              boxShadow: dropTargetIdx === panelOrder.length
                ? '0 0 8px rgba(0,212,160,0.6)'
                : 'none',
            }}
          />

          {/* Timeline resize handle */}
          <div
            className="resize-handle-v flex-shrink-0 transition-colors duration-100"
            style={{ height: 4, background: 'rgba(255,255,255,0.04)', borderTop: '1px solid rgba(255,255,255,0.07)' }}
            onMouseDown={onTimelineResize}
          />

          {/* Timeline */}
          <div
            className="flex-shrink-0 overflow-x-auto"
            style={{ height: timelineHeight, borderTop: '1px solid rgba(255,255,255,0.07)' }}
          >
            <Timeline
              project={project}
              currentTime={playback.currentTime}
              assets={assets}
              waveforms={waveforms}
              beatsData={beatsData}
              selectedClipId={selectedClipId}
              workArea={workArea}
              draggedAsset={draggedAsset}
              onSeek={playback.seek}
              onClipSelect={setSelectedClipId}
              onClipUpdate={(clipId, updates) => updateClip(clipId, updates)}
              onClipDelete={(clipId) => { deleteClip(clipId); setSelectedClipId(null); }}
              onSplit={(clipId, time) => splitClip(clipId, time)}
              onDropAsset={(trackId, assetId, start, dur) => addClip(trackId, assetId, start, dur)}
              onDropAssetNewTrack={handleDropAssetNewTrack}
              onWorkAreaChange={handleWorkAreaChange}
              onTrackReorder={reorderTrack}
            />
          </div>
        </div>

        {/* Right resize handle */}
        <div
          className="resize-handle-h flex-shrink-0 transition-colors duration-100"
          style={{ width: 5, background: 'rgba(255,255,255,0.04)' }}
          onMouseDown={onRightResize}
        />

        {/* Right: Inspector */}
        <div
          className="flex-shrink-0 border-l panel flex flex-col overflow-y-auto"
          style={{ width: rightWidth, borderColor: 'rgba(255,255,255,0.07)' }}
        >
          <Inspector
            project={project}
            selectedClipId={selectedClipId}
            assets={assets}
            onClipUpdate={updateClip}
            onAddEffect={addEffect}
            onRemoveEffect={removeEffect}
            onUpdateEffect={updateEffect}
            onUpdateProject={updateProject}
            masterAssetId={masterAssetId}
            onAlignLyrics={handleAlignLyrics}
            onStartCutout={handleStartCutout}
            onExport={handleExport}
            onSyncAudio={masterAssetId ? handleSyncAudio : undefined}
          />
        </div>
      </div>

      {/* ── Notifications ───────────────────────────────────────────────── */}
      {jobNotifications.length > 0 && (
        <div className="fixed bottom-5 right-5 space-y-2 z-50">
          {jobNotifications.map((msg, i) => (
            <div
              key={i}
              className="glass rounded-xl px-5 py-4 shadow-panel flex items-center gap-3 toast-enter"
              style={{ minWidth: 280, color: '#c8e8e0', fontSize: 13 }}
            >
              <span
                className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                style={{ background: 'linear-gradient(135deg, #00d4a0, #38bdf8)' }}
              />
              {msg}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
