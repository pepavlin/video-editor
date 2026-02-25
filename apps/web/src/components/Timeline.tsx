'use client';

import { useRef, useCallback, useEffect, useState } from 'react';
import type { Project, Track, Clip, Asset, WaveformData, BeatsData, EffectType } from '@video-editor/shared';
import { getClipColor, clamp, snap, formatTime } from '@/lib/utils';
import { useThemeContext } from '@/contexts/ThemeContext';

const TRACK_HEIGHT = 56;
const EFFECT_TRACK_HEIGHT = 26; // effect tracks are thin strips
const HEADER_WIDTH = 80;
const RULER_HEIGHT = 24;
const WORK_BAR_H = 8; // top portion of ruler reserved for work area bar
const MIN_ZOOM = 20;   // px per second
const MAX_ZOOM = 400;
const SNAP_THRESHOLD_PX = 8;
const WA_HANDLE_HIT = 8; // hit radius in px for work area handles (mouse)
const INSERT_ZONE_PX = 10; // px from track boundary that triggers "insert new row here"

// Touch-friendly hit areas (larger to accommodate finger precision)
const TOUCH_HANDLE = 24;       // trim handle hit area for touch
const TOUCH_WA_HANDLE_HIT = 20; // work area handle hit area for touch
const TOUCH_SNAP_THRESHOLD_PX = 16; // larger snap zone for touch

function getTrackH(track: Track): number {
  return track.type === 'effect' ? EFFECT_TRACK_HEIGHT : TRACK_HEIGHT;
}

// Returns true if a clip from a track of sourceType can be moved to targetTrack
function isCompatibleTrackType(sourceType: Track['type'], targetTrack: Track): boolean {
  // Effect clips and effect tracks are never valid targets for clip movement
  if (sourceType === 'effect' || targetTrack.type === 'effect') return false;
  // Each track type can only accept clips of the same type
  return sourceType === targetTrack.type;
}

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
  onTrackReorder: (fromIdx: number, toIdx: number) => void;
  onAddEffectTrack: (effectType: EffectType, timelineStart: number, duration: number, parentTrackId?: string) => void;
  onMoveClipToTrack: (clipId: string, toTrackId: string, timelineStart: number, timelineEnd: number) => void;
  onMoveClipToNewTrack: (clipId: string, newTrackType: Track['type'], timelineStart: number, timelineEnd: number) => void;
  onMoveClipToNewTrackAt: (clipId: string, newTrackType: Track['type'], timelineStart: number, timelineEnd: number, insertAfterIdx: number) => void;
}

type DragMode =
  | { type: 'none' }
  | { type: 'seek' }
  | { type: 'workAreaStart' }
  | { type: 'workAreaEnd' }
  | { type: 'moveClip'; clipId: string; trackId: string; offsetSeconds: number; leftAdjacentId: string | null; rightAdjacentId: string | null }
  | { type: 'trimLeft'; clipId: string }
  | { type: 'trimRight'; clipId: string };

/** Controls what positions clips snap to during drag */
export type SnapMode = 'none' | 'beats' | 'clips';

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
  onTrackReorder,
  onAddEffectTrack,
  onMoveClipToTrack,
  onMoveClipToNewTrack,
  onMoveClipToNewTrackAt,
}: Props) {
  const { isDark } = useThemeContext();
  const isDarkRef = useRef(isDark);
  isDarkRef.current = isDark;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [zoom, setZoom] = useState(80); // px/second
  const [scrollLeft, setScrollLeft] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [drag, setDrag] = useState<DragMode>({ type: 'none' });
  const [snapMode, setSnapMode] = useState<SnapMode>('clips');
  // Track reorder drag state
  const [trackDragFromIdx, setTrackDragFromIdx] = useState<number | null>(null);
  const [trackDragOverIdx, setTrackDragOverIdx] = useState<number | null>(null);

  const dragRef = useRef<DragMode>({ type: 'none' });
  dragRef.current = drag;

  const snapModeRef = useRef<SnapMode>('clips');
  snapModeRef.current = snapMode;

  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  const scrollLeftRef = useRef(scrollLeft);
  scrollLeftRef.current = scrollLeft;

  const scrollTopRef = useRef(scrollTop);
  scrollTopRef.current = scrollTop;

  // Tracks the canvas container height for vertical scroll clamping
  const containerHeightRef = useRef(0);
  // Tracks total content height for vertical scroll clamping
  const canvasContentHeightRef = useRef(0);

  const workAreaRef = useRef(workArea);
  workAreaRef.current = workArea;

  // Ghost clip ref (updated during drag-over without triggering re-renders)
  const ghostRef = useRef<GhostClip | null>(null);

  // ─── Touch state refs ─────────────────────────────────────────────────────
  const pinchStartDistRef = useRef<number | null>(null);
  const pinchStartZoomRef = useRef<number>(80);
  // 'drag' = interacting with clip/ruler, 'scroll' = panning timeline, 'pinch' = zoom
  const touchModeRef = useRef<'drag' | 'scroll' | 'pinch' | 'none'>('none');
  const touchScrollStartClientXRef = useRef<number>(0);
  const touchScrollStartClientYRef = useRef<number>(0);
  const touchScrollStartSLRef = useRef<number>(0);
  const touchScrollStartSTRef = useRef<number>(0);
  // True after any touch event is received – used to widen hit areas
  const isTouchDeviceRef = useRef(false);

  // Half-hover state: which clip + which half is under cursor during moveClip drag
  const clipHoverRef = useRef<{
    clip: Clip;
    half: 'left' | 'right';
    blocked: boolean;
  } | null>(null);

  // Cross-track drag state: tracks the "current" track during a moveClip drag
  // '__new__' means cursor is in the zone below all tracks (new track will be created on drop)
  // '__insert__' means cursor is near a track boundary (new row will be inserted between tracks)
  const clipDragStateRef = useRef<{
    currentTrackId: string; // '__new__' | '__insert__' | actual track id
    sourceTrackType: Track['type']; // type of the source track (for new-track creation)
    insertAfterIdx: number | null; // valid when currentTrackId === '__insert__'; -1 = before all
    leftAdjacentId: string | null;
    rightAdjacentId: string | null;
  } | null>(null);

  const propsRef = useRef({ project, currentTime, assets, waveforms, beatsData, selectedClipId, workArea });
  useEffect(() => {
    propsRef.current = { project, currentTime, assets, waveforms, beatsData, selectedClipId, workArea };
  });

  // ─── Video thumbnail cache ─────────────────────────────────────────────────
  const thumbnailCacheRef = useRef<Map<string, ImageBitmap>>(new Map());
  const thumbnailPendingRef = useRef<Set<string>>(new Set());
  const thumbnailVideoElemsRef = useRef<Map<string, HTMLVideoElement>>(new Map());
  const thumbnailQueuesRef = useRef<Map<string, (() => Promise<void>)[]>>(new Map());
  const thumbnailRunningRef = useRef<Set<string>>(new Set());
  const [, setThumbnailTick] = useState(0); // incremented when new thumbnails arrive → triggers redraw

  const requestThumbnail = useCallback(
    (assetId: string, proxyPath: string, sourceTime: number, thumbW: number, thumbH: number): void => {
      const key = `${assetId}:${sourceTime.toFixed(1)}`;
      if (thumbnailCacheRef.current.has(key) || thumbnailPendingRef.current.has(key)) return;
      if (thumbnailPendingRef.current.size >= 6) return; // cap concurrent extractions
      thumbnailPendingRef.current.add(key);

      if (!thumbnailQueuesRef.current.has(assetId)) {
        thumbnailQueuesRef.current.set(assetId, []);
      }
      const queue = thumbnailQueuesRef.current.get(assetId)!;

      queue.push(async () => {
        try {
          let video = thumbnailVideoElemsRef.current.get(assetId);
          if (!video) {
            video = document.createElement('video');
            video.src = `/files/${proxyPath}`;
            video.muted = true;
            video.preload = 'metadata';
            thumbnailVideoElemsRef.current.set(assetId, video);
            if (video.readyState < 1) {
              await new Promise<void>((resolve, reject) => {
                const v = video!;
                const onMeta = () => {
                  v.removeEventListener('loadedmetadata', onMeta);
                  v.removeEventListener('error', onErr);
                  resolve();
                };
                const onErr = () => {
                  v.removeEventListener('loadedmetadata', onMeta);
                  v.removeEventListener('error', onErr);
                  reject(new Error('video load failed'));
                };
                v.addEventListener('loadedmetadata', onMeta);
                v.addEventListener('error', onErr);
              });
            }
          }

          video.currentTime = sourceTime;
          await new Promise<void>((resolve) => {
            const v = video!;
            let settled = false;
            const finish = () => {
              if (settled) return;
              settled = true;
              v.removeEventListener('seeked', finish);
              resolve();
            };
            v.addEventListener('seeked', finish);
            setTimeout(finish, 3000);
          });

          if (video.videoWidth > 0 && video.readyState >= 2) {
            const offscreen = document.createElement('canvas');
            offscreen.width = thumbW;
            offscreen.height = thumbH;
            const c2d = offscreen.getContext('2d');
            if (c2d) {
              c2d.drawImage(video, 0, 0, thumbW, thumbH);
              const bitmap = await createImageBitmap(offscreen);
              thumbnailCacheRef.current.set(key, bitmap);
              setThumbnailTick((n) => n + 1);
            }
          }
        } catch {
          // ignore errors silently
        } finally {
          thumbnailPendingRef.current.delete(key);
        }
      });

      if (!thumbnailRunningRef.current.has(assetId)) {
        thumbnailRunningRef.current.add(assetId);
        const processQueue = async () => {
          const q = thumbnailQueuesRef.current.get(assetId)!;
          while (q.length > 0) {
            await q.shift()!().catch(() => {});
          }
          thumbnailRunningRef.current.delete(assetId);
        };
        processQueue();
      }
    },
    []
  );

  // Get snap targets filtered by the current snap mode
  const getSnapTargets = useCallback(
    (excludeClipId?: string): number[] => {
      const mode = snapModeRef.current;
      if (mode === 'none') return [];

      const targets: number[] = [0];
      if (!project) return targets;

      if (mode === 'clips') {
        for (const track of project.tracks) {
          for (const clip of track.clips) {
            if (clip.id === excludeClipId) continue;
            targets.push(clip.timelineStart, clip.timelineEnd);
          }
        }
      } else if (mode === 'beats') {
        const masterTrack = project.tracks.find((t) => t.type === 'audio' && t.isMaster);
        const masterClip = masterTrack?.clips[0];
        if (masterClip) {
          const beats = beatsData.get(masterClip.assetId);
          if (beats) targets.push(...beats.beats);
        }
      }

      return targets;
    },
    [project, beatsData]
  );

  // Compute total track rows height for sizing
  const getTotalTracksHeight = useCallback(
    (tracks: Track[]) => tracks.reduce((sum, t) => sum + getTrackH(t), 0),
    []
  );

  // Get the canvas-Y for track at a given index (variable heights), accounting for scrollTop
  const trackYForIndex = useCallback(
    (idx: number) => {
      if (!project) return RULER_HEIGHT - scrollTopRef.current + idx * TRACK_HEIGHT;
      let y = RULER_HEIGHT - scrollTopRef.current;
      for (let i = 0; i < idx && i < project.tracks.length; i++) {
        y += getTrackH(project.tracks[i]);
      }
      return y;
    },
    [project]
  );

  // Get track at canvas Y (returns track and its Y position), accounting for scrollTop
  const getTrackAtY = useCallback(
    (y: number): { track: Track; trackY: number; trackH: number } | null => {
      if (!project) return null;
      const ST = scrollTopRef.current;
      let ty = RULER_HEIGHT - ST;
      for (const track of project.tracks) {
        const th = getTrackH(track);
        if (y >= ty && y < ty + th) return { track, trackY: ty, trackH: th };
        ty += th;
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
    const ST = scrollTopRef.current;

    // ─── Theme colours ─────────────────────────────────────────────────────
    const dark = isDarkRef.current;
    const canvasBg         = dark ? '#0f172a' : '#f8fafc';
    const rulerBg          = dark ? '#1e293b' : '#f1f5f9';
    const trackHeaderBg    = dark ? '#1e293b' : '#f1f5f9';
    const effectHeaderBg   = dark ? 'rgba(60,40,15,0.95)' : 'rgba(255,247,237,0.95)';
    const trackSeparator   = dark ? 'rgba(226,232,240,0.08)' : 'rgba(15,23,42,0.07)';
    const gridLine         = dark ? 'rgba(226,232,240,0.05)' : 'rgba(15,23,42,0.05)';
    const workAreaPreDim   = dark ? 'rgba(0,0,0,0.20)'       : 'rgba(15,23,42,0.12)';
    const workAreaTrackDim = dark ? 'rgba(0,0,0,0.35)'       : 'rgba(15,23,42,0.10)';

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = canvasBg;
    ctx.fillRect(0, 0, W, H);

    if (!project) {
      ctx.fillStyle = 'rgba(13,148,136,0.50)';
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

      ctx.fillStyle = workAreaPreDim;
      ctx.fillRect(HEADER_WIDTH, 0, timeWidth, WORK_BAR_H);

      const wsX = Math.max(HEADER_WIDTH, waS);
      const weX = Math.min(W, waE);
      if (weX > wsX) {
        ctx.fillStyle = 'rgba(13,148,136,0.45)';
        ctx.fillRect(wsX, 0, weX - wsX, WORK_BAR_H);
      }

      if (waS >= HEADER_WIDTH - 8 && waS <= W + 8) {
        ctx.fillStyle = '#0d9488';
        ctx.fillRect(Math.round(waS) - 1, 0, 2, RULER_HEIGHT);
        ctx.beginPath();
        ctx.moveTo(waS - 5, 0);
        ctx.lineTo(waS + 5, 0);
        ctx.lineTo(waS, WORK_BAR_H);
        ctx.closePath();
        ctx.fill();
      }

      if (waE >= HEADER_WIDTH - 8 && waE <= W + 8) {
        ctx.fillStyle = '#0d9488';
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
    ctx.fillStyle = rulerBg;
    ctx.fillRect(HEADER_WIDTH, WORK_BAR_H, timeWidth, RULER_HEIGHT - WORK_BAR_H);

    const secondsVisible = timeWidth / Z;
    let tickInterval = 1;
    if (secondsVisible > 100) tickInterval = 10;
    else if (secondsVisible > 40) tickInterval = 5;
    else if (secondsVisible > 20) tickInterval = 2;

    const startSec = Math.floor(SL / Z / tickInterval) * tickInterval;
    const endSec = Math.ceil((SL + timeWidth) / Z / tickInterval) * tickInterval;

    ctx.font = '10px sans-serif';
    ctx.fillStyle = 'rgba(13,148,136,0.55)';
    ctx.textAlign = 'left';

    for (let s = startSec; s <= endSec; s += tickInterval) {
      const x = s * Z - SL + HEADER_WIDTH;
      ctx.beginPath();
      ctx.moveTo(x, WORK_BAR_H);
      ctx.lineTo(x, RULER_HEIGHT);
      ctx.strokeStyle = 'rgba(13,148,136,0.20)';
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
      ctx.strokeStyle = 'rgba(13,148,136,0.10)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // ─── Beat markers on ruler ─────────────────────────────────────────────
    const masterTrack = project.tracks.find((t) => t.type === 'audio' && t.isMaster);
    const masterClip = masterTrack?.clips[0];
    if (masterClip && snapModeRef.current === 'beats') {
      const beats = beatsData.get(masterClip.assetId);
      if (beats) {
        ctx.fillStyle = 'rgba(13,148,136,0.60)';
        for (const beat of beats.beats) {
          const x = beat * Z - SL + HEADER_WIDTH;
          if (x < HEADER_WIDTH || x > W) continue;
          ctx.fillRect(x - 0.5, WORK_BAR_H, 1, RULER_HEIGHT - WORK_BAR_H);
        }
      }
    }

    // ─── Determine which video clips are "covered" by the selected effect clip ──
    let selectedEffectClipRange: { start: number; end: number } | null = null;
    if (selectedClipId) {
      for (const t of tracks) {
        if (t.type !== 'effect') continue;
        const ec = t.clips.find((c) => c.id === selectedClipId);
        if (ec) { selectedEffectClipRange = { start: ec.timelineStart, end: ec.timelineEnd }; break; }
      }
    }

    // ─── Tracks (clipped below ruler, offset by scrollTop) ───────────────
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, RULER_HEIGHT, W, H - RULER_HEIGHT);
    ctx.clip();

    let trackY = RULER_HEIGHT - ST;
    for (let trackIdx = 0; trackIdx < tracks.length; trackIdx++) {
      const track = tracks[trackIdx];
      const trackH = getTrackH(track);
      const isAudio = track.type === 'audio';
      const isGhostTrack = ghost?.trackId === track.id;
      // text/lyrics tracks are treated as video tracks visually (no separate row type)
      const isTextTrack = false;
      const isLyricsTrack = false;
      const isEffectTrack = track.type === 'effect';

      // Highlight if being reordered over
      const isReorderTarget = trackDragOverIdx === trackIdx && trackDragFromIdx !== null && trackDragFromIdx !== trackIdx;
      const isReorderSource = trackDragFromIdx === trackIdx;

      // Highlight if a clip is being dragged onto this track
      const clipDragDs = clipDragStateRef.current;
      const isClipDragTarget = clipDragDs !== null &&
        clipDragDs.currentTrackId === track.id &&
        dragRef.current.type === 'moveClip';

      // Track header
      const headerBg = isEffectTrack
        ? effectHeaderBg
        : isReorderTarget
        ? 'rgba(13,148,136,0.12)'
        : isClipDragTarget
        ? 'rgba(14,165,233,0.14)'
        : isGhostTrack
        ? 'rgba(13,148,136,0.07)'
        : trackHeaderBg;
      ctx.fillStyle = headerBg;
      ctx.globalAlpha = isReorderSource ? 0.4 : 1;
      ctx.fillRect(0, trackY, HEADER_WIDTH, trackH);
      ctx.strokeStyle = isEffectTrack
        ? 'rgba(251,146,60,0.45)'
        : isReorderTarget
        ? 'rgba(13,148,136,0.85)'
        : isClipDragTarget
        ? 'rgba(14,165,233,0.80)'
        : isGhostTrack
        ? 'rgba(13,148,136,0.50)'
        : 'rgba(13,148,136,0.15)';
      ctx.lineWidth = isEffectTrack || isReorderTarget || isClipDragTarget || isGhostTrack ? 1 : 1;
      ctx.strokeRect(0, trackY, HEADER_WIDTH, trackH);
      ctx.globalAlpha = 1;

      // Clip-drag target highlight: full-width border on the track body
      if (isClipDragTarget) {
        ctx.save();
        ctx.strokeStyle = 'rgba(14,165,233,0.65)';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 3]);
        ctx.strokeRect(HEADER_WIDTH + 1, trackY + 1, W - HEADER_WIDTH - 2, trackH - 2);
        ctx.setLineDash([]);
        ctx.restore();
      }

      // Draw reorder indicator line above target row
      if (isReorderTarget && trackDragFromIdx !== null) {
        ctx.fillStyle = '#0d9488';
        ctx.fillRect(0, trackY - 2, W, 3);
      }

      const labelColor = isEffectTrack
        ? 'rgba(251,146,60,0.90)'
        : isAudio
        ? 'rgba(13,148,136,0.75)'
        : isTextTrack
        ? 'rgba(167,139,250,0.80)'
        : isLyricsTrack
        ? 'rgba(192,132,252,0.85)'
        : 'rgba(14,165,233,0.75)';
      ctx.fillStyle = labelColor;
      ctx.font = isEffectTrack ? 'bold 8px sans-serif' : 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 1;
      ctx.globalAlpha = isReorderSource ? 0.4 : 1;
      // Show track type label: VIDEO or AUDIO (not the full name which may be long)
      const trackTypeLabel = isEffectTrack
        ? track.name.toUpperCase()
        : isAudio ? 'AUDIO' : 'VIDEO';
      ctx.fillText(
        trackTypeLabel,
        HEADER_WIDTH / 2,
        trackY + trackH / 2 + (isEffectTrack ? 3 : 4)
      );
      ctx.globalAlpha = 1;

      // Effect type icon (small "fx" label)
      if (isEffectTrack) {
        ctx.fillStyle = 'rgba(251,146,60,0.55)';
        ctx.font = 'bold 7px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('FX', HEADER_WIDTH / 2, trackY + trackH / 2 - 6);
      }

      // Track body background
      const bodyBg = isEffectTrack
        ? 'rgba(251,146,60,0.04)'
        : isAudio
        ? 'rgba(13,148,136,0.04)'
        : isTextTrack
        ? 'rgba(167,139,250,0.04)'
        : isLyricsTrack
        ? 'rgba(192,132,252,0.05)'
        : 'rgba(14,165,233,0.03)';
      ctx.fillStyle = bodyBg;
      ctx.globalAlpha = isReorderSource ? 0.3 : 1;
      ctx.fillRect(HEADER_WIDTH, trackY, timeWidth, trackH);
      ctx.globalAlpha = 1;

      // Track separator
      ctx.fillStyle = isEffectTrack ? 'rgba(251,146,60,0.15)' : trackSeparator;
      ctx.fillRect(HEADER_WIDTH, trackY + trackH - 1, timeWidth, 1);

      // Grid lines
      for (let s = startSec; s <= endSec; s += tickInterval) {
        const x = s * Z - SL + HEADER_WIDTH;
        ctx.strokeStyle = gridLine;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, trackY);
        ctx.lineTo(x, trackY + trackH);
        ctx.stroke();
      }

      // Beat markers on tracks
      if (masterClip && snapModeRef.current === 'beats') {
        const beats = beatsData.get(masterClip.assetId);
        if (beats) {
          ctx.fillStyle = isEffectTrack ? 'rgba(251,146,60,0.18)' : 'rgba(13,148,136,0.12)';
          for (const beat of beats.beats) {
            const x = beat * Z - SL + HEADER_WIDTH;
            if (x < HEADER_WIDTH || x > W) continue;
            ctx.fillRect(x - 0.5, trackY, 1, trackH);
          }
        }
      }

      // ─── Clips ──────────────────────────────────────────────────────────
      for (const clip of track.clips) {
        // A clip is a "text clip" when it carries textContent (regardless of track type)
        const isText = !!clip.textContent || track.type === 'text';
        const isRectangle = !!clip.rectangleStyle;
        const isLyrics = track.type === 'lyrics';
        const clipX = clip.timelineStart * Z - SL + HEADER_WIDTH;
        const clipW = (clip.timelineEnd - clip.timelineStart) * Z;
        if (clipX + clipW < HEADER_WIDTH || clipX > W) continue;

        const isSelected = clip.id === selectedClipId;

        if (isEffectTrack) {
          // ─── Effect clip rendering (thin strip style) ───────────────────
          const cfg = clip.effectConfig;
          const effectPalette: Record<string, { color: string; fill: string; border: string }> = {
            beatZoom:          { color: 'rgba(251,146,60,0.85)', fill: 'rgba(251,146,60,0.25)', border: 'rgba(251,146,60,0.90)' },
            cutout:            { color: 'rgba(217,70,239,0.85)', fill: 'rgba(217,70,239,0.22)', border: 'rgba(217,70,239,0.90)' },
            headStabilization: { color: 'rgba(56,189,248,0.85)', fill: 'rgba(56,189,248,0.22)', border: 'rgba(56,189,248,0.90)' },
            cartoon:           { color: 'rgba(132,204,22,0.85)',  fill: 'rgba(132,204,22,0.22)', border: 'rgba(132,204,22,0.90)' },
          };
          const palette = effectPalette[cfg?.effectType ?? 'beatZoom'] ?? effectPalette.beatZoom;
          const effectColor = palette.color;
          const effectColorFill = palette.fill;
          const effectColorBorder = palette.border;

          const visX = Math.max(clipX, HEADER_WIDTH);
          const visW = Math.min(clipX + clipW, W) - visX;
          const clipTop = trackY + 2;
          const clipH = trackH - 4;

          ctx.globalAlpha = (cfg?.enabled === false ? 0.4 : 1) * (isReorderSource ? 0.4 : 1);
          ctx.fillStyle = isSelected ? effectColorFill.replace('0.2', '0.4') : effectColorFill;
          ctx.fillRect(visX, clipTop, visW, clipH);

          // Striped pattern for effect clips
          ctx.save();
          ctx.beginPath();
          ctx.rect(visX, clipTop, visW, clipH);
          ctx.clip();
          ctx.strokeStyle = effectColorFill;
          ctx.lineWidth = 1;
          for (let px = visX - clipH; px < visX + visW + clipH; px += 8) {
            ctx.beginPath();
            ctx.moveTo(px, clipTop + clipH);
            ctx.lineTo(px + clipH, clipTop);
            ctx.stroke();
          }
          ctx.restore();

          ctx.strokeStyle = isSelected ? effectColorBorder : effectColorFill.replace('0.2', '0.6');
          ctx.lineWidth = isSelected ? 2 : 1;
          ctx.strokeRect(visX + 0.5, clipTop + 0.5, visW - 1, clipH - 1);

          // Label
          ctx.save();
          ctx.beginPath();
          ctx.rect(visX, clipTop, visW, clipH);
          ctx.clip();
          ctx.font = 'bold 9px sans-serif';
          ctx.textAlign = 'left';
          ctx.fillStyle = effectColor;
          const effectLabelMap: Record<string, string> = {
            beatZoom: 'BeatZoom',
            cutout: 'Cutout',
            headStabilization: 'HeadStab',
            cartoon: 'Cartoon',
          };
          const effectLabel = effectLabelMap[cfg?.effectType ?? ''] ?? (cfg?.effectType ?? 'FX');
          ctx.fillText(effectLabel, visX + 4, clipTop + clipH / 2 + 3);
          ctx.restore();

          // Selection handles
          if (isSelected) {
            ctx.fillStyle = effectColorBorder;
            ctx.fillRect(visX, clipTop, 3, clipH);
            ctx.fillRect(Math.min(clipX + clipW, W) - 3, clipTop, 3, clipH);
          }

          ctx.globalAlpha = 1;
        } else {
          // ─── Regular clip rendering (video / audio / text) ────────────────
          // Highlight video clips covered by selected effect clip
          const isCoveredByEffect = !isEffectTrack &&
            track.type === 'video' &&
            selectedEffectClipRange !== null &&
            clip.timelineStart < selectedEffectClipRange.end &&
            clip.timelineEnd > selectedEffectClipRange.start;

          // Text, rectangle, and lyrics clips get distinct colors; others use asset-based color
          const rectFill = clip.rectangleStyle?.color ?? '#3b82f6';
          const color = isRectangle ? rectFill : isText ? '#a78bfa' : isLyrics ? '#c084fc' : getClipColor(clip.assetId);

          const visX = Math.max(clipX, HEADER_WIDTH);
          const visW = Math.min(clipX + clipW, W) - visX;
          const clipTop = trackY + 2;
          const clipH = TRACK_HEIGHT - 4;

          // Base fill (lower opacity for video so thumbnails show through)
          ctx.fillStyle = isSelected ? lightenColor(color, 20) : color;
          ctx.globalAlpha = isAudio ? 0.45 : (isText || isLyrics || isRectangle) ? 0.75 : 0.5;
          ctx.globalAlpha *= isReorderSource ? 0.4 : 1;
          ctx.fillRect(visX, clipTop, visW, clipH);
          ctx.globalAlpha = 1;

          const asset = propsRef.current.assets.find((a) => a.id === clip.assetId);

          // ─── Video thumbnails (filmstrip) ────────────────────────────────
          if (!isAudio && !isText && !isRectangle && asset?.proxyPath) {
            const ar = asset.width && asset.height ? asset.width / asset.height : 9 / 16;
            const thumbH = clipH;
            const thumbW = Math.max(1, Math.round(thumbH * ar));
            const frameInterval = thumbW / Z;
            const firstSourceTime = Math.floor(clip.sourceStart / frameInterval) * frameInterval;
            const maxFrames = Math.ceil(clipW / thumbW) + 3;

            ctx.save();
            ctx.beginPath();
            ctx.rect(visX, clipTop, visW, clipH);
            ctx.clip();

            for (let fi = 0; fi <= maxFrames; fi++) {
              const sourceTime = firstSourceTime + fi * frameInterval;
              if (sourceTime > clip.sourceEnd + 0.01) break;

              const timeFromClipStart = sourceTime - clip.sourceStart;
              const frameX = clipX + timeFromClipStart * Z;
              if (frameX + thumbW < visX) continue;
              if (frameX > visX + visW) break;

              const thumbKey = `${clip.assetId}:${sourceTime.toFixed(1)}`;
              const bitmap = thumbnailCacheRef.current.get(thumbKey);

              if (bitmap) {
                ctx.globalAlpha = isReorderSource ? 0.35 : 0.92;
                ctx.drawImage(bitmap, frameX, clipTop, thumbW, thumbH);
                ctx.globalAlpha = 1;
              } else {
                requestThumbnail(clip.assetId, asset.proxyPath, sourceTime, thumbW, thumbH);
              }
            }

            // Subtle tint overlay so the clip color is still identifiable
            ctx.globalAlpha = isSelected ? 0.28 : 0.15;
            ctx.fillStyle = isSelected ? lightenColor(color, 20) : color;
            ctx.fillRect(visX, clipTop, visW, clipH);
            ctx.globalAlpha = 1;

            ctx.restore();
          }

          if (isAudio) {
            const wf = waveforms.get(clip.assetId);
            if (wf && wf.samples.length > 0) {
              drawWaveformOnClip(ctx, wf, clip, Z, SL, trackY, TRACK_HEIGHT, HEADER_WIDTH, W);
            }
          }

          // Effect coverage highlight on video clips
          if (isCoveredByEffect) {
            ctx.save();
            const covStart = Math.max(clip.timelineStart, selectedEffectClipRange!.start);
            const covEnd = Math.min(clip.timelineEnd, selectedEffectClipRange!.end);
            const covX = Math.max(covStart * Z - SL + HEADER_WIDTH, HEADER_WIDTH);
            const covW = Math.min(covEnd * Z - SL + HEADER_WIDTH, W) - covX;
            if (covW > 0) {
              ctx.globalAlpha = 0.35;
              ctx.fillStyle = 'rgba(251,146,60,0.6)';
              ctx.fillRect(covX, clipTop, covW, clipH);
            }
            ctx.restore();
          }

          ctx.strokeStyle = isSelected
            ? 'rgba(13,148,136,0.9)'
            : isCoveredByEffect
            ? 'rgba(251,146,60,0.70)'
            : isAudio
            ? 'rgba(13,148,136,0.35)'
            : lightenColor(color, 40);
          ctx.lineWidth = isSelected || isCoveredByEffect ? 2 : 1;
          ctx.strokeRect(visX + 0.5, clipTop + 0.5, visW - 1, clipH - 1);

          ctx.save();
          ctx.beginPath();
          ctx.rect(visX, trackY, visW, TRACK_HEIGHT);
          ctx.clip();

          ctx.font = (isText || isLyrics || isRectangle) ? 'bold 11px sans-serif' : '11px sans-serif';
          ctx.textAlign = 'left';
          const label = isLyrics
            ? (clip.lyricsContent ? `♪ "${clip.lyricsContent.slice(0, 30)}${clip.lyricsContent.length > 30 ? '…' : ''}"` : '♪ Lyrics')
            : isRectangle
            ? `▬ Rectangle`
            : isText
            ? (clip.textContent ? `T "${clip.textContent}"` : 'T Text')
            : (asset?.name ?? clip.assetId);

          // Text shadow for readability over thumbnails on video clips
          if (!isAudio && !isText && !isRectangle) {
            ctx.shadowColor = 'rgba(0,0,0,0.9)';
            ctx.shadowBlur = 4;
          }
          ctx.fillStyle = (isText || isLyrics || isRectangle) ? 'rgba(255,255,255,0.90)' : isAudio ? 'rgba(13,148,136,0.95)' : 'rgba(255,255,255,0.95)';
          ctx.fillText(label, visX + 4, trackY + 14);
          ctx.shadowBlur = 0;


          ctx.restore();

          if (isSelected) {
            ctx.fillStyle = 'rgba(13,148,136,0.9)';
            ctx.fillRect(visX, clipTop, 4, clipH);
            ctx.fillRect(Math.min(clipX + clipW, W) - 4, clipTop, 4, clipH);
          }
        }

        // ─── Clip half-hover overlay (during moveClip drag) ─────────────
        const hover = clipHoverRef.current;
        if (hover && hover.clip.id === clip.id) {
          const hClipTop = trackY + 2;
          const hClipH = (isEffectTrack ? trackH : TRACK_HEIGHT) - 4;
          const midX = ((hover.clip.timelineStart + hover.clip.timelineEnd) / 2) * Z - SL + HEADER_WIDTH;

          // Highlight the active half
          const halfLeft = hover.half === 'left';
          const halfStartX = halfLeft ? Math.max(clipX, HEADER_WIDTH) : Math.max(midX, HEADER_WIDTH);
          const halfEndX = halfLeft ? Math.min(midX, W) : Math.min(clipX + clipW, W);
          const halfW = halfEndX - halfStartX;
          if (halfW > 0) {
            ctx.globalAlpha = 0.38;
            ctx.fillStyle = hover.blocked ? 'rgba(239,68,68,0.6)' : 'rgba(13,148,136,0.4)';
            ctx.fillRect(halfStartX, hClipTop, halfW, hClipH);
            ctx.globalAlpha = 1;
          }

          // Midpoint divider line
          if (midX >= HEADER_WIDTH && midX <= W) {
            ctx.globalAlpha = 0.75;
            ctx.strokeStyle = hover.blocked ? 'rgba(239,68,68,0.9)' : 'rgba(255,255,255,0.8)';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 3]);
            ctx.beginPath();
            ctx.moveTo(midX, hClipTop);
            ctx.lineTo(midX, hClipTop + hClipH);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.globalAlpha = 1;
          }
        }
      }

      // ─── Ghost clip on existing track ──────────────────────────────────
      if (ghost && ghost.trackId === track.id) {
        drawGhostClip(ctx, ghost, Z, SL, trackY, trackH, HEADER_WIDTH, W);
      }

      trackY += trackH;
    }

    // ─── Ghost clip on new track zone (below all existing tracks) ─────────
    if (ghost && ghost.trackId === null) {
      const newTrackY = RULER_HEIGHT - ST + getTotalTracksHeight(tracks);
      const isAudioGhost = ghost.assetType === 'audio';

      // Draw new track header
      ctx.fillStyle = isAudioGhost ? 'rgba(13,148,136,0.08)' : 'rgba(14,165,233,0.07)';
      ctx.fillRect(0, newTrackY, HEADER_WIDTH, TRACK_HEIGHT);
      ctx.strokeStyle = isAudioGhost ? 'rgba(13,148,136,0.45)' : 'rgba(14,165,233,0.45)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(1, newTrackY + 1, HEADER_WIDTH - 2, TRACK_HEIGHT - 2);
      ctx.setLineDash([]);

      ctx.fillStyle = isAudioGhost ? 'rgba(13,148,136,0.65)' : 'rgba(14,165,233,0.65)';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('+ NEW', HEADER_WIDTH / 2, newTrackY + TRACK_HEIGHT / 2 + 4);

      // Draw new track body background
      ctx.fillStyle = isAudioGhost ? 'rgba(13,148,136,0.04)' : 'rgba(14,165,233,0.03)';
      ctx.fillRect(HEADER_WIDTH, newTrackY, timeWidth, TRACK_HEIGHT);

      // Dashed border for new track area
      ctx.strokeStyle = isAudioGhost ? 'rgba(13,148,136,0.22)' : 'rgba(14,165,233,0.22)';
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(HEADER_WIDTH + 0.5, newTrackY + 0.5, timeWidth - 1, TRACK_HEIGHT - 1);
      ctx.setLineDash([]);

      // Ghost clip inside new track
      drawGhostClip(ctx, ghost, Z, SL, newTrackY, TRACK_HEIGHT, HEADER_WIDTH, W);
    }

    // ─── New-track zone indicator during clip cross-track drag ─────────────
    {
      const cds = clipDragStateRef.current;
      if (cds && cds.currentTrackId === '__new__' && dragRef.current.type === 'moveClip') {
        const newTrackY = RULER_HEIGHT - ST + getTotalTracksHeight(tracks);
        const isAudio = cds.sourceTrackType === 'audio';

        ctx.fillStyle = isAudio ? 'rgba(13,148,136,0.08)' : 'rgba(14,165,233,0.07)';
        ctx.fillRect(0, newTrackY, HEADER_WIDTH, TRACK_HEIGHT);
        ctx.strokeStyle = isAudio ? 'rgba(13,148,136,0.45)' : 'rgba(14,165,233,0.45)';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(1, newTrackY + 1, HEADER_WIDTH - 2, TRACK_HEIGHT - 2);
        ctx.setLineDash([]);
        ctx.fillStyle = isAudio ? 'rgba(13,148,136,0.65)' : 'rgba(14,165,233,0.65)';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('+ NEW', HEADER_WIDTH / 2, newTrackY + TRACK_HEIGHT / 2 + 4);

        ctx.fillStyle = isAudio ? 'rgba(13,148,136,0.04)' : 'rgba(14,165,233,0.03)';
        ctx.fillRect(HEADER_WIDTH, newTrackY, timeWidth, TRACK_HEIGHT);
        ctx.strokeStyle = isAudio ? 'rgba(13,148,136,0.22)' : 'rgba(14,165,233,0.22)';
        ctx.lineWidth = 1;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(HEADER_WIDTH + 0.5, newTrackY + 0.5, timeWidth - 1, TRACK_HEIGHT - 1);
        ctx.setLineDash([]);
      }
    }

    // ─── Insert-between-rows indicator during clip cross-track drag ────────
    {
      const cds = clipDragStateRef.current;
      if (cds && cds.currentTrackId === '__insert__' && cds.insertAfterIdx !== null && dragRef.current.type === 'moveClip') {
        const insertIdx = cds.insertAfterIdx;
        // Calculate Y of the boundary: bottom of track at insertIdx, or top of first track if -1
        let insertY = RULER_HEIGHT - ST;
        if (insertIdx === -1) {
          // Before all tracks: top edge of first track
        } else {
          for (let i = 0; i <= insertIdx && i < tracks.length; i++) {
            insertY += getTrackH(tracks[i]);
          }
        }
        const isAudio = cds.sourceTrackType === 'audio';
        const lineColor = isAudio ? 'rgba(13,148,136,0.9)' : 'rgba(14,165,233,0.9)';
        const bgColor = isAudio ? 'rgba(13,148,136,0.06)' : 'rgba(14,165,233,0.05)';

        // Bright horizontal insert line spanning full width
        ctx.fillStyle = lineColor;
        ctx.fillRect(0, insertY - 2, W, 4);

        // Ghost row hint: semi-transparent band below the line
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, insertY + 2, W, TRACK_HEIGHT - 4);

        // "+ NEW ROW" label in the header area
        ctx.save();
        ctx.fillStyle = isAudio ? 'rgba(13,148,136,0.50)' : 'rgba(14,165,233,0.50)';
        ctx.fillRect(0, insertY + 2, HEADER_WIDTH, TRACK_HEIGHT - 4);
        ctx.strokeStyle = isAudio ? 'rgba(13,148,136,0.55)' : 'rgba(14,165,233,0.55)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(1, insertY + 3, HEADER_WIDTH - 2, TRACK_HEIGHT - 6);
        ctx.setLineDash([]);
        ctx.fillStyle = isAudio ? 'rgba(13,148,136,0.9)' : 'rgba(14,165,233,0.9)';
        ctx.font = 'bold 9px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('+ NEW', HEADER_WIDTH / 2, insertY + TRACK_HEIGHT / 2 + 3);
        ctx.restore();
      }
    }

    // ─── Work area dim overlay on tracks ──────────────────────────────────
    if (workArea) {
      const waS = workArea.start * Z - SL + HEADER_WIDTH;
      const waE = workArea.end * Z - SL + HEADER_WIDTH;
      const totalTrackH = getTotalTracksHeight(tracks);

      ctx.fillStyle = workAreaTrackDim;

      const leftEnd = Math.min(Math.max(waS, HEADER_WIDTH), W);
      if (leftEnd > HEADER_WIDTH) {
        ctx.fillRect(HEADER_WIDTH, RULER_HEIGHT, leftEnd - HEADER_WIDTH, totalTrackH - ST);
      }

      const rightStart = Math.max(Math.min(waE, W), HEADER_WIDTH);
      if (rightStart < W) {
        ctx.fillRect(rightStart, RULER_HEIGHT, W - rightStart, totalTrackH - ST);
      }
    }

    // ─── End track area clip ───────────────────────────────────────────────
    ctx.restore();

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
  }, [trackDragFromIdx, trackDragOverIdx]);

  // Resize canvas
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const ro = new ResizeObserver(() => {
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
      containerHeightRef.current = container.clientHeight;
      // Clamp scrollTop in case content shrank
      setScrollTop((st) => Math.max(0, Math.min(st, canvasContentHeightRef.current - container.clientHeight)));
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
      const ST = scrollTopRef.current;

      let trackY = RULER_HEIGHT - ST;
      for (const track of project.tracks) {
        const th = getTrackH(track);
        if (y >= trackY && y < trackY + th) {
          const t = (x + SL - HEADER_WIDTH) / Z;
          for (const clip of track.clips) {
            if (t >= clip.timelineStart && t <= clip.timelineEnd) {
              return { clip, track };
            }
          }
        }
        trackY += th;
      }
      return null;
    },
    [project]
  );

  // ─── Shared pointer-down logic (mouse + touch) ─────────────────────────
  // Returns true if a drag interaction was started (clip/ruler), false if empty area
  const handlePointerDown = useCallback(
    (x: number, y: number, isTouch: boolean): boolean => {
      const Z = zoomRef.current;
      const SL = scrollLeftRef.current;
      const handleSize = isTouch ? TOUCH_HANDLE : 8;
      const waHit = isTouch ? TOUCH_WA_HANDLE_HIT : WA_HANDLE_HIT;

      if (y < RULER_HEIGHT) {
        const wa = workAreaRef.current;
        if (wa) {
          const waS = wa.start * Z - SL + HEADER_WIDTH;
          const waE = wa.end * Z - SL + HEADER_WIDTH;
          if (Math.abs(x - waS) < waHit) {
            setDrag({ type: 'workAreaStart' });
            return true;
          }
          if (Math.abs(x - waE) < waHit) {
            setDrag({ type: 'workAreaEnd' });
            return true;
          }
        }
        const t = (x + SL - HEADER_WIDTH) / Z;
        onSeek(Math.max(0, t));
        setDrag({ type: 'seek' });
        return true;
      }

      if (x < HEADER_WIDTH) return false;

      const hit = getClipAtPosition(x, y);
      if (!hit) {
        onClipSelect(null);
        return false;
      }

      const { clip, track } = hit;
      onClipSelect(clip.id);

      const clipXStart = clip.timelineStart * Z - SL + HEADER_WIDTH;
      const clipXEnd = clip.timelineEnd * Z - SL + HEADER_WIDTH;

      if (x < clipXStart + handleSize) {
        setDrag({ type: 'trimLeft', clipId: clip.id });
      } else if (x > clipXEnd - handleSize) {
        setDrag({ type: 'trimRight', clipId: clip.id });
      } else {
        const offsetSeconds = (x + SL - HEADER_WIDTH) / Z - clip.timelineStart;
        const leftAdjacentId = track.clips.find(
          (c) => c.id !== clip.id && Math.abs(c.timelineEnd - clip.timelineStart) < 0.001
        )?.id ?? null;
        const rightAdjacentId = track.clips.find(
          (c) => c.id !== clip.id && Math.abs(c.timelineStart - clip.timelineEnd) < 0.001
        )?.id ?? null;
        setDrag({ type: 'moveClip', clipId: clip.id, trackId: track.id, offsetSeconds, leftAdjacentId, rightAdjacentId });
        // Initialise cross-track drag state
        clipDragStateRef.current = { currentTrackId: track.id, sourceTrackType: track.type, insertAfterIdx: null, leftAdjacentId, rightAdjacentId };
      }
      return true;
    },
    [getClipAtPosition, onClipSelect, onSeek]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = canvasRef.current!.getBoundingClientRect();
      handlePointerDown(e.clientX - rect.left, e.clientY - rect.top, false);
    },
    [handlePointerDown]
  );

  // ─── Shared pointer-move logic (mouse + touch) ─────────────────────────
  const handlePointerMove = useCallback(
    (x: number, y: number, isTouch: boolean) => {
      if (!project) return;
      const Z = zoomRef.current;
      const SL = scrollLeftRef.current;
      const d = dragRef.current;
      const snapThreshold = (isTouch ? TOUCH_SNAP_THRESHOLD_PX : SNAP_THRESHOLD_PX) / Z;

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
        let clipTrack: Track | undefined;
        for (const tr of project.tracks) {
          clip = tr.clips.find((c) => c.id === d.clipId);
          if (clip) { clipTrack = tr; break; }
        }
        if (!clip || !clipTrack) return;

        const dur = clip.timelineEnd - clip.timelineStart;
        const snapTargets = getSnapTargets(d.clipId);
        t = snap(t, snapTargets, snapThreshold);
        t = snap(t + dur, snapTargets, snapThreshold) - dur;
        t = Math.max(0, t);

        // ── Cross-track detection ─────────────────────────────────────────
        const ds = clipDragStateRef.current;
        const currentTrackId = ds?.currentTrackId ?? d.trackId;
        const tracks = project.tracks;
        const ST2 = scrollTopRef.current;

        // ── Insert-zone detection: cursor near boundary between tracks ────
        // Only when source is not an effect clip
        let insertAfterIdx: number | null = null;
        if (ds && ds.sourceTrackType !== 'effect') {
          let ty = RULER_HEIGHT - ST2;
          for (let i = 0; i < tracks.length; i++) {
            const th = getTrackH(tracks[i]);
            const boundary = ty + th;
            // Near the bottom of track i (boundary between i and i+1) – not the last track
            if (i < tracks.length - 1 && Math.abs(y - boundary) < INSERT_ZONE_PX) {
              insertAfterIdx = i;
              break;
            }
            // Near the very top of the first track (insert before all)
            if (i === 0 && Math.abs(y - ty) < INSERT_ZONE_PX) {
              insertAfterIdx = -1;
              break;
            }
            ty += th;
          }
        }

        if (insertAfterIdx !== null) {
          // Cursor is in an insert zone between two rows
          if (ds && (currentTrackId !== '__insert__' || ds.insertAfterIdx !== insertAfterIdx)) {
            ds.currentTrackId = '__insert__';
            ds.insertAfterIdx = insertAfterIdx;
            ds.leftAdjacentId = null;
            ds.rightAdjacentId = null;
          }
          clipHoverRef.current = null;
          onClipUpdate(d.clipId, { timelineStart: t, timelineEnd: t + dur });
          draw();
          return;
        }

        const targetResult = getTrackAtY(y);

        if (targetResult && targetResult.track.id !== currentTrackId) {
          // Cursor moved to a different existing track – check type compatibility
          if (ds && !isCompatibleTrackType(ds.sourceTrackType, targetResult.track)) {
            // Incompatible track type – keep clip on current track, just update time
            onClipUpdate(d.clipId, { timelineStart: t, timelineEnd: t + dur });
            draw();
            return;
          }
          if (ds) {
            ds.currentTrackId = targetResult.track.id;
            ds.insertAfterIdx = null;
            ds.leftAdjacentId = null;
            ds.rightAdjacentId = null;
          }
          clipHoverRef.current = null;
          onMoveClipToTrack(d.clipId, targetResult.track.id, t, t + dur);
          draw();
          return;
        }

        if (!targetResult && y > RULER_HEIGHT) {
          // Cursor is below all existing tracks → new-track zone
          // Don't move the clip yet; mark intent and update X position only
          if (ds && currentTrackId !== '__new__') {
            ds.currentTrackId = '__new__';
            ds.insertAfterIdx = null;
            ds.leftAdjacentId = null;
            ds.rightAdjacentId = null;
          }
          clipHoverRef.current = null;
          onClipUpdate(d.clipId, { timelineStart: t, timelineEnd: t + dur });
          draw();
          return;
        }

        // Returning from '__new__' or '__insert__' zone into an existing compatible track
        if (targetResult && (currentTrackId === '__new__' || currentTrackId === '__insert__')) {
          if (ds && !isCompatibleTrackType(ds.sourceTrackType, targetResult.track)) {
            onClipUpdate(d.clipId, { timelineStart: t, timelineEnd: t + dur });
            draw();
            return;
          }
          if (ds) {
            ds.currentTrackId = targetResult.track.id;
            ds.insertAfterIdx = null;
            ds.leftAdjacentId = null;
            ds.rightAdjacentId = null;
          }
          clipHoverRef.current = null;
          onMoveClipToTrack(d.clipId, targetResult.track.id, t, t + dur);
          draw();
          return;
        }

        // ── Half-hover detection (same track) ────────────────────────────
        const leftAdjacentId = ds?.leftAdjacentId ?? d.leftAdjacentId;
        const rightAdjacentId = ds?.rightAdjacentId ?? d.rightAdjacentId;
        const cursorTime = (x + SL - HEADER_WIDTH) / Z;
        const hoveredClip = clipTrack.clips.find(
          (c) => c.id !== d.clipId && cursorTime >= c.timelineStart && cursorTime <= c.timelineEnd
        );
        if (hoveredClip) {
          const midpoint = (hoveredClip.timelineStart + hoveredClip.timelineEnd) / 2;
          const half: 'left' | 'right' = cursorTime < midpoint ? 'left' : 'right';
          const blocked =
            (half === 'left' && hoveredClip.id === rightAdjacentId) ||
            (half === 'right' && hoveredClip.id === leftAdjacentId);
          clipHoverRef.current = { clip: hoveredClip, half, blocked };
          if (!blocked) {
            if (half === 'left') {
              t = Math.max(0, hoveredClip.timelineStart - dur);
            } else {
              t = hoveredClip.timelineEnd;
            }
          }
        } else {
          clipHoverRef.current = null;
        }

        onClipUpdate(d.clipId, { timelineStart: t, timelineEnd: t + dur });
        draw();
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

        const minTimelineStart = Math.max(0, clip.timelineStart - clip.sourceStart);
        const snapTargets = getSnapTargets(d.clipId);
        t = snap(t, snapTargets, snapThreshold);
        t = clamp(t, minTimelineStart, clip.timelineEnd - 0.1);

        const dt = t - clip.timelineStart;
        onClipUpdate(d.clipId, { timelineStart: t, sourceStart: Math.max(0, clip.sourceStart + dt) });
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
    [project, assets, getSnapTargets, onClipUpdate, onMoveClipToTrack, onSeek, onWorkAreaChange, draw, getTrackAtY, getTotalTracksHeight]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = canvasRef.current!.getBoundingClientRect();
      handlePointerMove(e.clientX - rect.left, e.clientY - rect.top, false);
    },
    [handlePointerMove]
  );

  const handleMouseUp = useCallback(() => {
    clipHoverRef.current = null;
    const ds = clipDragStateRef.current;
    const d = dragRef.current;
    if (ds && d.type === 'moveClip') {
      if (ds.currentTrackId === '__new__') {
        // Dragged below all tracks → create new track at end
        if (project) {
          for (const tr of project.tracks) {
            const c = tr.clips.find((cl) => cl.id === d.clipId);
            if (c) {
              onMoveClipToNewTrack(d.clipId, ds.sourceTrackType, c.timelineStart, c.timelineEnd);
              break;
            }
          }
        }
      } else if (ds.currentTrackId === '__insert__' && ds.insertAfterIdx !== null) {
        // Dragged to insert zone → create new track at specific position
        if (project) {
          for (const tr of project.tracks) {
            const c = tr.clips.find((cl) => cl.id === d.clipId);
            if (c) {
              onMoveClipToNewTrackAt(d.clipId, ds.sourceTrackType, c.timelineStart, c.timelineEnd, ds.insertAfterIdx);
              break;
            }
          }
        }
      }
    }
    clipDragStateRef.current = null;
    setDrag({ type: 'none' });
  }, [project, onMoveClipToNewTrack, onMoveClipToNewTrackAt]);

  // ─── Touch handlers ────────────────────────────────────────────────────────

  const handleTouchStart = useCallback(
    (e: React.TouchEvent<HTMLCanvasElement>) => {
      e.preventDefault(); // prevent scroll / zoom interference
      isTouchDeviceRef.current = true;

      if (e.touches.length === 2) {
        // Pinch-to-zoom: record initial distance
        touchModeRef.current = 'pinch';
        const dx = e.touches[1].clientX - e.touches[0].clientX;
        const dy = e.touches[1].clientY - e.touches[0].clientY;
        pinchStartDistRef.current = Math.sqrt(dx * dx + dy * dy);
        pinchStartZoomRef.current = zoomRef.current;
        return;
      }

      if (e.touches.length === 1) {
        const touch = e.touches[0];
        const rect = canvasRef.current!.getBoundingClientRect();
        const x = touch.clientX - rect.left;
        const y = touch.clientY - rect.top;

        // Decide: drag (clip/ruler) or scroll (empty area)
        let shouldDrag = false;
        if (y < RULER_HEIGHT) {
          shouldDrag = true; // ruler always triggers seek or work-area drag
        } else if (x >= HEADER_WIDTH) {
          const hit = getClipAtPosition(x, y);
          if (hit) shouldDrag = true;
        }

        if (shouldDrag) {
          touchModeRef.current = 'drag';
          handlePointerDown(x, y, true);
        } else {
          // Start a pan (horizontal + vertical)
          touchModeRef.current = 'scroll';
          touchScrollStartClientXRef.current = touch.clientX;
          touchScrollStartClientYRef.current = touch.clientY;
          touchScrollStartSLRef.current = scrollLeftRef.current;
          touchScrollStartSTRef.current = scrollTopRef.current;
        }
      }
    },
    [getClipAtPosition, handlePointerDown]
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent<HTMLCanvasElement>) => {
      e.preventDefault();

      if (e.touches.length === 2 && touchModeRef.current === 'pinch' && pinchStartDistRef.current !== null) {
        // Pinch zoom
        const dx = e.touches[1].clientX - e.touches[0].clientX;
        const dy = e.touches[1].clientY - e.touches[0].clientY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const scale = dist / pinchStartDistRef.current;
        setZoom((z) => clamp(pinchStartZoomRef.current * scale, MIN_ZOOM, MAX_ZOOM));
        return;
      }

      if (e.touches.length === 1) {
        const touch = e.touches[0];

        if (touchModeRef.current === 'scroll') {
          // Horizontal + vertical pan
          const dx = touch.clientX - touchScrollStartClientXRef.current;
          const dy = touch.clientY - touchScrollStartClientYRef.current;
          setScrollLeft(Math.max(0, touchScrollStartSLRef.current - dx));
          setScrollTop(() => {
            const maxST = Math.max(0, canvasContentHeightRef.current - containerHeightRef.current);
            return clamp(touchScrollStartSTRef.current - dy, 0, maxST);
          });
          return;
        }

        if (touchModeRef.current === 'drag') {
          const rect = canvasRef.current!.getBoundingClientRect();
          const x = touch.clientX - rect.left;
          const y = touch.clientY - rect.top;
          handlePointerMove(x, y, true);
        }
      }
    },
    [handlePointerMove]
  );

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      if (e.touches.length === 0) {
        pinchStartDistRef.current = null;
        touchModeRef.current = 'none';
        // End any active drag – same new-track logic as mouse up
        clipHoverRef.current = null;
        const ds = clipDragStateRef.current;
        const d = dragRef.current;
        if (ds && d.type === 'moveClip' && ds.currentTrackId === '__new__') {
          if (project) {
            for (const tr of project.tracks) {
              const c = tr.clips.find((cl) => cl.id === d.clipId);
              if (c) {
                onMoveClipToNewTrack(d.clipId, ds.sourceTrackType, c.timelineStart, c.timelineEnd);
                break;
              }
            }
          }
        }
        clipDragStateRef.current = null;
        setDrag({ type: 'none' });
      }
    },
    [project, onMoveClipToNewTrack]
  );

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      // Ctrl/Meta + scroll → zoom
      const factor = e.deltaY > 0 ? 0.85 : 1.18;
      setZoom((z) => clamp(z * factor, MIN_ZOOM, MAX_ZOOM));
    } else {
      // Horizontal scroll (trackpad swipe left/right or Shift+wheel)
      if (e.deltaX !== 0) {
        setScrollLeft((s) => Math.max(0, s + e.deltaX));
      }
      // Vertical scroll (trackpad swipe up/down)
      if (e.deltaY !== 0) {
        setScrollTop((st) => {
          const maxST = Math.max(0, canvasContentHeightRef.current - containerHeightRef.current);
          return clamp(st + e.deltaY, 0, maxST);
        });
      }
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
    const snapTargets = getSnapTargets();
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
  }, [draggedAsset, getTrackAtY, getSnapTargets, draw]);

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

  // ─── Context menu state ───────────────────────────────────────────────────
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    clipId: string;
    time: number;
  } | null>(null);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      const rect = canvasRef.current!.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const Z = zoomRef.current;
      const SL = scrollLeftRef.current;

      const hit = getClipAtPosition(x, y);
      if (hit) {
        const t = (x + SL - HEADER_WIDTH) / Z;
        setContextMenu({ x: e.clientX, y: e.clientY, clipId: hit.clip.id, time: t });
      } else {
        setContextMenu(null);
      }
    },
    [getClipAtPosition]
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

  // ─── Track reorder handlers ────────────────────────────────────────────

  const handleTrackDragStart = useCallback((idx: number) => {
    setTrackDragFromIdx(idx);
  }, []);

  const handleTrackDragOver = useCallback((e: React.DragEvent<HTMLDivElement>, idx: number) => {
    e.preventDefault();
    e.stopPropagation(); // prevent canvas drag-over
    setTrackDragOverIdx(idx);
  }, []);

  const handleTrackDragEnd = useCallback(() => {
    setTrackDragFromIdx(null);
    setTrackDragOverIdx(null);
  }, []);

  const handleTrackDrop = useCallback((e: React.DragEvent<HTMLDivElement>, toIdx: number) => {
    e.preventDefault();
    e.stopPropagation();
    if (trackDragFromIdx !== null && trackDragFromIdx !== toIdx) {
      onTrackReorder(trackDragFromIdx, toIdx);
    }
    setTrackDragFromIdx(null);
    setTrackDragOverIdx(null);
  }, [trackDragFromIdx, onTrackReorder]);

  // Compute total content height (tracks + ruler) for vertical scroll clamping
  const totalTracksH = project ? getTotalTracksHeight(project.tracks) : TRACK_HEIGHT;
  const extraRow = ghostRef.current?.trackId === null ? 1 : 0;
  const canvasContentHeight = RULER_HEIGHT + totalTracksH + (extraRow ? TRACK_HEIGHT : 0) + 8;
  canvasContentHeightRef.current = canvasContentHeight;

  return (
    <div style={{ background: 'var(--surface-bg)', display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Toolbar */}
      <div
        style={{
          height: isTouchDeviceRef.current ? 40 : 28,
          minHeight: 36,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          paddingLeft: 8,
          paddingRight: 8,
          borderBottom: '1px solid var(--border-subtle)',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 10, color: 'var(--text-muted)', marginRight: 4, userSelect: 'none' }}>
          Magnet:
        </span>
        {(
          [
            { mode: 'none' as SnapMode, label: 'Off' },
            { mode: 'beats' as SnapMode, label: 'Beats' },
            { mode: 'clips' as SnapMode, label: 'Clips' },
          ] as const
        ).map(({ mode, label }) => (
          <button
            key={mode}
            onClick={() => setSnapMode(mode)}
            style={{
              fontSize: 11,
              padding: '5px 10px',
              borderRadius: 6,
              border: snapMode === mode ? '1px solid rgba(13,148,136,0.55)' : '1px solid var(--border-default)',
              background: snapMode === mode ? 'rgba(13,148,136,0.10)' : 'transparent',
              color: snapMode === mode ? '#0d9488' : 'var(--text-muted)',
              cursor: 'pointer',
              userSelect: 'none',
              lineHeight: '18px',
              touchAction: 'manipulation',
              WebkitTapHighlightColor: 'transparent',
            } as React.CSSProperties}
          >
            {label}
          </button>
        ))}

      </div>

      {/* Canvas – fills remaining height; internal scrollTop handles vertical panning */}
      <div
        ref={containerRef}
        className="relative"
        style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}
      >
        <canvas
          ref={canvasRef}
          style={{ cursor, display: 'block', width: '100%', height: '100%', touchAction: 'none' }}
          onMouseDown={handleMouseDown}
          onMouseMove={(e) => { handleMouseMove(e); handleMouseMoveForCursor(e); }}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onContextMenu={handleContextMenu}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        />

        {/* ─── Right-click context menu ─────────────────────────────────── */}
        {contextMenu && (
          <>
            {/* Backdrop to dismiss on outside click */}
            <div
              style={{ position: 'fixed', inset: 0, zIndex: 999 }}
              onClick={() => setContextMenu(null)}
              onContextMenu={(e) => { e.preventDefault(); setContextMenu(null); }}
            />
            <div
              style={{
                position: 'fixed',
                left: contextMenu.x,
                top: contextMenu.y,
                zIndex: 1000,
                background: 'var(--bg-elevated, #1e1e2e)',
                border: '1px solid var(--border-default, rgba(255,255,255,0.12))',
                borderRadius: 8,
                boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                minWidth: 160,
                padding: '4px 0',
                userSelect: 'none',
              }}
            >
              <button
                onClick={() => {
                  onSplit(contextMenu.clipId, contextMenu.time);
                  setContextMenu(null);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  width: '100%',
                  padding: '8px 14px',
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-primary, #e2e8f0)',
                  fontSize: 13,
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(13,148,136,0.15)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
              >
                {/* Scissors icon */}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="6" cy="6" r="3"/>
                  <circle cx="6" cy="18" r="3"/>
                  <line x1="20" y1="4" x2="8.12" y2="15.88"/>
                  <line x1="14.47" y1="14.48" x2="20" y2="20"/>
                  <line x1="8.12" y1="8.12" x2="12" y2="12"/>
                </svg>
                Split clip
              </button>
            </div>
          </>
        )}

        {/* ─── Track header drag handles (HTML overlay) ─────────────────── */}
        {project && (
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: RULER_HEIGHT,
              width: HEADER_WIDTH,
              bottom: 0,
              overflow: 'hidden',
              pointerEvents: 'none',
            }}
          >
            <div style={{ transform: `translateY(${-scrollTop}px)` }}>
            {project.tracks.map((track, idx) => (
              <div
                key={track.id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('trackReorder', String(idx));
                  handleTrackDragStart(idx);
                }}
                onDragOver={(e) => handleTrackDragOver(e, idx)}
                onDragEnd={handleTrackDragEnd}
                onDrop={(e) => handleTrackDrop(e, idx)}
                style={{
                  height: getTrackH(track),
                  display: 'flex',
                  alignItems: 'flex-end',
                  justifyContent: 'center',
                  paddingBottom: '3px',
                  pointerEvents: 'auto',
                  cursor: 'grab',
                  opacity: trackDragFromIdx === idx ? 0 : 1,
                }}
                title={`Drag to reorder "${track.name}"`}
              >
                {/* Grip dots icon */}
                <svg
                  width="10"
                  height={track.type === 'effect' ? 10 : 16}
                  viewBox={track.type === 'effect' ? '0 0 10 10' : '0 0 12 16'}
                  fill={track.type === 'effect' ? 'rgba(251,146,60,0.55)' : 'rgba(13,148,136,0.45)'}
                >
                  {track.type === 'effect' ? (
                    <>
                      <circle cx="3" cy="3" r="1.2" />
                      <circle cx="7" cy="3" r="1.2" />
                      <circle cx="3" cy="7" r="1.2" />
                      <circle cx="7" cy="7" r="1.2" />
                    </>
                  ) : (
                    <>
                      <circle cx="4" cy="4"  r="1.5" />
                      <circle cx="8" cy="4"  r="1.5" />
                      <circle cx="4" cy="8"  r="1.5" />
                      <circle cx="8" cy="8"  r="1.5" />
                      <circle cx="4" cy="12" r="1.5" />
                      <circle cx="8" cy="12" r="1.5" />
                    </>
                  )}
                </svg>
              </div>
            ))}
            </div>
          </div>
        )}
      </div>
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
  ctx.fillStyle = isAudio ? 'rgba(13,148,136,0.30)' : 'rgba(14,165,233,0.40)';
  ctx.fillRect(visX, clipTop, visW, clipH);

  // Ghost border (dashed)
  ctx.globalAlpha = 0.85;
  ctx.strokeStyle = isAudio ? '#0d9488' : '#0ea5e9';
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
  grad.addColorStop(0,    'rgba(13,148,136,0.18)');
  grad.addColorStop(0.5,  'rgba(13,148,136,0.52)');
  grad.addColorStop(1,    'rgba(13,148,136,0.18)');
  ctx.fillStyle = grad;
  ctx.fill();

  // Upper edge line
  ctx.strokeStyle = 'rgba(13,148,136,0.95)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let px = startPx; px <= endPx; px++) {
    const x = clipX + px;
    const y = getY(px, -1);
    if (px === startPx) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Lower edge line
  ctx.strokeStyle = 'rgba(13,148,136,0.55)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let px = startPx; px <= endPx; px++) {
    const x = clipX + px;
    const y = getY(px, 1);
    if (px === startPx) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Centre line
  ctx.strokeStyle = 'rgba(13,148,136,0.15)';
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
