'use client';

import { useRef, useCallback, useEffect, useState } from 'react';
import type { Project, Track, Clip, Asset, WaveformData, BeatsData } from '@video-editor/shared';
import { getClipColor, clamp, snap, formatTime } from '@/lib/utils';

const TRACK_HEIGHT = 56;
const HEADER_WIDTH = 80;
const RULER_HEIGHT = 24;
const WORK_BAR_H = 8; // top portion of ruler reserved for work area bar
const MIN_ZOOM = 20;   // px per second
const MAX_ZOOM = 400;
const SNAP_THRESHOLD_PX = 8;
const WA_HANDLE_HIT = 8; // hit radius in px for work area handles

// Ghost clip state during drag-over
interface GhostClip {
  assetId: string;
  assetType: 'video' | 'audio';
  timelineStart: number;
  duration: number;
  trackId: string | null; // null = drop would create a new track
  trackY: number;         // canvas Y for the row where ghost renders
}

interface Props {
  project: Project | null;
  currentTime: number;
  assets: Asset[];
  waveforms: Map<string, WaveformData>;
  beatsData: Map<string, BeatsData>;
  selectedClipId: string | null;
  workArea: { start: number; end: number } | null;
  draggedAsset: Asset | null; // asset currently being dragged from MediaBin
  onSeek: (t: number) => void;
  onClipSelect: (clipId: string | null) => void;
  onClipUpdate: (clipId: string, updates: Partial<Clip>) => void;
  onClipDelete: (clipId: string) => void;
  onSplit: (clipId: string, time: number) => void;
  onDropAsset: (trackId: string, assetId: string, timelineStart: number, duration: number) => void;
  onDropAssetNewTrack: (assetType: 'video' | 'audio', assetId: string, timelineStart: number, duration: number) => void;
  onWorkAreaChange: (start: number, end: number) => void;
}

type DragMode =
  | { type: 'none' }
  | { type: 'seek' }
  | { type: 'workAreaStart' }
  | { type: 'workAreaEnd' }
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
  workArea,
  draggedAsset,
  onSeek,
  onClipSelect,
  onClipUpdate,
  onClipDelete,
  onSplit,
  onDropAsset,
  onDropAssetNewTrack,
  onWorkAreaChange,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [zoom, setZoom] = useState(80); // px/second
  const [scrollLeft, setScrollLeft] = useState(0);
  const [drag, setDrag] = useState<DragMode>({ type: 'none' });

  const dragRef = useRef<DragMode>({ type: 'none' });
  dragRef.current = drag;

  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  const scrollLeftRef = useRef(scrollLeft);
  scrollLeftRef.current = scrollLeft;

  const workAreaRef = useRef(workArea);
  workAreaRef.current = workArea;

  // Ghost clip ref (updated during drag-over without triggering re-renders)
  const ghostRef = useRef<GhostClip | null>(null);

  const propsRef = useRef({ project, currentTime, assets, waveforms, beatsData, selectedClipId, workArea });
  useEffect(() => {
    propsRef.current = { project, currentTime, assets, waveforms, beatsData, selectedClipId, workArea };
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

  // Compute total track rows height for sizing
  const getTotalTracksHeight = useCallback((numTracks: number) => numTracks * TRACK_HEIGHT, []);

  // Get the canvas-Y for track at a given index
  const trackYForIndex = useCallback((idx: number) => RULER_HEIGHT + idx * TRACK_HEIGHT, []);

  // Get track at canvas Y (returns track and its Y position)
  const getTrackAtY = useCallback(
    (y: number): { track: Track; trackY: number } | null => {
      if (!project) return null;
      let ty = RULER_HEIGHT;
      for (const track of project.tracks) {
        if (y >= ty && y < ty + TRACK_HEIGHT) return { track, trackY: ty };
        ty += TRACK_HEIGHT;
      }
      return null;
    },
    [project]
  );

  // ─── Drawing ──────────────────────────────────────────────────────────────

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { project, currentTime, waveforms, beatsData, selectedClipId, workArea } = propsRef.current;
    const ghost = ghostRef.current;
    const W = canvas.width;
    const H = canvas.height;
    const Z = zoomRef.current;
    const SL = scrollLeftRef.current;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0e1a2e';
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

    // ─── Work area bar (top WORK_BAR_H px of ruler) ───────────────────────
    if (workArea) {
      const waS = workArea.start * Z - SL + HEADER_WIDTH;
      const waE = workArea.end * Z - SL + HEADER_WIDTH;

      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(HEADER_WIDTH, 0, timeWidth, WORK_BAR_H);

      const wsX = Math.max(HEADER_WIDTH, waS);
      const weX = Math.min(W, waE);
      if (weX > wsX) {
        ctx.fillStyle = 'rgba(0,212,160,0.45)';
        ctx.fillRect(wsX, 0, weX - wsX, WORK_BAR_H);
      }

      if (waS >= HEADER_WIDTH - 8 && waS <= W + 8) {
        ctx.fillStyle = '#00d4a0';
        ctx.fillRect(Math.round(waS) - 1, 0, 2, RULER_HEIGHT);
        ctx.beginPath();
        ctx.moveTo(waS - 5, 0);
        ctx.lineTo(waS + 5, 0);
        ctx.lineTo(waS, WORK_BAR_H);
        ctx.closePath();
        ctx.fill();
      }

      if (waE >= HEADER_WIDTH - 8 && waE <= W + 8) {
        ctx.fillStyle = '#00d4a0';
        ctx.fillRect(Math.round(waE) - 1, 0, 2, RULER_HEIGHT);
        ctx.beginPath();
        ctx.moveTo(waE - 5, 0);
        ctx.lineTo(waE + 5, 0);
        ctx.lineTo(waE, WORK_BAR_H);
        ctx.closePath();
        ctx.fill();
      }
    }

    // ─── Ruler ────────────────────────────────────────────────────────────
    ctx.fillStyle = '#0b1826';
    ctx.fillRect(HEADER_WIDTH, WORK_BAR_H, timeWidth, RULER_HEIGHT - WORK_BAR_H);

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
      ctx.moveTo(x, WORK_BAR_H);
      ctx.lineTo(x, RULER_HEIGHT);
      ctx.strokeStyle = 'rgba(0,212,160,0.22)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillText(formatTime(s), x + 3, RULER_HEIGHT - 4);
    }

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
          ctx.fillRect(x - 0.5, WORK_BAR_H, 1, RULER_HEIGHT - WORK_BAR_H);
        }
      }
    }

    // ─── Tracks ───────────────────────────────────────────────────────────
    let trackY = RULER_HEIGHT;
    for (const track of tracks) {
      const isAudio = track.type === 'audio';
      const isGhostTrack = ghost?.trackId === track.id;

      const isTextTrack = track.type === 'text';

      // Track header
      ctx.fillStyle = isGhostTrack ? 'rgba(0,212,160,0.15)' : '#101f33';
      ctx.fillRect(0, trackY, HEADER_WIDTH, TRACK_HEIGHT);
      ctx.strokeStyle = isGhostTrack ? 'rgba(0,212,160,0.50)' : 'rgba(0,212,160,0.18)';
      ctx.lineWidth = isGhostTrack ? 2 : 1;
      ctx.strokeRect(0, trackY, HEADER_WIDTH, TRACK_HEIGHT);

      ctx.fillStyle = isAudio
        ? 'rgba(0,212,160,0.65)'
        : isTextTrack
        ? 'rgba(167,139,250,0.80)'
        : 'rgba(56,189,248,0.65)';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 1;
      ctx.fillText(track.name.toUpperCase(), HEADER_WIDTH / 2, trackY + TRACK_HEIGHT / 2 + 4);

      // Track body background
      ctx.fillStyle = isAudio
        ? 'rgba(0,212,160,0.05)'
        : isTextTrack
        ? 'rgba(167,139,250,0.04)'
        : 'rgba(56,189,248,0.04)';
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
      const isText = track.type === 'text';
      for (const clip of track.clips) {
        const clipX = clip.timelineStart * Z - SL + HEADER_WIDTH;
        const clipW = (clip.timelineEnd - clip.timelineStart) * Z;
        if (clipX + clipW < HEADER_WIDTH || clipX > W) continue;

        const isSelected = clip.id === selectedClipId;
        // Text clips get a distinct violet color; others use asset-based color
        const color = isText ? '#a78bfa' : getClipColor(clip.assetId);

        const visX = Math.max(clipX, HEADER_WIDTH);
        const visW = Math.min(clipX + clipW, W) - visX;
        const clipTop = trackY + 2;
        const clipH = TRACK_HEIGHT - 4;

        ctx.fillStyle = isSelected ? lightenColor(color, 20) : color;
        ctx.globalAlpha = isAudio ? 0.45 : isText ? 0.75 : 0.88;
        ctx.fillRect(visX, clipTop, visW, clipH);
        ctx.globalAlpha = 1;

        if (isAudio) {
          const wf = waveforms.get(clip.assetId);
          if (wf && wf.samples.length > 0) {
            drawWaveformOnClip(ctx, wf, clip, Z, SL, trackY, TRACK_HEIGHT, HEADER_WIDTH, W);
          }
        }

        ctx.strokeStyle = isSelected
          ? 'rgba(0,212,160,0.9)'
          : isAudio
          ? 'rgba(0,212,160,0.35)'
          : lightenColor(color, 40);
        ctx.lineWidth = isSelected ? 2 : 1;
        ctx.strokeRect(visX + 0.5, clipTop + 0.5, visW - 1, clipH - 1);

        ctx.save();
        ctx.beginPath();
        ctx.rect(visX, trackY, visW, TRACK_HEIGHT);
        ctx.clip();

        ctx.fillStyle = isText ? 'rgba(255,255,255,0.90)' : isAudio ? 'rgba(0,212,160,0.9)' : 'rgba(255,255,255,0.85)';
        ctx.font = isText ? 'bold 11px sans-serif' : '11px sans-serif';
        ctx.textAlign = 'left';
        const asset = propsRef.current.assets.find((a) => a.id === clip.assetId);
        const label = isText
          ? (clip.textContent ? `T "${clip.textContent}"` : 'T Text')
          : (asset?.name ?? clip.assetId);
        ctx.fillText(label, visX + 4, trackY + 14);

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

        if (isSelected) {
          ctx.fillStyle = 'rgba(0,212,160,0.9)';
          ctx.fillRect(visX, clipTop, 4, clipH);
          ctx.fillRect(Math.min(clipX + clipW, W) - 4, clipTop, 4, clipH);
        }
      }

      // ─── Ghost clip on existing track ──────────────────────────────────
      if (ghost && ghost.trackId === track.id) {
        drawGhostClip(ctx, ghost, Z, SL, trackY, TRACK_HEIGHT, HEADER_WIDTH, W);
      }

      trackY += TRACK_HEIGHT;
    }

    // ─── Ghost clip on new track zone (below all existing tracks) ─────────
    if (ghost && ghost.trackId === null) {
      const newTrackY = trackY;
      const isAudioGhost = ghost.assetType === 'audio';

      // Draw new track header
      ctx.fillStyle = isAudioGhost ? 'rgba(0,212,160,0.12)' : 'rgba(56,189,248,0.10)';
      ctx.fillRect(0, newTrackY, HEADER_WIDTH, TRACK_HEIGHT);
      ctx.strokeStyle = isAudioGhost ? 'rgba(0,212,160,0.45)' : 'rgba(56,189,248,0.45)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(1, newTrackY + 1, HEADER_WIDTH - 2, TRACK_HEIGHT - 2);
      ctx.setLineDash([]);

      ctx.fillStyle = isAudioGhost ? 'rgba(0,212,160,0.55)' : 'rgba(56,189,248,0.55)';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('+ NEW', HEADER_WIDTH / 2, newTrackY + TRACK_HEIGHT / 2 + 4);

      // Draw new track body background
      ctx.fillStyle = isAudioGhost ? 'rgba(0,212,160,0.05)' : 'rgba(56,189,248,0.04)';
      ctx.fillRect(HEADER_WIDTH, newTrackY, timeWidth, TRACK_HEIGHT);

      // Dashed border for new track area
      ctx.strokeStyle = isAudioGhost ? 'rgba(0,212,160,0.25)' : 'rgba(56,189,248,0.25)';
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(HEADER_WIDTH + 0.5, newTrackY + 0.5, timeWidth - 1, TRACK_HEIGHT - 1);
      ctx.setLineDash([]);

      // Ghost clip inside new track
      drawGhostClip(ctx, ghost, Z, SL, newTrackY, TRACK_HEIGHT, HEADER_WIDTH, W);
    }

    // ─── Work area dim overlay on tracks ──────────────────────────────────
    if (workArea) {
      const waS = workArea.start * Z - SL + HEADER_WIDTH;
      const waE = workArea.end * Z - SL + HEADER_WIDTH;
      const totalTrackH = tracks.length * TRACK_HEIGHT;

      ctx.fillStyle = 'rgba(0,0,0,0.38)';

      const leftEnd = Math.min(Math.max(waS, HEADER_WIDTH), W);
      if (leftEnd > HEADER_WIDTH) {
        ctx.fillRect(HEADER_WIDTH, RULER_HEIGHT, leftEnd - HEADER_WIDTH, totalTrackH);
      }

      const rightStart = Math.max(Math.min(waE, W), HEADER_WIDTH);
      if (rightStart < W) {
        ctx.fillRect(rightStart, RULER_HEIGHT, W - rightStart, totalTrackH);
      }
    }

    // ─── Playhead ──────────────────────────────────────────────────────────
    const playX = currentTime * Z - SL + HEADER_WIDTH;
    if (playX >= HEADER_WIDTH && playX <= W) {
      ctx.shadowColor = '#ff4560';
      ctx.shadowBlur = 6;
      ctx.strokeStyle = '#ff4560';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(playX, 0);
      ctx.lineTo(playX, H);
      ctx.stroke();
      ctx.shadowBlur = 0;

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

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = canvasRef.current!.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const Z = zoomRef.current;
      const SL = scrollLeftRef.current;

      if (y < RULER_HEIGHT) {
        const wa = workAreaRef.current;
        if (wa) {
          const waS = wa.start * Z - SL + HEADER_WIDTH;
          const waE = wa.end * Z - SL + HEADER_WIDTH;
          if (Math.abs(x - waS) < WA_HANDLE_HIT) {
            setDrag({ type: 'workAreaStart' });
            return;
          }
          if (Math.abs(x - waE) < WA_HANDLE_HIT) {
            setDrag({ type: 'workAreaEnd' });
            return;
          }
        }
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

      if (d.type === 'workAreaStart') {
        const wa = workAreaRef.current;
        if (!wa) return;
        const t = Math.max(0, (x + SL - HEADER_WIDTH) / Z);
        const newStart = Math.min(t, wa.end - 0.1);
        onWorkAreaChange(newStart, wa.end);
        return;
      }

      if (d.type === 'workAreaEnd') {
        const wa = workAreaRef.current;
        if (!wa) return;
        const t = Math.max(0, (x + SL - HEADER_WIDTH) / Z);
        const newEnd = Math.max(t, wa.start + 0.1);
        onWorkAreaChange(wa.start, newEnd);
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
    [project, assets, getSnapTargets, onClipUpdate, onSeek, onWorkAreaChange]
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

  // ─── Drag & Drop (from MediaBin) ───────────────────────────────────────

  const handleDragOver = useCallback((e: React.DragEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';

    if (!draggedAsset) return; // no ghost if we don't know the asset

    const rect = canvasRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const Z = zoomRef.current;
    const SL = scrollLeftRef.current;

    const rawT = Math.max(0, (x + SL - HEADER_WIDTH) / Z);
    const snapTargets = propsRef.current.project
      ? propsRef.current.project.tracks.flatMap((t) =>
          t.clips.flatMap((c) => [c.timelineStart, c.timelineEnd])
        )
      : [0];
    const snappedT = snap(rawT, snapTargets, SNAP_THRESHOLD_PX / Z);

    const trackResult = getTrackAtY(y);

    let ghostTrackId: string | null = null;
    let ghostTrackY = 0;

    if (trackResult) {
      ghostTrackId = trackResult.track.id;
      ghostTrackY = trackResult.trackY;
    } else if (y > RULER_HEIGHT) {
      // Below all existing tracks → new track zone
      ghostTrackId = null;
      const numTracks = propsRef.current.project?.tracks.length ?? 0;
      ghostTrackY = RULER_HEIGHT + numTracks * TRACK_HEIGHT;
    }

    ghostRef.current = {
      assetId: draggedAsset.id,
      assetType: draggedAsset.type,
      timelineStart: snappedT,
      duration: draggedAsset.duration,
      trackId: ghostTrackId,
      trackY: ghostTrackY,
    };

    draw();
  }, [draggedAsset, getTrackAtY, draw]);

  const handleDragLeave = useCallback(() => {
    ghostRef.current = null;
    draw();
  }, [draw]);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      ghostRef.current = null;

      const assetId = e.dataTransfer.getData('assetId');
      const duration = parseFloat(e.dataTransfer.getData('assetDuration') ?? '5');
      const assetType = (e.dataTransfer.getData('assetType') || 'video') as 'video' | 'audio';

      const rect = canvasRef.current!.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const Z = zoomRef.current;
      const SL = scrollLeftRef.current;

      const rawT = Math.max(0, (x + SL - HEADER_WIDTH) / Z);
      const snapTargets = getSnapTargets();
      const t = snap(rawT, snapTargets, SNAP_THRESHOLD_PX / Z);

      const trackResult = getTrackAtY(y);

      if (assetId) {
        if (trackResult) {
          onDropAsset(trackResult.track.id, assetId, t, duration);
        } else if (y > RULER_HEIGHT) {
          // Below all tracks → create a new track
          onDropAssetNewTrack(assetType, assetId, t, duration);
        }
      }

      draw();
    },
    [getTrackAtY, getSnapTargets, onDropAsset, onDropAssetNewTrack, draw]
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

      if (y < RULER_HEIGHT) {
        const wa = workAreaRef.current;
        if (wa) {
          const Z = zoomRef.current;
          const SL = scrollLeftRef.current;
          const waS = wa.start * Z - SL + HEADER_WIDTH;
          const waE = wa.end * Z - SL + HEADER_WIDTH;
          if (Math.abs(x - waS) < WA_HANDLE_HIT || Math.abs(x - waE) < WA_HANDLE_HIT) {
            setCursor('ew-resize');
            return;
          }
        }
        setCursor('col-resize');
        return;
      }

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

  // Compute canvas height based on track count (+ extra row for new-track ghost zone)
  const numTracks = project?.tracks.length ?? 1;
  const extraRow = ghostRef.current?.trackId === null ? 1 : 0;
  const canvasHeight = RULER_HEIGHT + (numTracks + extraRow) * TRACK_HEIGHT + 8;

  return (
    <div
      ref={containerRef}
      className="relative"
      style={{
        height: `${canvasHeight}px`,
        background: '#0e1a2e',
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
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onDoubleClick={handleDoubleClick}
      />
    </div>
  );
}

// Draw a semi-transparent ghost clip preview during drag
function drawGhostClip(
  ctx: CanvasRenderingContext2D,
  ghost: GhostClip,
  zoom: number,
  scrollLeft: number,
  trackY: number,
  trackHeight: number,
  headerWidth: number,
  canvasWidth: number
) {
  const clipX = ghost.timelineStart * zoom - scrollLeft + headerWidth;
  const clipW = ghost.duration * zoom;

  const visX = Math.max(clipX, headerWidth);
  const visW = Math.min(clipX + clipW, canvasWidth) - visX;
  if (visW <= 0) return;

  const clipTop = trackY + 2;
  const clipH = trackHeight - 4;

  const isAudio = ghost.assetType === 'audio';

  // Ghost body
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = isAudio ? 'rgba(0,212,160,0.35)' : 'rgba(56,189,248,0.5)';
  ctx.fillRect(visX, clipTop, visW, clipH);

  // Ghost border (dashed)
  ctx.globalAlpha = 0.85;
  ctx.strokeStyle = isAudio ? '#00d4a0' : '#38bdf8';
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 3]);
  ctx.strokeRect(visX + 1, clipTop + 1, visW - 2, clipH - 2);
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
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

  const getY = (px: number, sign: 1 | -1) => {
    const t = px / zoom;
    const sampleIdx = Math.floor((clip.sourceStart + t) * samplesPerPx);
    const sample = wf.samples[Math.min(sampleIdx, wf.samples.length - 1)] ?? 0;
    return mid + sign * sample * amplitude;
  };

  // Filled envelope
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

  const grad = ctx.createLinearGradient(0, trackY, 0, trackY + trackHeight);
  grad.addColorStop(0,    'rgba(0, 212, 160, 0.18)');
  grad.addColorStop(0.5,  'rgba(0, 212, 160, 0.52)');
  grad.addColorStop(1,    'rgba(0, 212, 160, 0.18)');
  ctx.fillStyle = grad;
  ctx.fill();

  // Upper edge line
  ctx.strokeStyle = 'rgba(0, 212, 160, 0.95)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let px = startPx; px <= endPx; px++) {
    const x = clipX + px;
    const y = getY(px, -1);
    if (px === startPx) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Lower edge line
  ctx.strokeStyle = 'rgba(0, 212, 160, 0.55)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let px = startPx; px <= endPx; px++) {
    const x = clipX + px;
    const y = getY(px, 1);
    if (px === startPx) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Centre line
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
