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
import { DockLayout } from './DockLayout';

// ─── Log line picker ─────────────────────────────────────────────────────────

function pickLogLine(lines: string[]): string | null {
  if (!lines || lines.length === 0) return null;
  for (let i = lines.length - 1; i >= 0; i--) {
    const raw = lines[i].trim();
    if (!raw) continue;
    const frameMatch = raw.match(/frame=\s*(\d+).*fps=\s*([\d.]+).*time=([\d:]+)/);
    if (frameMatch) return `frame ${frameMatch[1]} · ${frameMatch[2]} fps · ${frameMatch[3]}`;
    if (raw.length > 120) continue;
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
    addEffectTrack,
    updateEffectClipConfig,
    addClip,
    updateClip,
    deleteClip,
    splitClip,
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
    if (!project) return;
    const clip = findClip(clipId);
    if (!clip || !clip.effectConfig) return;

    // Find parent video track and get assets to process
    const effectTrack = project.tracks.find((t) => t.clips.some((c) => c.id === clipId));
    const parentTrack = effectTrack?.parentTrackId
      ? project.tracks.find((t) => t.id === effectTrack.parentTrackId)
      : undefined;
    const videoClips = parentTrack?.clips ?? [];
    const seenAssets = new Set<string>();
    const uniqueAssetIds = videoClips.map((c) => c.assetId).filter((id) => id && !seenAssets.has(id) && seenAssets.add(id));
    if (uniqueAssetIds.length === 0) {
      notify('No video clips found in parent track');
      return;
    }

    notify('Starting cutout processing...');
    updateEffectClipConfig(clipId, { maskStatus: 'processing' });
    try {
      const { jobId } = await api.startCutout(uniqueAssetIds[0]);
      api.pollJob(jobId, (j) => notify(`Cutout: ${j.progress}%`)).then(() => {
        updateEffectClipConfig(clipId, { maskStatus: 'done' });
        notify('Cutout done!');
        refreshAssets();
      }).catch((e) => {
        updateEffectClipConfig(clipId, { maskStatus: 'error' });
        notify(`Cutout failed: ${e.message}`);
      });
    } catch (e: any) {
      updateEffectClipConfig(clipId, { maskStatus: 'error' });
      notify(`Cutout error: ${e.message}`);
    }
  };

  const handleStartHeadStabilization = async (clipId: string) => {
    if (!project) return;
    const clip = findClip(clipId);
    if (!clip || !clip.effectConfig) return;

    // Find parent video track and get assets to process
    const effectTrack = project.tracks.find((t) => t.clips.some((c) => c.id === clipId));
    const parentTrack = effectTrack?.parentTrackId
      ? project.tracks.find((t) => t.id === effectTrack.parentTrackId)
      : undefined;
    const videoClips = parentTrack?.clips ?? [];
    const seenAssets = new Set<string>();
    const uniqueAssetIds = videoClips.map((c) => c.assetId).filter((id) => id && !seenAssets.has(id) && seenAssets.add(id));
    if (uniqueAssetIds.length === 0) {
      notify('No video clips found in parent track');
      return;
    }

    notify('Starting head stabilization...');
    updateEffectClipConfig(clipId, { stabilizationStatus: 'processing' });
    try {
      const { jobId } = await api.startHeadStabilization(uniqueAssetIds[0], {
        smoothingX: clip.effectConfig.smoothingX ?? 0.7,
        smoothingY: clip.effectConfig.smoothingY ?? 0.7,
        smoothingZ: clip.effectConfig.smoothingZ ?? 0.0,
      });
      api.pollJob(jobId, (j) => notify(`Head stabilization: ${j.progress}%`)).then(() => {
        updateEffectClipConfig(clipId, { stabilizationStatus: 'done' });
        notify('Head stabilization done!');
        refreshAssets();
      }).catch((e) => {
        updateEffectClipConfig(clipId, { stabilizationStatus: 'error' });
        notify(`Head stabilization failed: ${e.message}`);
      });
    } catch (e: any) {
      updateEffectClipConfig(clipId, { stabilizationStatus: 'error' });
      notify(`Head stabilization error: ${e.message}`);
    }
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
      const exportOpts = wa ? { startTime: wa.start, endTime: wa.end } : {};
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
          <div>
            <h1 className="text-3xl font-bold text-gradient">Video Editor</h1>
            <p className="text-sm mt-2" style={{ color: 'rgba(255,255,255,0.38)' }}>Craft your story, frame by frame</p>
          </div>

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

  // ── Panel renderers for DockLayout ─────────────────────────────────────────
  const panelRenderers = {
    media: () => (
      <MediaBin
        assets={assets}
        onAssetsChange={refreshAssets}
        onDragAsset={setDraggedAssetId}
      />
    ),

    'project-bar': () => (
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
    ),

    preview: () => (
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
    ),

    transport: () => (
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
    ),

    timeline: () => (
      <div style={{ flex: 1, overflowX: 'auto', overflowY: 'hidden', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
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
          onTrackReorder={(fromIdx, toIdx) => reorderTrack(fromIdx, toIdx)}
          onAddEffectTrack={(effectType, start, dur, parentTrackId) => {
            const clipId = addEffectTrack(effectType, start, dur, parentTrackId);
            setSelectedClipId(clipId);
          }}
        />
      </div>
    ),

    inspector: () => (
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', minHeight: 0 }}>
        <Inspector
          project={project}
          selectedClipId={selectedClipId}
          assets={assets}
          onClipUpdate={updateClip}
          onUpdateEffectClipConfig={updateEffectClipConfig}
          onUpdateProject={updateProject}
          masterAssetId={masterAssetId}
          onAlignLyrics={handleAlignLyrics}
          onStartCutout={handleStartCutout}
          onStartHeadStabilization={handleStartHeadStabilization}
          onExport={handleExport}
          onSyncAudio={masterAssetId ? handleSyncAudio : undefined}
        />
      </div>
    ),
  };

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

      {/* ── Main area (DockLayout fills all remaining space) ────────────── */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <DockLayout panelRenderers={panelRenderers} />
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
