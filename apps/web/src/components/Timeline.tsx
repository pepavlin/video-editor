'use client';

import { useRef, useCallback, useEffect, useState } from 'react';
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

  // ─── Drawing ──────────────────────────────────────────────────────────────

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
    ctx.fillStyle = '#0b1623';
    ctx.fillRect(0, 0, W, H);

    if (!project) {
      ctx.fillStyle = '#4a7068';
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Create or load a project', W / 2, H / 2);
      return;
    }

    const timeWidth = W - HEADER_WIDTH;
    const tracks = project.tracks;

    // ─── Ruler ────────────────────────────────────────────────────────────
    ctx.fillStyle = '#091420';
    ctx.fillRect(HEADER_WIDTH, 0, timeWidth, RULER_HEIGHT);

    // Determine tick interval
    const secondsVisible = timeWidth / Z;
    let tickInterval = 1;
    if (secondsVisible > 100) tickInterval = 10;
    else if (secondsVisible > 40) tickInterval = 5;
    else if (secondsVisible > 20) tickInterval = 2;

    const startSec = Math.floor(SL / Z / tickInterval) * tickInterval;
    const endSec = Math.ceil((SL + timeWidth) / Z / tickInterval) * tickInterval;

    ctx.font = '10px sans-serif';
    ctx.fillStyle = 'rgba(0,212,160,0.45)';
    ctx.textAlign = 'left';

    for (let s = startSec; s <= endSec; s += tickInterval) {
      const x = s * Z - SL + HEADER_WIDTH;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, RULER_HEIGHT);
      ctx.strokeStyle = 'rgba(0,212,160,0.22)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillText(formatTime(s), x + 3, RULER_HEIGHT - 4);
    }

    // Sub-ticks
    const subInterval = tickInterval / 5;
    for (let s = startSec; s <= endSec; s += subInterval) {
      const x = s * Z - SL + HEADER_WIDTH;
      if (s % tickInterval === 0) continue;
      ctx.beginPath();
      ctx.moveTo(x, RULER_HEIGHT - 6);
      ctx.lineTo(x, RULER_HEIGHT);
      ctx.strokeStyle = 'rgba(0,212,160,0.12)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // ─── Beat markers on ruler ─────────────────────────────────────────────
    const masterTrack = project.tracks.find((t) => t.type === 'audio' && t.isMaster);
    const masterClip = masterTrack?.clips[0];
    if (masterClip) {
      const beats = beatsData.get(masterClip.assetId);
      if (beats) {
        ctx.fillStyle = 'rgba(0, 212, 160, 0.60)';
        for (const beat of beats.beats) {
          const x = beat * Z - SL + HEADER_WIDTH;
          if (x < HEADER_WIDTH || x > W) continue;
          ctx.fillRect(x - 0.5, 0, 1, RULER_HEIGHT);
        }
      }
    }

    // ─── Tracks ───────────────────────────────────────────────────────────
    let trackY = RULER_HEIGHT;
    for (const track of tracks) {
      const isAudio = track.type === 'audio';

      // Track header
      ctx.fillStyle = '#0c1d2e';
      ctx.fillRect(0, trackY, HEADER_WIDTH, TRACK_HEIGHT);
      ctx.strokeStyle = 'rgba(0,212,160,0.18)';
      ctx.lineWidth = 1;
      ctx.strokeRect(0, trackY, HEADER_WIDTH, TRACK_HEIGHT);

      ctx.fillStyle = isAudio ? 'rgba(0,212,160,0.65)' : 'rgba(56,189,248,0.65)';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(track.name.toUpperCase(), HEADER_WIDTH / 2, trackY + TRACK_HEIGHT / 2 + 4);

      // Track body background
      ctx.fillStyle = isAudio ? 'rgba(0,212,160,0.05)' : 'rgba(56,189,248,0.04)';
      ctx.fillRect(HEADER_WIDTH, trackY, timeWidth, TRACK_HEIGHT);

      // Track separator
      ctx.fillStyle = 'rgba(0,212,160,0.14)';
      ctx.fillRect(HEADER_WIDTH, trackY + TRACK_HEIGHT - 1, timeWidth, 1);

      // Grid lines
      for (let s = startSec; s <= endSec; s += tickInterval) {
        const x = s * Z - SL + HEADER_WIDTH;
        ctx.strokeStyle = 'rgba(0,212,160,0.09)';
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
          ctx.fillStyle = 'rgba(0, 212, 160, 0.15)';
          for (const beat of beats.beats) {
            const x = beat * Z - SL + HEADER_WIDTH;
            if (x < HEADER_WIDTH || x > W) continue;
            ctx.fillRect(x - 0.5, trackY, 1, TRACK_HEIGHT);
          }
        }
      }

      // ─── Clips ──────────────────────────────────────────────────────────
      for (const clip of track.clips) {
        const clipX = clip.timelineStart * Z - SL + HEADER_WIDTH;
        const clipW = (clip.timelineEnd - clip.timelineStart) * Z;
        if (clipX + clipW < HEADER_WIDTH || clipX > W) continue;

        const isSelected = clip.id === selectedClipId;
        const color = getClipColor(clip.assetId);

        const visX = Math.max(clipX, HEADER_WIDTH);
        const visW = Math.min(clipX + clipW, W) - visX;
        const clipTop = trackY + 2;
        const clipH = TRACK_HEIGHT - 4;

        // Clip body
        ctx.fillStyle = isSelected ? lightenColor(color, 20) : color;
        ctx.globalAlpha = isAudio ? 0.45 : 0.88;
        ctx.fillRect(visX, clipTop, visW, clipH);
        ctx.globalAlpha = 1;

        // Waveform drawn on top of clip body for ALL audio clips
        if (isAudio) {
          const wf = waveforms.get(clip.assetId);
          if (wf && wf.samples.length > 0) {
            drawWaveformOnClip(ctx, wf, clip, Z, SL, trackY, TRACK_HEIGHT, HEADER_WIDTH, W);
          }
        }

        // Clip border
        ctx.strokeStyle = isSelected
          ? 'rgba(0,212,160,0.9)'
          : isAudio
          ? 'rgba(0,212,160,0.35)'
          : lightenColor(color, 40);
        ctx.lineWidth = isSelected ? 2 : 1;
        ctx.strokeRect(visX + 0.5, clipTop + 0.5, visW - 1, clipH - 1);

        // Clip label
        ctx.save();
        ctx.beginPath();
        ctx.rect(visX, trackY, visW, TRACK_HEIGHT);
        ctx.clip();

        ctx.fillStyle = isAudio ? 'rgba(0,212,160,0.9)' : 'rgba(255,255,255,0.85)';
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'left';
        const asset = propsRef.current.assets.find((a) => a.id === clip.assetId);
        const label = asset?.name ?? clip.assetId;
        ctx.fillText(label, visX + 4, trackY + 14);

        // Effects badges
        if (clip.effects.length > 0) {
          ctx.fillStyle = 'rgba(240,177,0,0.85)';
          ctx.font = 'bold 9px sans-serif';
          ctx.fillText(
            clip.effects.map((e) => (e.type === 'beatZoom' ? 'BZ' : 'CUT')).join(' '),
            visX + 4,
            trackY + TRACK_HEIGHT - 8
          );
        }

        ctx.restore();

        // Trim handles
        if (isSelected) {
          ctx.fillStyle = 'rgba(0,212,160,0.9)';
          ctx.fillRect(visX, clipTop, 4, clipH);
          ctx.fillRect(Math.min(clipX + clipW, W) - 4, clipTop, 4, clipH);
        }
      }

      trackY += TRACK_HEIGHT;
    }

    // ─── Playhead ──────────────────────────────────────────────────────────
    const playX = currentTime * Z - SL + HEADER_WIDTH;
    if (playX >= HEADER_WIDTH && playX <= W) {
      // Glow effect
      ctx.shadowColor = '#ff4560';
      ctx.shadowBlur = 6;
      ctx.strokeStyle = '#ff4560';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(playX, 0);
      ctx.lineTo(playX, H);
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Playhead triangle
      ctx.fillStyle = '#ff4560';
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

  // ─── Mouse interactions ────────────────────────────────────────────────

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

        onClipUpdate(d.clipId, { timelineStart: t, timelineEnd: t + dur });
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
        onClipUpdate(d.clipId, { timelineStart: t, sourceStart: clip.sourceStart + dt });
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

  const handleMouseUp = useCallback(() => { setDrag({ type: 'none' }); }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.85 : 1.18;
      setZoom((z) => clamp(z * factor, MIN_ZOOM, MAX_ZOOM));
    } else {
      setScrollLeft((s) => Math.max(0, s + e.deltaX + e.deltaY));
    }
  }, []);

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

  const [cursor, setCursor] = useState('default');
  const handleMouseMoveForCursor = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (dragRef.current.type !== 'none') return;
      const rect = canvasRef.current!.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      if (y < RULER_HEIGHT) { setCursor('col-resize'); return; }
      const hit = getClipAtPosition(x, y);
      if (!hit) { setCursor('default'); return; }
      const Z = zoomRef.current;
      const SL = scrollLeftRef.current;
      const clipX = hit.clip.timelineStart * Z - SL + HEADER_WIDTH;
      const clipXEnd = hit.clip.timelineEnd * Z - SL + HEADER_WIDTH;
      setCursor(x < clipX + 8 || x > clipXEnd - 8 ? 'ew-resize' : 'grab');
    },
    [getClipAtPosition]
  );

  return (
    <div
      ref={containerRef}
      className="relative"
      style={{
        height: `${RULER_HEIGHT + (project?.tracks.length ?? 3) * TRACK_HEIGHT + 8}px`,
        background: '#0b1623',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{ cursor, display: 'block', width: '100%', height: '100%' }}
        onMouseDown={handleMouseDown}
        onMouseMove={(e) => { handleMouseMove(e); handleMouseMoveForCursor(e); }}
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

// Draw waveform centered within a clip's bounds
function drawWaveformOnClip(
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

  if (clipW <= 0 || wf.duration <= 0 || wf.samples.length === 0) return;

  ctx.save();
  ctx.beginPath();
  ctx.rect(Math.max(clipX, headerWidth), trackY + 2, Math.min(clipW, canvasWidth - headerWidth), trackHeight - 4);
  ctx.clip();

  const mid = trackY + trackHeight / 2;
  const amplitude = (trackHeight - 12) / 2;
  const samplesPerPx = wf.samples.length / wf.duration;

  const startPx = Math.max(0, headerWidth - clipX);
  const endPx = Math.min(clipW, canvasWidth - clipX);

  // Helper to get y position at a given pixel
  const getY = (px: number, sign: 1 | -1) => {
    const t = px / zoom;
    const sampleIdx = Math.floor((clip.sourceStart + t) * samplesPerPx);
    const sample = wf.samples[Math.min(sampleIdx, wf.samples.length - 1)] ?? 0;
    return mid + sign * sample * amplitude;
  };

  // ── Filled envelope (upper arc → lower arc reversed) ──────────────────
  ctx.beginPath();
  for (let px = startPx; px <= endPx; px++) {
    const x = clipX + px;
    const y = getY(px, -1);
    if (px === startPx) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  for (let px = endPx; px >= startPx; px--) {
    ctx.lineTo(clipX + px, getY(px, 1));
  }
  ctx.closePath();

  // Gradient fill from teal to slightly brighter in the centre
  const grad = ctx.createLinearGradient(0, trackY, 0, trackY + trackHeight);
  grad.addColorStop(0,    'rgba(0, 212, 160, 0.18)');
  grad.addColorStop(0.5,  'rgba(0, 212, 160, 0.52)');
  grad.addColorStop(1,    'rgba(0, 212, 160, 0.18)');
  ctx.fillStyle = grad;
  ctx.fill();

  // ── Upper edge line ────────────────────────────────────────────────────
  ctx.strokeStyle = 'rgba(0, 212, 160, 0.95)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let px = startPx; px <= endPx; px++) {
    const x = clipX + px;
    const y = getY(px, -1);
    if (px === startPx) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // ── Lower edge line ────────────────────────────────────────────────────
  ctx.strokeStyle = 'rgba(0, 212, 160, 0.55)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let px = startPx; px <= endPx; px++) {
    const x = clipX + px;
    const y = getY(px, 1);
    if (px === startPx) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // ── Centre line ─────────────────────────────────────────────────────────
  ctx.strokeStyle = 'rgba(0, 212, 160, 0.15)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(clipX + startPx, mid);
  ctx.lineTo(clipX + endPx, mid);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.restore();
}

function lightenColor(hex: string, amount: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, (num >> 16) + amount);
  const g = Math.min(255, ((num >> 8) & 0xff) + amount);
  const b = Math.min(255, (num & 0xff) + amount);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}
