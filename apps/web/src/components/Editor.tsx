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
import ToolsPanel from './ToolsPanel';
import { DockLayout } from './DockLayout';
import { MobileLayout } from './MobileLayout';
import { useThemeContext } from '@/contexts/ThemeContext';

// ─── Responsive breakpoint ────────────────────────────────────────────────────

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1199px)');
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return isMobile;
}

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
  const isMobile = useIsMobile();
  const { isDark, toggleTheme } = useThemeContext();
  const projectHook = useProject();
  const {
    project,
    setProject,
    saving,
    createProject,
    updateProject,
    addTrack,
    addTextTrack,
    addLyricsTrack,
    addEffectTrack,
    updateEffectClipConfig,
    addClip,
    updateClip,
    deleteClip,
    splitClip,
    findClip,
    reorderTrack,
    moveClipToTrack,
    moveClipToNewTrack,
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
        const count = p.tracks.filter((t) => t.type === assetType || (assetType === 'video' && t.type === 'text')).length;
        const baseName = assetType === 'audio' ? 'Audio' : 'Video';
        const name = count === 0 ? baseName : `${baseName} ${count + 1}`;
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

  const handleAlignLyricsClip = async (clipId: string, text: string) => {
    if (!project) return;
    notify('Starting lyrics alignment...');
    try {
      const { jobId } = await api.alignLyricsClip(project.id, clipId, text, masterAssetId);
      await api.pollJob(jobId, (j) => notify(`Lyrics: ${j.progress}%`));
      // Reload project to get updated lyricsWords on the clip
      const { project: updated } = await api.loadProject(project.id);
      setProject(updated);
      notify('Lyrics aligned!');
    } catch (e: any) { notify(`Lyrics alignment failed: ${e.message}`); }
  };

  const handleStartCutout = async (clipId: string) => {
    if (!project) return;
    const clip = findClip(clipId);
    if (!clip || !clip.effectConfig) return;

    // Find parent video track and get assets to process.
    // Prefer the linked parentTrackId, but fall back to any video track with clips
    // (handles the case where parentTrackId points to the default empty video track).
    const effectTrack = project.tracks.find((t) => t.clips.some((c) => c.id === clipId));
    const linkedParent = effectTrack?.parentTrackId
      ? project.tracks.find((t) => t.id === effectTrack.parentTrackId)
      : null;
    const parentTrack =
      (linkedParent && linkedParent.clips.some((c) => c.assetId))
        ? linkedParent
        : project.tracks.find((t) => t.type === 'video' && t.clips.some((c) => c.assetId))
          ?? project.tracks.find((t) => t.type === 'video');
    const videoClips = parentTrack?.clips ?? [];
    const seenAssets = new Set<string>();
    const uniqueAssetIds = videoClips.map((c) => c.assetId).filter((id) => id && !seenAssets.has(id) && seenAssets.add(id));
    if (uniqueAssetIds.length === 0) {
      notify('No video clips found in parent track');
      return;
    }

    const cutoutMode = (clip.effectConfig.cutoutMode ?? 'removeBg') as 'removeBg' | 'removePerson';
    notify('Starting cutout processing...');
    updateEffectClipConfig(clipId, { maskStatus: 'processing' });
    try {
      const { jobId } = await api.startCutout(uniqueAssetIds[0], cutoutMode);
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

    // Find parent video track and get assets to process.
    // Prefer the linked parentTrackId, but fall back to any video track with clips
    // (handles the case where parentTrackId points to the default empty video track).
    const effectTrack = project.tracks.find((t) => t.clips.some((c) => c.id === clipId));
    const linkedParent = effectTrack?.parentTrackId
      ? project.tracks.find((t) => t.id === effectTrack.parentTrackId)
      : null;
    const parentTrack =
      (linkedParent && linkedParent.clips.some((c) => c.assetId))
        ? linkedParent
        : project.tracks.find((t) => t.type === 'video' && t.clips.some((c) => c.assetId))
          ?? project.tracks.find((t) => t.type === 'video');
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
      <div className="h-screen flex items-center justify-center px-4" style={{ background: 'var(--surface-bg)', position: 'relative', overflow: 'hidden' }}>
        {/* Subtle grid pattern */}
        <div style={{
          position: 'absolute', inset: 0,
          backgroundImage: `radial-gradient(circle, ${isDark ? 'rgba(226,232,240,0.05)' : 'rgba(15,23,42,0.05)'} 1px, transparent 1px)`,
          backgroundSize: '40px 40px',
          pointerEvents: 'none',
          animation: 'fadeIn 1.2s ease forwards',
        }} />

        {/* Theme toggle — top right */}
        <button
          className="theme-toggle-btn"
          onClick={toggleTheme}
          title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          style={{
            position: 'absolute', top: 16, right: 16,
            width: 36, height: 36, borderRadius: 10,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--surface-hover)',
            border: '1px solid var(--border-subtle)',
            cursor: 'pointer',
            color: 'var(--text-secondary)',
            transition: 'all 0.2s ease',
          }}
        >
          <span className="theme-toggle-icon" style={{ fontSize: 16, lineHeight: 1 }}>
            {isDark ? '☀' : '◑'}
          </span>
        </button>

        <div
          className="glass rounded-2xl w-full shadow-panel scale-in"
          style={{ maxWidth: 480, padding: isMobile ? '28px 20px' : '40px 40px 44px', position: 'relative', overflow: 'hidden' }}
        >
          {/* Card inner glow accent */}
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, height: 2,
            background: 'linear-gradient(90deg, transparent, rgba(13,148,136,0.40), rgba(14,165,233,0.35), transparent)',
            borderRadius: '16px 16px 0 0',
          }} />

          {/* Header */}
          <div className="stagger-item" style={{ animationDelay: '0.05s', marginBottom: 32 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
              {/* Animated logo mark */}
              <div style={{
                width: 36, height: 36,
                background: 'linear-gradient(135deg, rgba(13,148,136,0.12), rgba(14,165,233,0.12))',
                border: '1px solid rgba(13,148,136,0.22)',
                borderRadius: 10,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                animation: 'breathe 3s ease-in-out infinite',
                flexShrink: 0,
              }}>
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <polygon points="5,3 15,9 5,15" fill="url(#logoGrad)" />
                  <defs>
                    <linearGradient id="logoGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#0d9488" />
                      <stop offset="100%" stopColor="#0ea5e9" />
                    </linearGradient>
                  </defs>
                </svg>
              </div>
              <h1 className="text-3xl font-bold text-gradient">Video Editor</h1>
            </div>
            <p className="text-sm" style={{ color: 'var(--text-muted)', paddingLeft: 48 }}>Craft your story, frame by frame</p>
          </div>

          {/* New project */}
          <div className="stagger-item" style={{ animationDelay: '0.12s', marginBottom: 28 }}>
            <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'rgba(13,148,136,0.75)', letterSpacing: '0.12em', marginBottom: 12 }}>New Project</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
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
          </div>

          {projects.length > 0 && (
            <div className="stagger-item" style={{ animationDelay: '0.2s' }}>
              {/* Divider */}
              <div style={{
                height: 1,
                background: `linear-gradient(90deg, transparent, var(--border-default), transparent)`,
                marginBottom: 20,
              }} />
              <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'rgba(13,148,136,0.75)', letterSpacing: '0.12em', marginBottom: 12 }}>Recent</p>
              <div className="space-y-2 max-h-56 overflow-y-auto" style={{ paddingRight: 2 }}>
                {projects.map((p, idx) => (
                  <button
                    key={p.id}
                    className="w-full text-left rounded-xl stagger-item"
                    style={{
                      padding: '12px 14px',
                      background: 'var(--surface-overlay)',
                      border: '1px solid var(--border-subtle)',
                      transition: 'all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)',
                      animationDelay: `${0.24 + idx * 0.06}s`,
                    }}
                    onMouseEnter={(e) => {
                      const el = e.currentTarget as HTMLElement;
                      el.style.background = 'rgba(13,148,136,0.08)';
                      el.style.borderColor = 'rgba(13,148,136,0.22)';
                      el.style.transform = 'translateX(3px)';
                      el.style.boxShadow = '0 2px 8px rgba(15,23,42,0.06)';
                    }}
                    onMouseLeave={(e) => {
                      const el = e.currentTarget as HTMLElement;
                      el.style.background = 'var(--surface-overlay)';
                      el.style.borderColor = 'var(--border-subtle)';
                      el.style.transform = '';
                      el.style.boxShadow = '';
                    }}
                    onMouseDown={(e) => {
                      (e.currentTarget as HTMLElement).style.transform = 'scale(0.98)';
                    }}
                    onMouseUp={(e) => {
                      (e.currentTarget as HTMLElement).style.transform = 'translateX(3px)';
                    }}
                    onClick={async () => {
                      await projectHook.loadProject(p.id);
                      setUrlProject(p.id);
                      await refreshAssets();
                      setShowProjectPicker(false);
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{p.name}</div>
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ opacity: 0.35, flexShrink: 0, color: 'var(--text-primary)' }}>
                        <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--text-subtle)' }}>{new Date(p.updatedAt).toLocaleDateString()}</div>
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
        onAddToTimeline={isMobile ? (assetId, assetType, duration) => {
          handleDropAssetNewTrack(assetType as 'video' | 'audio', assetId, 0, duration);
        } : undefined}
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
        isMobile={isMobile}
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
        isMobile={isMobile}
      />
    ),

    timeline: () => (
      <div style={{ flex: 1, overflow: 'hidden', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
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
          onMoveClipToTrack={(clipId, toTrackId, start, end) => moveClipToTrack(clipId, toTrackId, start, end)}
          onMoveClipToNewTrack={(clipId, newTrackType, start, end) => moveClipToNewTrack(clipId, newTrackType, start, end)}
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
          onAlignLyricsClip={handleAlignLyricsClip}
          onStartCutout={handleStartCutout}
          onStartHeadStabilization={handleStartHeadStabilization}
          onSyncAudio={masterAssetId ? handleSyncAudio : undefined}
        />
      </div>
    ),

    tools: () => (
      <ToolsPanel
        project={project}
        currentTime={playback.currentTime}
        onAddText={(start, duration, text) => {
          const clipId = addTextTrack(start, duration, text);
          setSelectedClipId(clipId);
        }}
        onAddLyrics={(start, duration) => {
          const clipId = addLyricsTrack(start, duration);
          setSelectedClipId(clipId);
        }}
      />
    ),
  };

  // ── Main editor layout ─────────────────────────────────────────────────────
  return (
    <div className="flex flex-col overflow-hidden" style={{ height: '100dvh' }}>

      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <div
        className="flex items-center flex-shrink-0 gap-2 border-b animate-slide-down"
        style={{
          height: isMobile ? 48 : 56,
          padding: isMobile ? '0 12px' : '0 20px',
          gap: isMobile ? 8 : 16,
          background: 'var(--surface-topbar)',
          backdropFilter: 'blur(20px)',
          borderColor: 'var(--border-subtle)',
          boxShadow: isDark
            ? '0 1px 3px rgba(0,0,0,0.20), 0 2px 8px rgba(0,0,0,0.15)'
            : '0 1px 3px rgba(15,23,42,0.06), 0 2px 8px rgba(15,23,42,0.04)',
        }}
      >
        {/* Logo mark + title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 24, height: 24,
            background: 'linear-gradient(135deg, rgba(13,148,136,0.12), rgba(14,165,233,0.12))',
            border: '1px solid rgba(13,148,136,0.22)',
            borderRadius: 6,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
              <polygon points="3,2 9,5.5 3,9" fill="url(#topLogoGrad)" />
              <defs>
                <linearGradient id="topLogoGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#0d9488" />
                  <stop offset="100%" stopColor="#0ea5e9" />
                </linearGradient>
              </defs>
            </svg>
          </div>
          <span className="font-bold text-gradient" style={{ fontSize: isMobile ? 14 : 15 }}>
            {project?.name ?? 'Video Editor'}
          </span>
        </div>

        {project && (
          <span
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1 transition-all"
            style={{
              fontSize: 12,
              color: saving ? 'var(--text-muted)' : '#0d9488',
              background: saving ? 'var(--surface-hover)' : 'rgba(13,148,136,0.08)',
              border: `1px solid ${saving ? 'var(--border-subtle)' : 'rgba(13,148,136,0.22)'}`,
              letterSpacing: '0.01em',
              transition: 'all 0.35s cubic-bezier(0.4,0,0.2,1)',
              boxShadow: saving ? 'none' : '0 0 8px rgba(13,148,136,0.10)',
            }}
          >
            {saving ? (
              <>
                {/* Three pulsing dots */}
                <span style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      style={{
                        display: 'inline-block', width: 3, height: 3,
                        borderRadius: '50%',
                        background: 'rgba(15,23,42,0.35)',
                        animation: `dotBlink 1.2s ease-in-out infinite`,
                        animationDelay: `${i * 0.2}s`,
                      }}
                    />
                  ))}
                </span>
                {!isMobile && 'Ukládání...'}
              </>
            ) : (
              <>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ overflow: 'visible' }}>
                  <path
                    d="M1.5 5L4 7.5L8.5 2.5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeDasharray="20"
                    strokeDashoffset="0"
                    style={{ animation: 'saveCheck 0.4s ease forwards' }}
                  />
                </svg>
                {!isMobile && 'Uloženo'}
              </>
            )}
          </span>
        )}

        <div className="flex-1" />

        {/* Theme toggle */}
        <button
          className="theme-toggle-btn"
          onClick={toggleTheme}
          title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          style={{
            width: isMobile ? 32 : 34,
            height: isMobile ? 32 : 34,
            borderRadius: 8,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--surface-hover)',
            border: '1px solid var(--border-subtle)',
            cursor: 'pointer',
            color: 'var(--text-secondary)',
            flexShrink: 0,
            transition: 'all 0.2s ease',
          }}
        >
          <span className="theme-toggle-icon" style={{ fontSize: 14, lineHeight: 1 }}>
            {isDark ? '☀' : '◑'}
          </span>
        </button>

        {/* Projects button — always visible */}
        <button
          className="btn btn-ghost"
          style={{ fontSize: isMobile ? 12 : 13, padding: isMobile ? '4px 8px' : undefined }}
          onClick={() => { setShowProjectPicker(true); refreshProjects(); }}
        >
          Projects
        </button>

        {/* Undo/Redo — hidden on mobile */}
        {!isMobile && (
          <>
            <div className="w-px h-5" style={{ background: 'var(--border-default)' }} />
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
          </>
        )}

        {/* Mobile: undo/redo icons */}
        {isMobile && (
          <>
            <button
              style={{
                width: 34, height: 34, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 18, color: history.canUndo ? 'var(--text-secondary)' : 'var(--text-muted)',
                touchAction: 'manipulation',
                WebkitTapHighlightColor: 'transparent',
              } as React.CSSProperties}
              disabled={!history.canUndo}
              onClick={history.undo}
              title="Undo"
            >↺</button>
            <button
              style={{
                width: 34, height: 34, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 18, color: history.canRedo ? 'var(--text-secondary)' : 'var(--text-muted)',
                touchAction: 'manipulation',
                WebkitTapHighlightColor: 'transparent',
              } as React.CSSProperties}
              disabled={!history.canRedo}
              onClick={history.redo}
              title="Redo"
            >↻</button>
          </>
        )}
      </div>

      {/* ── Main area ───────────────────────────────────────────────────── */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {isMobile
          ? <MobileLayout panelRenderers={panelRenderers} />
          : <DockLayout panelRenderers={panelRenderers} />
        }
      </div>

      {/* ── Notifications ───────────────────────────────────────────────── */}
      {jobNotifications.length > 0 && (
        <div
          className="fixed right-3 space-y-2 z-50"
          style={{ bottom: isMobile ? 'calc(68px + env(safe-area-inset-bottom, 0px) + 8px)' : '20px', pointerEvents: 'none' }}
        >
          {jobNotifications.map((msg, i) => (
            <div
              key={i}
              className="glass rounded-xl shadow-panel toast-enter"
              style={{
                minWidth: isMobile ? 'min(220px, calc(100vw - 24px))' : 296,
                color: 'var(--text-primary)',
                fontSize: 13,
                padding: '12px 16px',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                borderLeft: '2px solid rgba(13,148,136,0.50)',
                pointerEvents: 'auto',
              }}
            >
              {/* Animated indicator */}
              <span style={{ position: 'relative', flexShrink: 0 }}>
                <span
                  style={{
                    display: 'inline-block',
                    width: 8, height: 8,
                    borderRadius: '50%',
                    background: 'linear-gradient(135deg, #0d9488, #0ea5e9)',
                  }}
                />
                <span
                  style={{
                    position: 'absolute',
                    inset: -3,
                    borderRadius: '50%',
                    border: '1.5px solid rgba(13,148,136,0.5)',
                    animation: 'ripple 1.6s ease-out infinite',
                  }}
                />
              </span>
              <span style={{ flex: 1 }}>{msg}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
