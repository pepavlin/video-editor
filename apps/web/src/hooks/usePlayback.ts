import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Project, Asset, BeatsData } from '@video-editor/shared';

export interface PlaybackControls {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  isLooping: boolean;
  play: () => void;
  pause: () => void;
  seek: (t: number) => void;
  toggle: () => void;
  toggleLoop: () => void;
  setDuration: (d: number) => void;
  /** Returns the real-time playback position in seconds using performance.now(),
   *  bypassing React render latency for UI components that need smooth updates. */
  getTime: () => number;
}

// Map assetId -> AudioBuffer (cached across renders)
const audioCache = new Map<string, AudioBuffer>();

export function usePlayback(
  project: Project | null,
  assets: Asset[],
  beatsData: Map<string, BeatsData>,
  workArea?: { start: number; end: number } | null
): PlaybackControls {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isLooping, setIsLooping] = useState(false);

  const ctxRef = useRef<AudioContext | null>(null);
  // Master audio source node
  const masterNodeRef = useRef<AudioBufferSourceNode | null>(null);
  // Extra source nodes for video clips with useClipAudio
  const clipNodesRef = useRef<AudioBufferSourceNode[]>([]);

  const startWallTimeRef = useRef<number>(0);
  const startProjectTimeRef = useRef<number>(0);
  const rafRef = useRef<number>(0);
  const currentTimeRef = useRef(0);
  const isPlayingRef = useRef(false);
  const isLoopingRef = useRef(false);
  const projectRef = useRef<Project | null>(null);
  projectRef.current = project;
  const assetsRef = useRef<Asset[]>(assets);
  assetsRef.current = assets;
  const workAreaRef = useRef(workArea);
  workAreaRef.current = workArea;

  const getCtx = useCallback((): AudioContext => {
    if (!ctxRef.current || ctxRef.current.state === 'closed') {
      ctxRef.current = new AudioContext();
    }
    return ctxRef.current;
  }, []);

  /**
   * Returns the live playback position in seconds.
   * Uses performance.now() so it always advances and never stalls due to
   * AudioContext suspension or React render scheduling.
   */
  const getTime = useCallback((): number => {
    if (!isPlayingRef.current) return currentTimeRef.current;
    const wallElapsed = (performance.now() - startWallTimeRef.current) / 1000;
    return startProjectTimeRef.current + wallElapsed;
  }, []);

  // Load audio buffer for an asset (caches result)
  const loadAudio = useCallback(async (asset: Asset): Promise<AudioBuffer | null> => {
    if (!asset.audioPath) return null;
    if (audioCache.has(asset.id)) return audioCache.get(asset.id)!;

    try {
      const url = `/files/${asset.audioPath}`;
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      const ctx = getCtx();
      const buffer = await ctx.decodeAudioData(arrayBuffer);
      audioCache.set(asset.id, buffer);
      return buffer;
    } catch (e) {
      console.warn('Failed to load audio for asset', asset.id, e);
      return null;
    }
  }, [getCtx]);

  // Stop all audio nodes immediately
  const stopAllNodes = useCallback(() => {
    try { masterNodeRef.current?.stop(); } catch {}
    masterNodeRef.current?.disconnect();
    masterNodeRef.current = null;

    for (const node of clipNodesRef.current) {
      try { node.stop(); } catch {}
      node.disconnect();
    }
    clipNodesRef.current = [];
  }, []);

  /**
   * Start all audio from cached buffers at the given project time.
   * Must be called after buffers are pre-loaded into audioCache.
   */
  const startFromCache = useCallback((ctx: AudioContext, projectTime: number) => {
    const proj = projectRef.current;
    if (!proj) return;

    // ── Master audio track ──────────────────────────────────────────────────
    const masterTrack = proj.tracks.find((t) => t.type === 'audio' && t.isMaster);
    const masterClip = masterTrack?.clips[0];
    const masterBuffer = (masterClip && !masterTrack?.muted) ? audioCache.get(masterClip.assetId) : undefined;

    if (masterBuffer && masterClip) {
      const src = ctx.createBufferSource();
      src.buffer = masterBuffer;
      src.connect(ctx.destination);

      const tlStart = masterClip.timelineStart ?? 0;
      const srcStart = masterClip.sourceStart ?? 0;

      if (projectTime >= tlStart) {
        const offset = Math.min(srcStart + (projectTime - tlStart), masterBuffer.duration - 0.001);
        src.start(ctx.currentTime, Math.max(0, offset));
      } else {
        src.start(ctx.currentTime + (tlStart - projectTime), Math.max(0, srcStart));
      }

      masterNodeRef.current = src;
    }

    // ── Video clips with useClipAudio ───────────────────────────────────────
    const newClipNodes: AudioBufferSourceNode[] = [];

    for (const track of proj.tracks) {
      if (track.type !== 'video' || track.muted) continue;

      for (const clip of track.clips) {
        if (!clip.useClipAudio) continue;
        if (projectTime >= clip.timelineEnd) continue; // already past this clip

        const buf = audioCache.get(clip.assetId);
        if (!buf) continue;

        const srcStart = clip.sourceStart ?? 0;
        const srcEnd = Math.min(clip.sourceEnd ?? buf.duration, buf.duration);
        if (srcEnd <= srcStart) continue;

        const src = ctx.createBufferSource();
        src.buffer = buf;

        // Per-clip volume gain
        const gain = ctx.createGain();
        gain.gain.value = Math.max(0, clip.clipAudioVolume ?? 1);
        src.connect(gain);
        gain.connect(ctx.destination);

        if (projectTime >= clip.timelineStart) {
          // Already inside the clip
          const intoClip = projectTime - clip.timelineStart;
          const offset = Math.min(srcStart + intoClip, srcEnd - 0.001);
          const remaining = srcEnd - offset;
          if (remaining <= 0) continue;
          src.start(ctx.currentTime, Math.max(0, offset), remaining);
        } else {
          // Clip is in the future
          const delay = clip.timelineStart - projectTime;
          const audioDur = srcEnd - srcStart;
          if (audioDur <= 0) continue;
          src.start(ctx.currentTime + delay, Math.max(0, srcStart), audioDur);
        }

        newClipNodes.push(src);
      }
    }

    clipNodesRef.current = newClipNodes;
  }, []);

  // RAF loop: update currentTime state from wall-clock time
  const tick = useCallback(() => {
    if (!isPlayingRef.current) return;

    const wallElapsed = (performance.now() - startWallTimeRef.current) / 1000;
    const t = startProjectTimeRef.current + wallElapsed;

    currentTimeRef.current = t;
    setCurrentTime(t);

    // Auto-stop or loop at work area end (or duration if no work area)
    const stopAt = workAreaRef.current?.end ?? duration;
    const loopStart = workAreaRef.current?.start ?? 0;

    if (stopAt > 0 && t >= stopAt) {
      if (isLoopingRef.current) {
        // Restart all audio from loop start using cached buffers
        const ctx = ctxRef.current;
        stopAllNodes();

        if (ctx) {
          startFromCache(ctx, loopStart);
        }

        startWallTimeRef.current = performance.now();
        startProjectTimeRef.current = loopStart;
        currentTimeRef.current = loopStart;
        setCurrentTime(loopStart);

        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      isPlayingRef.current = false;
      setIsPlaying(false);
      currentTimeRef.current = stopAt;
      setCurrentTime(stopAt);
      stopAllNodes();
      return;
    }

    rafRef.current = requestAnimationFrame(tick);
  }, [duration, stopAllNodes, startFromCache]);

  const play = useCallback(async () => {
    if (isPlayingRef.current) return;

    const ctx = getCtx();
    if (ctx.state === 'suspended') await ctx.resume();

    const proj = project;
    if (!proj) return;

    // Pre-load all required audio buffers
    const loads: Promise<unknown>[] = [];

    // Master audio
    const masterTrack = proj.tracks.find((t) => t.type === 'audio' && t.isMaster);
    const masterClip = masterTrack?.clips[0];
    const masterAsset = masterClip ? assets.find((a) => a.id === masterClip.assetId) : null;
    if (masterAsset) loads.push(loadAudio(masterAsset));

    // Video clips with useClipAudio
    for (const track of proj.tracks) {
      if (track.type !== 'video') continue;
      for (const clip of track.clips) {
        if (!clip.useClipAudio) continue;
        const asset = assets.find((a) => a.id === clip.assetId);
        if (asset) loads.push(loadAudio(asset));
      }
    }

    await Promise.all(loads);

    // Stop any lingering nodes before starting new ones
    stopAllNodes();

    // Start all audio from current position
    startFromCache(ctx, currentTimeRef.current);

    startWallTimeRef.current = performance.now();
    startProjectTimeRef.current = currentTimeRef.current;
    isPlayingRef.current = true;
    setIsPlaying(true);

    rafRef.current = requestAnimationFrame(tick);
  }, [project, assets, loadAudio, getCtx, tick, stopAllNodes, startFromCache]);

  const pause = useCallback(() => {
    if (!isPlayingRef.current) return;
    isPlayingRef.current = false;
    setIsPlaying(false);

    cancelAnimationFrame(rafRef.current);

    // Capture final position from wall clock before stopping
    const wallElapsed = (performance.now() - startWallTimeRef.current) / 1000;
    currentTimeRef.current = startProjectTimeRef.current + wallElapsed;
    setCurrentTime(currentTimeRef.current);

    stopAllNodes();
  }, [stopAllNodes]);

  const seek = useCallback(
    (t: number) => {
      const wasp = isPlayingRef.current;
      if (wasp) pause();
      currentTimeRef.current = Math.max(0, Math.min(t, duration || 9999));
      setCurrentTime(currentTimeRef.current);
      if (wasp) {
        setTimeout(() => play(), 50);
      }
    },
    [pause, play, duration]
  );

  const toggleLoop = useCallback(() => {
    isLoopingRef.current = !isLoopingRef.current;
    setIsLooping(isLoopingRef.current);
  }, []);

  const toggle = useCallback(() => {
    if (isPlayingRef.current) {
      pause();
    } else {
      const stopAt = workAreaRef.current?.end ?? duration;
      const restartFrom = workAreaRef.current?.start ?? 0;
      if (
        (stopAt > 0 && currentTimeRef.current >= stopAt - 0.05) ||
        currentTimeRef.current < restartFrom
      ) {
        currentTimeRef.current = restartFrom;
        setCurrentTime(restartFrom);
      }
      play();
    }
  }, [play, pause, duration]);

  // Preload audio when project/assets change
  useEffect(() => {
    if (!project) return;

    // Master audio
    const masterTrack = project.tracks.find((t) => t.type === 'audio' && t.isMaster);
    const masterClip = masterTrack?.clips[0];
    const masterAsset = masterClip ? assets.find((a) => a.id === masterClip.assetId) : null;
    if (masterAsset) loadAudio(masterAsset).catch(console.warn);

    // Video clips with useClipAudio
    for (const track of project.tracks) {
      if (track.type !== 'video') continue;
      for (const clip of track.clips) {
        if (!clip.useClipAudio) continue;
        const asset = assets.find((a) => a.id === clip.assetId);
        if (asset) loadAudio(asset).catch(console.warn);
      }
    }
  }, [project, assets, loadAudio]);

  // Derive a compact signature of all audio-affecting project properties.
  // When this signature changes while playing, audio nodes are restarted immediately
  // so that mute toggles, useClipAudio changes, and volume changes are reflected live.
  const audioSignature = useMemo(() => {
    if (!project) return '';
    return project.tracks.map((t) =>
      `${t.id}:${t.muted}:` +
      t.clips.map((c) =>
        `${c.id}:${c.useClipAudio ?? false}:${c.clipAudioVolume ?? 1}`
      ).join(',')
    ).join('|');
  }, [project]);

  const prevAudioSignatureRef = useRef(audioSignature);

  useEffect(() => {
    // Skip on first render — audio is started by play() explicitly.
    if (audioSignature === prevAudioSignatureRef.current) return;
    prevAudioSignatureRef.current = audioSignature;

    if (!isPlayingRef.current) return;

    const ctx = ctxRef.current;
    if (!ctx) return;

    // Preload any newly required audio buffers (e.g. useClipAudio just enabled),
    // then restart all audio nodes from the current playback position.
    const proj = projectRef.current;
    const loads: Promise<unknown>[] = [];
    if (proj) {
      for (const track of proj.tracks) {
        if (track.type !== 'video' || track.muted) continue;
        for (const clip of track.clips) {
          if (!clip.useClipAudio) continue;
          const asset = assetsRef.current.find((a) => a.id === clip.assetId);
          if (asset && !audioCache.has(asset.id)) {
            loads.push(loadAudio(asset));
          }
        }
      }
    }

    Promise.all(loads).then(() => {
      if (!isPlayingRef.current) return;
      const activeCtx = ctxRef.current;
      if (!activeCtx) return;
      const currentT = getTime();
      stopAllNodes();
      startFromCache(activeCtx, currentT);
      // Re-anchor wall time so the RAF tick stays in sync
      startWallTimeRef.current = performance.now();
      startProjectTimeRef.current = currentT;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioSignature]);

  // Update duration when project changes
  useEffect(() => {
    if (project) setDuration(project.duration);
  }, [project?.duration]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      stopAllNodes();
      ctxRef.current?.close();
    };
  }, [stopAllNodes]);

  return {
    isPlaying,
    currentTime,
    duration,
    isLooping,
    play,
    pause,
    seek,
    toggle,
    toggleLoop,
    setDuration,
    getTime,
  };
}
