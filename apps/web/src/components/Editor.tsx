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

  const beatsRef = useRef(beatsData);
  beatsRef.current = beatsData;

  // Playback
  const playback = usePlayback(project, assets, beatsData);

  // History
  const history = useHistory(project, setProject);

  // Load asset list
  const refreshAssets = useCallback(async () => {
    try {
      const { assets: list } = await api.listAssets();
      setAssets(list);

      // Load waveforms for assets that have them
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

  // Load projects list
  const refreshProjects = useCallback(async () => {
    try {
      const { projects: list } = await api.listProjects();
      setProjects(list);
    } catch (e) {
      console.warn('Failed to load projects', e);
    }
  }, []);

  // Keep stable ref to latest refreshAssets to avoid stale closure in interval
  const refreshAssetsRef = useRef(refreshAssets);
  useEffect(() => { refreshAssetsRef.current = refreshAssets; }, [refreshAssets]);

  useEffect(() => {
    refreshAssetsRef.current();
    refreshProjects();
    const iv = setInterval(() => refreshAssetsRef.current(), 3000);
    return () => clearInterval(iv);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keyboard shortcuts
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
        if (selectedClipId) {
          deleteClip(selectedClipId);
          setSelectedClipId(null);
        }
      } else if (e.code === 'KeyZ' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (e.shiftKey) history.redo();
        else history.undo();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [playback, selectedClipId, splitClip, deleteClip, history]);

  // Push history snapshot on project change
  useEffect(() => {
    if (project) history.pushSnapshot(project);
  }, [project]);

  // Notify progress
  const notify = (msg: string) => {
    setJobNotifications((prev) => [...prev.slice(-4), msg]);
    setTimeout(() => setJobNotifications((prev) => prev.filter((m) => m !== msg)), 5000);
  };

  // Master audio asset
  const masterTrack = project?.tracks.find((t) => t.type === 'audio' && t.isMaster);
  const masterClip = masterTrack?.clips[0];
  const masterAssetId = masterClip?.assetId;

  const handleAnalyzeBeats = async (assetId: string) => {
    notify('Starting beat analysis...');
    try {
      const { jobId } = await api.analyzeBeats(assetId);
      const job = await api.pollJob(jobId, (j) => notify(`Beats: ${j.progress}%`));
      const beats = await api.getBeats(assetId);
      setBeatsData((prev) => new Map(prev).set(assetId, beats));
      notify('Beat analysis done!');
    } catch (e: any) {
      notify(`Beat analysis failed: ${e.message}`);
    }
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
    } catch (e: any) {
      notify(`Lyrics alignment failed: ${e.message}`);
    }
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
    } catch (e: any) {
      notify(`Cutout error: ${e.message}`);
    }
  };

  const handleExport = async () => {
    if (!project) return;
    notify('Starting export...');
    try {
      const { jobId } = await api.exportProject(project.id);
      notify(`Export job started: ${jobId}`);
      api.pollJob(jobId, (j) => notify(`Export: ${j.progress}%`), 1000).then((job) => {
        notify('Export done! Downloading...');
        window.open(api.getJobOutputUrl(jobId), '_blank');
      }).catch((e) => {
        notify(`Export failed: ${e.message}`);
      });
    } catch (e: any) {
      notify(`Export error: ${e.message}`);
    }
  };

  // Project picker modal
  if (showProjectPicker) {
    return (
      <div className="h-screen flex items-center justify-center bg-surface">
        <div className="panel rounded-xl p-8 w-96 space-y-6">
          <h1 className="text-xl font-bold text-white">Video Editor</h1>

          <div className="space-y-2">
            <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider">New Project</p>
            <input
              type="text"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              placeholder="Project name"
              className="w-full"
            />
            <button
              className="btn btn-primary w-full"
              onClick={async () => {
                const p = await createProject(newProjectName);
                await refreshAssets();
                setShowProjectPicker(false);
              }}
            >
              Create Project
            </button>
          </div>

          {projects.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider">Recent</p>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {projects.map((p) => (
                  <button
                    key={p.id}
                    className="w-full text-left btn btn-ghost rounded p-2 border border-surface-border"
                    onClick={async () => {
                      await projectHook.loadProject(p.id);
                      await refreshAssets();
                      setShowProjectPicker(false);
                    }}
                  >
                    <div className="text-sm text-gray-200">{p.name}</div>
                    <div className="text-xs text-gray-600">{new Date(p.updatedAt).toLocaleDateString()}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center px-4 h-10 bg-surface-raised border-b border-surface-border flex-shrink-0 gap-4">
        <span className="font-semibold text-white text-sm">
          {project?.name ?? 'Video Editor'}
        </span>
        {saving && <span className="text-xs text-gray-500">Saving...</span>}

        <div className="flex-1" />

        <button
          className="text-xs text-gray-500 hover:text-gray-300"
          onClick={() => {
            setShowProjectPicker(true);
            refreshProjects();
          }}
        >
          Projects
        </button>

        {/* Undo/Redo */}
        <button
          className="text-xs text-gray-500 hover:text-gray-300 disabled:opacity-30"
          disabled={!history.canUndo}
          onClick={history.undo}
          title="Undo (Cmd+Z)"
        >
          ↺
        </button>
        <button
          className="text-xs text-gray-500 hover:text-gray-300 disabled:opacity-30"
          disabled={!history.canRedo}
          onClick={history.redo}
          title="Redo (Shift+Cmd+Z)"
        >
          ↻
        </button>
      </div>

      {/* Main area */}
      <div className="flex flex-1 min-h-0">
        {/* Left: Media Bin */}
        <div className="w-52 flex-shrink-0 border-r border-surface-border panel flex flex-col">
          <MediaBin
            assets={assets}
            onAssetsChange={refreshAssets}
          />
        </div>

        {/* Center: Preview + Transport + Timeline */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
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

          {/* Timeline */}
          <div className="flex-shrink-0 border-t border-surface-border overflow-x-auto">
            <Timeline
              project={project}
              currentTime={playback.currentTime}
              assets={assets}
              waveforms={waveforms}
              beatsData={beatsData}
              selectedClipId={selectedClipId}
              onSeek={playback.seek}
              onClipSelect={setSelectedClipId}
              onClipUpdate={(clipId, updates) => {
                updateClip(clipId, updates);
              }}
              onClipDelete={(clipId) => {
                deleteClip(clipId);
                setSelectedClipId(null);
              }}
              onSplit={(clipId, time) => splitClip(clipId, time)}
              onDropAsset={(trackId, assetId, start, dur) => {
                addClip(trackId, assetId, start, dur);
              }}
            />
          </div>
        </div>

        {/* Right: Inspector */}
        <div className="w-60 flex-shrink-0 border-l border-surface-border panel flex flex-col overflow-y-auto">
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
            onAnalyzeBeats={handleAnalyzeBeats}
            onAlignLyrics={handleAlignLyrics}
            onStartCutout={handleStartCutout}
            onExport={handleExport}
          />
        </div>
      </div>

      {/* Notifications */}
      {jobNotifications.length > 0 && (
        <div className="fixed bottom-4 right-4 space-y-2 z-50">
          {jobNotifications.map((msg, i) => (
            <div key={i} className="bg-surface-raised border border-surface-border rounded px-4 py-2 text-xs text-gray-200 shadow-lg">
              {msg}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
