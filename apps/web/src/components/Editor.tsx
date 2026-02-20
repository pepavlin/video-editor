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
    addClip,
    updateClip,
    deleteClip,
    splitClip,
    addEffect,
    removeEffect,
    updateEffect,
    findClip,
  } = projectHook;

  const [assets, setAssets] = useState<Asset[]>([]);
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

  // ── Panel sizes (persisted) ────────────────────────────────────────────────
  const storedLeft = typeof window !== 'undefined' ? parseInt(localStorage.getItem('ve-left-width') || '260', 10) : 260;
  const storedRight = typeof window !== 'undefined' ? parseInt(localStorage.getItem('ve-right-width') || '300', 10) : 300;
  const storedTimeline = typeof window !== 'undefined' ? parseInt(localStorage.getItem('ve-timeline-h') || '220', 10) : 220;

  const [leftWidth, setLeftWidth] = useState(storedLeft);
  const [rightWidth, setRightWidth] = useState(storedRight);
  const [timelineHeight, setTimelineHeight] = useState(storedTimeline);

  const leftWidthRef = useRef(leftWidth);
  leftWidthRef.current = leftWidth;
  const rightWidthRef = useRef(rightWidth);
  rightWidthRef.current = rightWidth;
  const timelineHeightRef = useRef(timelineHeight);
  timelineHeightRef.current = timelineHeight;

  const onLeftResize = useResizeHandle(leftWidthRef, setLeftWidth, 'horizontal', 160, 480, 've-left-width');
  const onRightResize = useResizeHandle(rightWidthRef, setRightWidth, 'horizontal', 200, 520, 've-right-width');
  const onTimelineResize = useResizeHandle(timelineHeightRef, setTimelineHeight, 'vertical', 100, 500, 've-timeline-h');

  const beatsRef = useRef(beatsData);
  beatsRef.current = beatsData;

  const playback = usePlayback(project, assets, beatsData);
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

  useEffect(() => {
    refreshAssetsRef.current();
    refreshProjects();
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

  const handleExport = async () => {
    if (!project) return;
    setExportProgress(0);
    setExportLogLine(null);
    setCompletedExportJobId(null);
    try {
      const { jobId } = await api.exportProject(project.id);
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
        <div className="glass rounded-2xl p-8 w-[420px] space-y-7 shadow-panel">
          {/* Logo / Title */}
          <div>
            <h1 className="text-2xl font-bold text-gradient">Video Editor</h1>
            <p className="text-xs text-gray-500 mt-1">Craft your story, frame by frame</p>
          </div>

          {/* New project */}
          <div className="space-y-3">
            <p className="text-xs text-gray-500 font-semibold uppercase tracking-wider">New Project</p>
            <input
              type="text"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              placeholder="Project name"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  createProject(newProjectName).then(() => {
                    refreshAssets();
                    setShowProjectPicker(false);
                  });
                }
              }}
            />
            <button
              className="btn btn-primary w-full py-2.5"
              onClick={async () => {
                await createProject(newProjectName);
                await refreshAssets();
                setShowProjectPicker(false);
              }}
            >
              Create Project
            </button>
          </div>

          {/* Recent */}
          {projects.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-gray-500 font-semibold uppercase tracking-wider">Recent</p>
              <div className="space-y-1.5 max-h-52 overflow-y-auto">
                {projects.map((p) => (
                  <button
                    key={p.id}
                    className="w-full text-left rounded-xl p-3 transition-all duration-150"
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
                      await refreshAssets();
                      setShowProjectPicker(false);
                    }}
                  >
                    <div className="text-sm font-medium" style={{ color: '#d0ece6' }}>{p.name}</div>
                    <div className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.3)' }}>{new Date(p.updatedAt).toLocaleDateString()}</div>
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
        className="flex items-center px-4 h-12 flex-shrink-0 gap-4 border-b"
        style={{
          background: 'rgba(10,18,32,0.96)',
          backdropFilter: 'blur(24px)',
          borderColor: 'rgba(255,255,255,0.08)',
          boxShadow: 'inset 0 -1px 0 rgba(0,212,160,0.10)',
        }}
      >
        <span className="font-semibold text-gradient text-sm">
          {project?.name ?? 'Video Editor'}
        </span>
        {saving && (
          <span className="text-xs text-gray-600 flex items-center gap-1">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent/60 animate-pulse" />
            Saving
          </span>
        )}

        <div className="flex-1" />

        <button
          className="btn btn-ghost text-xs"
          onClick={() => { setShowProjectPicker(true); refreshProjects(); }}
        >
          Projects
        </button>

        <div className="w-px h-4" style={{ background: 'rgba(255,255,255,0.1)' }} />

        <button
          className="btn btn-ghost text-base px-2 py-1 disabled:opacity-25"
          disabled={!history.canUndo}
          onClick={history.undo}
          title="Undo (Cmd+Z)"
        >
          ↺
        </button>
        <button
          className="btn btn-ghost text-base px-2 py-1 disabled:opacity-25"
          disabled={!history.canRedo}
          onClick={history.redo}
          title="Redo (Shift+Cmd+Z)"
        >
          ↻
        </button>
      </div>

      {/* ── Main area ───────────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0">

        {/* Left: Media Bin */}
        <div
          className="flex-shrink-0 border-r panel flex flex-col"
          style={{ width: leftWidth, borderColor: 'rgba(255,255,255,0.07)' }}
        >
          <MediaBin assets={assets} onAssetsChange={refreshAssets} />
        </div>

        {/* Left resize handle */}
        <div
          className="resize-handle-h flex-shrink-0 transition-colors duration-100"
          style={{ width: 4, background: 'rgba(255,255,255,0.04)' }}
          onMouseDown={onLeftResize}
        />

        {/* Center: Preview + Transport + Timeline */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          {/* Project bar (global: master, beats, export) */}
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

          {/* Transport */}
          <TransportControls
            isPlaying={playback.isPlaying}
            currentTime={playback.currentTime}
            duration={playback.duration || project?.duration || 0}
            onToggle={playback.toggle}
            onSeek={playback.seek}
          />

          {/* Preview */}
          <Preview
            project={project}
            assets={assets}
            currentTime={playback.currentTime}
            isPlaying={playback.isPlaying}
            beatsData={beatsData}
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
              onSeek={playback.seek}
              onClipSelect={setSelectedClipId}
              onClipUpdate={(clipId, updates) => updateClip(clipId, updates)}
              onClipDelete={(clipId) => { deleteClip(clipId); setSelectedClipId(null); }}
              onSplit={(clipId, time) => splitClip(clipId, time)}
              onDropAsset={(trackId, assetId, start, dur) => addClip(trackId, assetId, start, dur)}
            />
          </div>
        </div>

        {/* Right resize handle */}
        <div
          className="resize-handle-h flex-shrink-0 transition-colors duration-100"
          style={{ width: 4, background: 'rgba(255,255,255,0.04)' }}
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
          />
        </div>
      </div>

      {/* ── Notifications ───────────────────────────────────────────────── */}
      {jobNotifications.length > 0 && (
        <div className="fixed bottom-5 right-5 space-y-2 z-50">
          {jobNotifications.map((msg, i) => (
            <div
              key={i}
              className="glass rounded-xl px-4 py-3 text-xs text-gray-200 shadow-panel flex items-center gap-2 toast-enter"
              style={{ minWidth: 220 }}
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
