import { useCallback, useEffect, useRef, useState } from 'react';
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

// Map assetId -> AudioBuffer (cached)
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
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const startAudioTimeRef = useRef<number>(0); // ctx.currentTime when play started
  const startProjectTimeRef = useRef<number>(0); // project time when play started
  const startWallTimeRef = useRef<number>(0);   // performance.now() (ms) when play started
  const rafRef = useRef<number>(0);
  const currentTimeRef = useRef(0);
  const isPlayingRef = useRef(false);
  const isLoopingRef = useRef(false);
  const projectRef = useRef<Project | null>(null);
  projectRef.current = project;
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

  // Load audio buffer for an asset
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

  // RAF loop: update currentTime state from wall-clock time
  const tick = useCallback(() => {
    if (!isPlayingRef.current) return;

    // Use performance.now() for reliable timing — AudioContext.currentTime can
    // stall if the context is suspended by the browser (e.g. autoplay policy).
    const wallElapsed = (performance.now() - startWallTimeRef.current) / 1000;
    const t = startProjectTimeRef.current + wallElapsed;

    currentTimeRef.current = t;
    setCurrentTime(t);

    // Auto-stop or loop at work area end (or duration if no work area)
    const stopAt = workAreaRef.current?.end ?? duration;
    const loopStart = workAreaRef.current?.start ?? 0;

    if (stopAt > 0 && t >= stopAt) {
      if (isLoopingRef.current) {
        // Restart audio from loop start using cached buffer
        const ctx = ctxRef.current;
        if (ctx) {
          sourceNodeRef.current?.stop();
          sourceNodeRef.current?.disconnect();
          sourceNodeRef.current = null;

          const masterTrack = projectRef.current?.tracks.find((tr) => tr.type === 'audio' && tr.isMaster);
          const masterClip = masterTrack?.clips[0];
          const buffer = masterClip ? audioCache.get(masterClip.assetId) : null;

          if (buffer && masterClip) {
            const source = ctx.createBufferSource();
            source.buffer = buffer;
            source.connect(ctx.destination);
            // Offset into audio = sourceStart + (loopStart - timelineStart)
            const audioOffset = Math.max(
              masterClip.sourceStart ?? 0,
              (masterClip.sourceStart ?? 0) + (loopStart - (masterClip.timelineStart ?? 0))
            );
            source.start(ctx.currentTime, audioOffset);
            sourceNodeRef.current = source;
          }

          startAudioTimeRef.current = ctx.currentTime;
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
      sourceNodeRef.current?.stop();
      return;
    }

    rafRef.current = requestAnimationFrame(tick);
  }, [duration]);

  const play = useCallback(async () => {
    if (isPlayingRef.current) return;

    const ctx = getCtx();
    if (ctx.state === 'suspended') await ctx.resume();

    // Find master audio track + asset
    const masterTrack = project?.tracks.find((t) => t.type === 'audio' && t.isMaster);
    const masterClip = masterTrack?.clips[0];
    const masterAsset = masterClip ? assets.find((a) => a.id === masterClip.assetId) : null;

    if (masterAsset) {
      const buffer = await loadAudio(masterAsset);
      if (buffer) {
        // Stop any existing source
        sourceNodeRef.current?.stop();
        sourceNodeRef.current?.disconnect();

        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);

        const clipTimelineStart = masterClip?.timelineStart ?? 0;
        const clipSourceStart = masterClip?.sourceStart ?? 0;
        const projectTime = currentTimeRef.current;

        if (projectTime >= clipTimelineStart) {
          // Already at or past the clip's timeline position: start immediately at the correct source offset
          const intoClip = projectTime - clipTimelineStart;
          const audioOffset = Math.min(clipSourceStart + intoClip, buffer.duration);
          source.start(ctx.currentTime, audioOffset);
        } else {
          // Before the clip starts: schedule audio to begin when the timeline reaches the clip
          const delay = clipTimelineStart - projectTime;
          source.start(ctx.currentTime + delay, clipSourceStart);
        }

        sourceNodeRef.current = source;
      }
    }

    startAudioTimeRef.current = ctx.currentTime;
    startWallTimeRef.current = performance.now();
    startProjectTimeRef.current = currentTimeRef.current;
    isPlayingRef.current = true;
    setIsPlaying(true);

    rafRef.current = requestAnimationFrame(tick);
  }, [project, assets, loadAudio, getCtx, tick]);

  const pause = useCallback(() => {
    if (!isPlayingRef.current) return;
    isPlayingRef.current = false;
    setIsPlaying(false);

    cancelAnimationFrame(rafRef.current);

    // Capture final position from wall clock before stopping
    const wallElapsed = (performance.now() - startWallTimeRef.current) / 1000;
    currentTimeRef.current = startProjectTimeRef.current + wallElapsed;
    setCurrentTime(currentTimeRef.current);

    sourceNodeRef.current?.stop();
    sourceNodeRef.current?.disconnect();
    sourceNodeRef.current = null;
  }, []);

  const seek = useCallback(
    (t: number) => {
      const wasp = isPlayingRef.current;
      if (wasp) pause();
      currentTimeRef.current = Math.max(0, Math.min(t, duration || 9999));
      setCurrentTime(currentTimeRef.current);
      if (wasp) {
        // Brief delay to allow state to settle
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
      // If at or past the work area end, restart from work area start
      const stopAt = workAreaRef.current?.end ?? duration;
      const restartFrom = workAreaRef.current?.start ?? 0;
      if (stopAt > 0 && currentTimeRef.current >= stopAt - 0.05) {
        currentTimeRef.current = restartFrom;
        setCurrentTime(restartFrom);
      }
      play();
    }
  }, [play, pause, duration]);

  // Preload audio when project/assets change
  useEffect(() => {
    if (!project) return;
    const masterTrack = project.tracks.find((t) => t.type === 'audio' && t.isMaster);
    const masterClip = masterTrack?.clips[0];
    const masterAsset = masterClip ? assets.find((a) => a.id === masterClip.assetId) : null;
    if (masterAsset) loadAudio(masterAsset).catch(console.warn);
  }, [project, assets, loadAudio]);

  // Update duration when project changes
  useEffect(() => {
    if (project) setDuration(project.duration);
  }, [project?.duration]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      sourceNodeRef.current?.stop();
      ctxRef.current?.close();
    };
  }, []);

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
