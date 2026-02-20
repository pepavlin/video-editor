'use client';

import { useRef, useCallback, useEffect, useState, useMemo } from 'react';
import type { Project, Track, Clip, Asset, WaveformData, BeatsData } from '@video-editor/shared';
import { getClipColor, clamp, snap, formatTime } from '@/lib/utils';

const TRACK_HEIGHT = 56;
const HEADER_WIDTH = 80;
const RULER_HEIGHT = 24;
const MIN_ZOOM = 20;   // px per second
const MAX_ZOOM = 400;
const SNAP_THRESHOLD_PX = 8;

interface Props {
  project: Project | null;
  currentTime: number;
  assets: Asset[];
  waveforms: Map<string, WaveformData>;
  beatsData: Map<string, BeatsData>;
  selectedClipId: string | null;
  onSeek: (t: number) => void;
  onClipSelect: (clipId: string | null) => void;
  onClipUpdate: (clipId: string, updates: Partial<Clip>) => void;
  onClipDelete: (clipId: string) => void;
  onSplit: (clipId: string, time: number) => void;
  onDropAsset: (trackId: string, assetId: string, timelineStart: number, duration: number) => void;
}

type DragMode =
  | { type: 'none' }
  | { type: 'seek' }
  | { type: 'moveClip'; clipId: string; trackId: string; offsetSeconds: number }
  | { type: 'trimLeft'; clipId: string }
  | { type: 'trimRight'; clipId: string };

export default function Timeline({
  project,
  currentTime,
  assets,
  waveforms,
  beatsData,
  selectedClipId,
  onSeek,
  onClipSelect,
  onClipUpdate,
  onClipDelete,
  onSplit,
  onDropAsset,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const [zoom, setZoom] = useState(80); // px/second
  const [scrollLeft, setScrollLeft] = useState(0);
  const [drag, setDrag] = useState<DragMode>({ type: 'none' });
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const dragRef = useRef<DragMode>({ type: 'none' });
  dragRef.current = drag;

  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  const scrollLeftRef = useRef(scrollLeft);
  scrollLeftRef.current = scrollLeft;

  const propsRef = useRef({ project, currentTime, assets, waveforms, beatsData, selectedClipId });
  useEffect(() => {
    propsRef.current = { project, currentTime, assets, waveforms, beatsData, selectedClipId };
  });

  // Get snap targets from clip edges + beat markers
  const getSnapTargets = useCallback(
    (excludeClipId?: string): number[] => {
      const targets: number[] = [0];
      if (!project) return targets;
      for (const track of project.tracks) {
        for (const clip of track.clips) {
          if (clip.id === excludeClipId) continue;
          targets.push(clip.timelineStart, clip.timelineEnd);
        }
      }
      // Add beats if available
      const masterTrack = project.tracks.find((t) => t.type === 'audio' && t.isMaster);
      const masterClip = masterTrack?.clips[0];
      if (masterClip) {
        const beats = beatsData.get(masterClip.assetId);
        if (beats) targets.push(...beats.beats);
      }
      return targets;
    },
    [project, beatsData]
  );

  const pxToTime = useCallback((px: number) => (px + scrollLeftRef.current) / zoomRef.current, []);
  const timeToPx = useCallback((t: number) => t * zoomRef.current - scrollLeftRef.current, []);

  // ─── Drawing ─────────────────────────────────────────────────────────────────

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { project, currentTime, waveforms, beatsData, selectedClipId } = propsRef.current;
    const W = canvas.width;
    const H = canvas.height;
    const Z = zoomRef.current;
    const SL = scrollLeftRef.current;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#161616';
    ctx.fillRect(0, 0, W, H);

    if (!project) {
      ctx.fillStyle = '#333';
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Create or load a project', W / 2, H / 2);
      return;
    }

    const timeWidth = W - HEADER_WIDTH;
    const tracks = project.tracks;

    // ─── Ruler ────────────────────────────────────────────────────────────────
    ctx.fillStyle = '#1e1e1e';
    ctx.fillRect(HEADER_WIDTH, 0, timeWidth, RULER_HEIGHT);

    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;

    // Determine tick interval
    const secondsVisible = timeWidth / Z;
    let tickInterval = 1;
    if (secondsVisible > 100) tickInterval = 10;
    else if (secondsVisible > 40) tickInterval = 5;
    else if (secondsVisible > 20) tickInterval = 2;

    const startSec = Math.floor(SL / Z / tickInterval) * tickInterval;
    const endSec = Math.ceil((SL + timeWidth) / Z / tickInterval) * tickInterval;

    ctx.font = '10px sans-serif';
    ctx.fillStyle = '#555';
    ctx.textAlign = 'left';

    for (let s = startSec; s <= endSec; s += tickInterval) {
      const x = s * Z - SL + HEADER_WIDTH;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, RULER_HEIGHT);
      ctx.strokeStyle = '#333';
      ctx.stroke();
      ctx.fillText(formatTime(s), x + 3, RULER_HEIGHT - 4);
    }

    // Subticks
    const subInterval = tickInterval / 5;
    for (let s = startSec; s <= endSec; s += subInterval) {
      const x = s * Z - SL + HEADER_WIDTH;
      if (s % tickInterval === 0) continue;
      ctx.beginPath();
      ctx.moveTo(x, RULER_HEIGHT - 6);
      ctx.lineTo(x, RULER_HEIGHT);
      ctx.strokeStyle = '#2a2a2a';
      ctx.stroke();
    }

    // ─── Beat markers on ruler ─────────────────────────────────────────────────
    const masterTrack = project.tracks.find((t) => t.type === 'audio' && t.isMaster);
    const masterClip = masterTrack?.clips[0];
    if (masterClip) {
      const beats = beatsData.get(masterClip.assetId);
      if (beats) {
        ctx.fillStyle = 'rgba(108, 99, 255, 0.5)';
        for (const beat of beats.beats) {
          const x = beat * Z - SL + HEADER_WIDTH;
          if (x < HEADER_WIDTH || x > W) continue;
          ctx.fillRect(x - 0.5, 0, 1, RULER_HEIGHT);
        }
      }
    }

    // ─── Tracks ───────────────────────────────────────────────────────────────
    let trackY = RULER_HEIGHT;
    for (const track of tracks) {
      const isAudio = track.type === 'audio';

      // Track header
      ctx.fillStyle = '#1e1e1e';
      ctx.fillRect(0, trackY, HEADER_WIDTH, TRACK_HEIGHT);
      ctx.strokeStyle = '#2a2a2a';
      ctx.strokeRect(0, trackY, HEADER_WIDTH, TRACK_HEIGHT);

      ctx.fillStyle = '#888';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(track.name, HEADER_WIDTH / 2, trackY + TRACK_HEIGHT / 2 + 4);

      // Track body background
      ctx.fillStyle = trackY % (TRACK_HEIGHT * 2) === RULER_HEIGHT % (TRACK_HEIGHT * 2) ? '#1a1a1a' : '#181818';
      ctx.fillRect(HEADER_WIDTH, trackY, timeWidth, TRACK_HEIGHT);

      // Grid lines
      for (let s = startSec; s <= endSec; s += tickInterval) {
        const x = s * Z - SL + HEADER_WIDTH;
        ctx.strokeStyle = '#222';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, trackY);
        ctx.lineTo(x, trackY + TRACK_HEIGHT);
        ctx.stroke();
      }

      // Beat markers on tracks
      if (masterClip) {
        const beats = beatsData.get(masterClip.assetId);
        if (beats) {
          ctx.fillStyle = 'rgba(108, 99, 255, 0.15)';
          for (const beat of beats.beats) {
            const x = beat * Z - SL + HEADER_WIDTH;
            if (x < HEADER_WIDTH || x > W) continue;
            ctx.fillRect(x - 0.5, trackY, 1, TRACK_HEIGHT);
          }
        }
      }

      // Waveform for master audio track
      if (isAudio && track.isMaster && masterClip) {
        const wf = waveforms.get(masterClip.assetId);
        if (wf && wf.samples.length > 0) {
          drawWaveform(ctx, wf, masterClip, Z, SL, trackY, TRACK_HEIGHT, HEADER_WIDTH, W);
        }
      }

      // Clips
      for (const clip of track.clips) {
        const clipX = clip.timelineStart * Z - SL + HEADER_WIDTH;
        const clipW = (clip.timelineEnd - clip.timelineStart) * Z;
        if (clipX + clipW < HEADER_WIDTH || clipX > W) {
          trackY += 0;
          continue;
        }

        const isSelected = clip.id === selectedClipId;
        const color = getClipColor(clip.assetId);

        // Clip body
        ctx.fillStyle = isSelected
          ? lightenColor(color, 20)
          : color;
        ctx.globalAlpha = 0.9;
        ctx.fillRect(
          Math.max(clipX, HEADER_WIDTH),
          trackY + 2,
          Math.min(clipW, W - Math.max(clipX, HEADER_WIDTH)),
          TRACK_HEIGHT - 4
        );
        ctx.globalAlpha = 1;

        // Clip border
        ctx.strokeStyle = isSelected ? '#fff' : lightenColor(color, 40);
        ctx.lineWidth = isSelected ? 2 : 1;
        ctx.strokeRect(
          Math.max(clipX, HEADER_WIDTH) + 0.5,
          trackY + 2.5,
          Math.min(clipW, W - Math.max(clipX, HEADER_WIDTH)) - 1,
          TRACK_HEIGHT - 5
        );

        // Clip name
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'left';
        const asset = propsRef.current.assets.find((a) => a.id === clip.assetId);
        const label = asset?.name ?? clip.assetId;
        const visX = Math.max(clipX, HEADER_WIDTH) + 4;
        const visW = Math.min(clipX + clipW, W) - visX - 4;
        ctx.save();
        ctx.beginPath();
        ctx.rect(Math.max(clipX, HEADER_WIDTH), trackY, Math.min(clipW, W - HEADER_WIDTH), TRACK_HEIGHT);
        ctx.clip();
        ctx.fillText(label, visX, trackY + 16);

        // Effects badges
        if (clip.effects.length > 0) {
          ctx.fillStyle = 'rgba(255,220,0,0.8)';
          ctx.font = '9px sans-serif';
          ctx.fillText(clip.effects.map((e) => e.type === 'beatZoom' ? 'BZ' : 'CUT').join(' '), visX, trackY + TRACK_HEIGHT - 8);
        }

        ctx.restore();

        // Trim handles
        if (isSelected) {
          ctx.fillStyle = '#fff';
          ctx.fillRect(Math.max(clipX, HEADER_WIDTH), trackY + 2, 4, TRACK_HEIGHT - 4);
          ctx.fillRect(Math.min(clipX + clipW, W) - 4, trackY + 2, 4, TRACK_HEIGHT - 4);
        }
      }

      trackY += TRACK_HEIGHT;
    }

    // ─── Playhead ─────────────────────────────────────────────────────────────
    const playX = currentTime * Z - SL + HEADER_WIDTH;
    if (playX >= HEADER_WIDTH && playX <= W) {
      ctx.strokeStyle = '#ff4444';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(playX, 0);
      ctx.lineTo(playX, H);
      ctx.stroke();

      // Playhead triangle
      ctx.fillStyle = '#ff4444';
      ctx.beginPath();
      ctx.moveTo(playX - 6, 0);
      ctx.lineTo(playX + 6, 0);
      ctx.lineTo(playX, 10);
      ctx.closePath();
      ctx.fill();
    }
  }, []);

  // Resize canvas
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const ro = new ResizeObserver(() => {
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
      draw();
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [draw]);

  // Redraw on any change
  useEffect(() => { draw(); });

  // ─── Mouse interactions ───────────────────────────────────────────────────

  const getClipAtPosition = useCallback(
    (x: number, y: number): { clip: Clip; track: Track } | null => {
      if (!project) return null;
      const Z = zoomRef.current;
      const SL = scrollLeftRef.current;

      let trackY = RULER_HEIGHT;
      for (const track of project.tracks) {
        if (y >= trackY && y < trackY + TRACK_HEIGHT) {
          const t = (x + SL - HEADER_WIDTH) / Z;
          for (const clip of track.clips) {
            if (t >= clip.timelineStart && t <= clip.timelineEnd) {
              return { clip, track };
            }
          }
        }
        trackY += TRACK_HEIGHT;
      }
      return null;
    },
    [project]
  );

  const getTrackAtY = useCallback(
    (y: number): Track | null => {
      if (!project) return null;
      let trackY = RULER_HEIGHT;
      for (const track of project.tracks) {
        if (y >= trackY && y < trackY + TRACK_HEIGHT) return track;
        trackY += TRACK_HEIGHT;
      }
      return null;
    },
    [project]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = canvasRef.current!.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const Z = zoomRef.current;
      const SL = scrollLeftRef.current;

      if (y < RULER_HEIGHT) {
        // Click on ruler = seek
        const t = (x + SL - HEADER_WIDTH) / Z;
        onSeek(Math.max(0, t));
        setDrag({ type: 'seek' });
        return;
      }

      if (x < HEADER_WIDTH) return;

      const hit = getClipAtPosition(x, y);
      if (!hit) {
        onClipSelect(null);
        return;
      }

      const { clip, track } = hit;
      onClipSelect(clip.id);

      const clipXStart = clip.timelineStart * Z - SL + HEADER_WIDTH;
      const clipXEnd = clip.timelineEnd * Z - SL + HEADER_WIDTH;

      const HANDLE = 8;
      if (x < clipXStart + HANDLE) {
        setDrag({ type: 'trimLeft', clipId: clip.id });
      } else if (x > clipXEnd - HANDLE) {
        setDrag({ type: 'trimRight', clipId: clip.id });
      } else {
        const offsetSeconds = (x + SL - HEADER_WIDTH) / Z - clip.timelineStart;
        setDrag({ type: 'moveClip', clipId: clip.id, trackId: track.id, offsetSeconds });
      }
    },
    [getClipAtPosition, onClipSelect, onSeek]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!project) return;
      const rect = canvasRef.current!.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const Z = zoomRef.current;
      const SL = scrollLeftRef.current;
      const d = dragRef.current;

      if (d.type === 'seek') {
        const t = Math.max(0, (x + SL - HEADER_WIDTH) / Z);
        onSeek(t);
        return;
      }

      if (d.type === 'moveClip') {
        let t = (x + SL - HEADER_WIDTH) / Z - d.offsetSeconds;
        t = Math.max(0, t);

        // Find clip
        let clip: Clip | undefined;
        for (const tr of project.tracks) {
          clip = tr.clips.find((c) => c.id === d.clipId);
          if (clip) break;
        }
        if (!clip) return;

        const dur = clip.timelineEnd - clip.timelineStart;
        const snapTargets = getSnapTargets(d.clipId);
        const snapThreshold = SNAP_THRESHOLD_PX / Z;
        t = snap(t, snapTargets, snapThreshold);
        t = snap(t + dur, snapTargets, snapThreshold) - dur;
        t = Math.max(0, t);

        onClipUpdate(d.clipId, {
          timelineStart: t,
          timelineEnd: t + dur,
        });
        return;
      }

      if (d.type === 'trimLeft') {
        let t = Math.max(0, (x + SL - HEADER_WIDTH) / Z);
        let clip: Clip | undefined;
        for (const tr of project.tracks) {
          clip = tr.clips.find((c) => c.id === d.clipId);
          if (clip) break;
        }
        if (!clip) return;

        const snapTargets = getSnapTargets(d.clipId);
        const snapThreshold = SNAP_THRESHOLD_PX / Z;
        t = snap(t, snapTargets, snapThreshold);
        t = clamp(t, 0, clip.timelineEnd - 0.1);

        const dt = t - clip.timelineStart;
        onClipUpdate(d.clipId, {
          timelineStart: t,
          sourceStart: clip.sourceStart + dt,
        });
        return;
      }

      if (d.type === 'trimRight') {
        let t = Math.max(0, (x + SL - HEADER_WIDTH) / Z);
        let clip: Clip | undefined;
        for (const tr of project.tracks) {
          clip = tr.clips.find((c) => c.id === d.clipId);
          if (clip) break;
        }
        if (!clip) return;

        const asset = assets.find((a) => a.id === clip!.assetId);
        // Max end is constrained by remaining source duration after current sourceStart
        const maxSourceRemaining = asset ? asset.duration - clip.sourceStart : 9999;
        const maxTimelineEnd = clip.timelineStart + maxSourceRemaining;

        const snapTargets = getSnapTargets(d.clipId);
        const snapThreshold = SNAP_THRESHOLD_PX / Z;
        t = snap(t, snapTargets, snapThreshold);
        t = clamp(t, clip.timelineStart + 0.1, maxTimelineEnd);

        const dt = t - clip.timelineEnd;
        onClipUpdate(d.clipId, {
          timelineEnd: t,
          sourceEnd: Math.min(clip.sourceEnd + dt, asset ? asset.duration : clip.sourceEnd + dt),
        });
        return;
      }
    },
    [project, assets, getSnapTargets, onClipUpdate, onSeek]
  );

  const handleMouseUp = useCallback(() => {
    setDrag({ type: 'none' });
  }, []);

  // Wheel zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.85 : 1.18;
      setZoom((z) => clamp(z * factor, MIN_ZOOM, MAX_ZOOM));
    } else {
      setScrollLeft((s) => Math.max(0, s + e.deltaX + e.deltaY));
    }
  }, []);

  // Drag-and-drop from media bin
  const handleDragOver = useCallback((e: React.DragEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const rect = canvasRef.current!.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const track = getTrackAtY(y);
    setDropTarget(track?.id ?? null);
  }, [getTrackAtY]);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      const assetId = e.dataTransfer.getData('assetId');
      const duration = parseFloat(e.dataTransfer.getData('assetDuration') ?? '5');

      const rect = canvasRef.current!.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const Z = zoomRef.current;
      const SL = scrollLeftRef.current;

      const t = Math.max(0, (x + SL - HEADER_WIDTH) / Z);
      const track = getTrackAtY(y);

      if (assetId && track) {
        const snapTargets = getSnapTargets();
        const st = snap(t, snapTargets, SNAP_THRESHOLD_PX / Z);
        onDropAsset(track.id, assetId, st, duration);
      }
      setDropTarget(null);
    },
    [getTrackAtY, getSnapTargets, onDropAsset]
  );

  // Double click = split
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = canvasRef.current!.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const Z = zoomRef.current;
      const SL = scrollLeftRef.current;

      const hit = getClipAtPosition(x, y);
      if (hit) {
        const t = (x + SL - HEADER_WIDTH) / Z;
        onSplit(hit.clip.id, t);
      }
    },
    [getClipAtPosition, onSplit]
  );

  // Cursor style
  const [cursor, setCursor] = useState('default');
  const handleMouseMoveForCursor = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (dragRef.current.type !== 'none') return;
      const rect = canvasRef.current!.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      if (y < RULER_HEIGHT) {
        setCursor('col-resize');
        return;
      }
      const hit = getClipAtPosition(x, y);
      if (!hit) {
        setCursor('default');
        return;
      }
      const Z = zoomRef.current;
      const SL = scrollLeftRef.current;
      const clipX = hit.clip.timelineStart * Z - SL + HEADER_WIDTH;
      const clipXEnd = hit.clip.timelineEnd * Z - SL + HEADER_WIDTH;
      if (x < clipX + 8 || x > clipXEnd - 8) {
        setCursor('ew-resize');
      } else {
        setCursor('grab');
      }
    },
    [getClipAtPosition]
  );

  const totalDuration = project?.duration ?? 0;
  const totalWidth = Math.max(totalDuration * zoom + 200, containerRef.current?.clientWidth ?? 800);

  return (
    <div
      ref={containerRef}
      className="relative bg-surface"
      style={{ height: `${RULER_HEIGHT + (project?.tracks.length ?? 3) * TRACK_HEIGHT + 8}px` }}
    >
      <canvas
        ref={canvasRef}
        style={{ cursor, display: 'block', width: '100%', height: '100%' }}
        onMouseDown={handleMouseDown}
        onMouseMove={(e) => {
          handleMouseMove(e);
          handleMouseMoveForCursor(e);
        }}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onDoubleClick={handleDoubleClick}
      />
    </div>
  );
}

function drawWaveform(
  ctx: CanvasRenderingContext2D,
  wf: WaveformData,
  clip: Clip,
  zoom: number,
  scrollLeft: number,
  trackY: number,
  trackHeight: number,
  headerWidth: number,
  canvasWidth: number
) {
  const clipX = clip.timelineStart * zoom - scrollLeft + headerWidth;
  const clipW = (clip.timelineEnd - clip.timelineStart) * zoom;
  const clipDur = clip.timelineEnd - clip.timelineStart;

  if (clipW <= 0 || wf.duration <= 0 || wf.samples.length === 0) return;

  ctx.save();
  ctx.beginPath();
  ctx.rect(Math.max(clipX, headerWidth), trackY + 2, Math.min(clipW, canvasWidth - headerWidth), trackHeight - 4);
  ctx.clip();

  const mid = trackY + trackHeight / 2;
  const amplitude = (trackHeight - 8) / 2;

  ctx.strokeStyle = 'rgba(108, 99, 255, 0.7)';
  ctx.lineWidth = 1;
  ctx.beginPath();

  const samplesPerPx = wf.samples.length / wf.duration;
  const startPx = Math.max(0, headerWidth - clipX);
  const endPx = Math.min(clipW, canvasWidth - clipX);

  for (let px = startPx; px <= endPx; px++) {
    const t = px / zoom;
    const sampleIdx = Math.floor((clip.sourceStart + t) * samplesPerPx);
    const sample = wf.samples[Math.min(sampleIdx, wf.samples.length - 1)] ?? 0;
    const y = mid - sample * amplitude;
    const x = clipX + px;
    if (px === startPx) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Mirror
  ctx.beginPath();
  for (let px = startPx; px <= endPx; px++) {
    const t = px / zoom;
    const sampleIdx = Math.floor((clip.sourceStart + t) * samplesPerPx);
    const sample = wf.samples[Math.min(sampleIdx, wf.samples.length - 1)] ?? 0;
    const y = mid + sample * amplitude;
    const x = clipX + px;
    if (px === startPx) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  ctx.restore();
}

function lightenColor(hex: string, amount: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, (num >> 16) + amount);
  const g = Math.min(255, ((num >> 8) & 0xff) + amount);
  const b = Math.min(255, (num & 0xff) + amount);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}
