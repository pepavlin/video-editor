'use client';

import { useEffect, useRef, useCallback } from 'react';
import type { Project, Asset, BeatsData, Clip } from '@video-editor/shared';
import { getBeatZoomScale, clamp } from '@/lib/utils';

interface Props {
  project: Project | null;
  assets: Asset[];
  currentTime: number;
  isPlaying: boolean;
  beatsData: Map<string, BeatsData>;
}

// Cache for loaded video elements
const videoElementCache = new Map<string, HTMLVideoElement>();

function getOrCreateVideoEl(assetId: string, src: string): HTMLVideoElement {
  if (!videoElementCache.has(assetId)) {
    const el = document.createElement('video');
    el.src = src;
    el.preload = 'auto';
    el.muted = true;
    el.crossOrigin = 'anonymous';
    el.style.display = 'none';
    document.body.appendChild(el);
    videoElementCache.set(assetId, el);
  }
  return videoElementCache.get(assetId)!;
}

export default function Preview({
  project,
  assets,
  currentTime,
  isPlaying,
  beatsData,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Keep latest props in refs to avoid stale closures in rAF
  const propsRef = useRef({ project, assets, currentTime, isPlaying, beatsData });
  useEffect(() => {
    propsRef.current = { project, assets, currentTime, isPlaying, beatsData };
  });

  const assetMap = useRef(new Map<string, Asset>());
  useEffect(() => {
    const map = new Map<string, Asset>();
    for (const a of assets) map.set(a.id, a);
    assetMap.current = map;
  }, [assets]);

  // Preload video elements for all video assets in project
  useEffect(() => {
    if (!project) return;
    for (const track of project.tracks) {
      for (const clip of track.clips) {
        const asset = assetMap.current.get(clip.assetId);
        if (asset?.type === 'video' && asset.proxyPath) {
          getOrCreateVideoEl(asset.id, `/files/${asset.proxyPath}`);
        }
      }
    }
  }, [project]);

  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { project, assets, currentTime, beatsData } = propsRef.current;
    if (!project) {
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#444';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No project loaded', canvas.width / 2, canvas.height / 2);
      return;
    }

    const W = canvas.width;
    const H = canvas.height;

    // Clear
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    // Beats come from the master audio asset (source timestamps), converted to absolute
    // timeline time accounting for the master clip's timelineStart / sourceStart offset.
    const masterTrack = project.tracks.find((t) => t.type === 'audio' && t.isMaster);
    const masterClip = masterTrack?.clips[0];
    const masterBeatData = masterClip ? beatsData.get(masterClip.assetId) : undefined;
    const masterBeats = masterBeatData && masterClip
      ? masterBeatData.beats.map((b) => masterClip.timelineStart + (b - masterClip.sourceStart))
      : undefined;

    // Render video tracks (bottom to top)
    const videoTracks = project.tracks.filter((t) => t.type === 'video' && !t.muted);

    for (const track of videoTracks) {
      for (const clip of track.clips) {
        if (currentTime < clip.timelineStart || currentTime >= clip.timelineEnd) continue;

        const asset = assetMap.current.get(clip.assetId);
        if (!asset) continue;

        // Calculate source time
        const elapsed = currentTime - clip.timelineStart;
        const sourceTime = clip.sourceStart + elapsed;

        const videoEl = asset.proxyPath
          ? getOrCreateVideoEl(asset.id, `/files/${asset.proxyPath}`)
          : null;

        if (!videoEl) continue;

        // Sync video element to the correct source time
        const targetTime = Math.max(0, Math.min(sourceTime, videoEl.duration || 9999));
        if (propsRef.current.isPlaying) {
          if (videoEl.paused) {
            // Start playing from the correct position
            videoEl.currentTime = targetTime;
            videoEl.play().catch(() => {});
          } else if (Math.abs(videoEl.currentTime - targetTime) > 0.5) {
            // Re-sync if drifted more than 0.5s
            videoEl.currentTime = targetTime;
          }
        } else {
          // Seek to exact frame when paused
          if (Math.abs(videoEl.currentTime - targetTime) > 0.08) {
            videoEl.currentTime = targetTime;
          }
        }

        // Compute transform
        const transform = clip.transform;
        let scale = transform.scale;

        // Apply beat zoom effect (beats come from master audio, not the video asset)
        const beatZoom = clip.effects.find((e) => e.type === 'beatZoom');
        if (beatZoom && beatZoom.type === 'beatZoom' && beatZoom.enabled && masterBeats) {
          scale *= getBeatZoomScale(
            currentTime,
            masterBeats,
            beatZoom.intensity,
            beatZoom.durationMs,
            beatZoom.easing
          );
        }

        ctx.save();
        ctx.globalAlpha = transform.opacity;

        // Fit video into canvas preserving aspect ratio, then apply transform
        const vW = videoEl.videoWidth || W;
        const vH = videoEl.videoHeight || H;

        // Compute fit dimensions
        let drawW = W * scale;
        let drawH = H * scale;

        // Maintain video aspect but fill canvas
        const targetAR = W / H;
        const videoAR = vW / vH;

        if (videoAR > targetAR) {
          // video is wider: fit height
          drawH = H * scale;
          drawW = drawH * videoAR;
        } else {
          // video is taller: fit width
          drawW = W * scale;
          drawH = drawW / videoAR;
        }

        const x = (W - drawW) / 2 + transform.x;
        const y = (H - drawH) / 2 + transform.y;

        if (transform.rotation !== 0) {
          ctx.translate(W / 2, H / 2);
          ctx.rotate((transform.rotation * Math.PI) / 180);
          ctx.translate(-W / 2, -H / 2);
        }

        try {
          ctx.drawImage(videoEl, x, y, drawW, drawH);
        } catch {
          // Video not ready
          ctx.fillStyle = '#1a1a1a';
          ctx.fillRect(x, y, drawW, drawH);
        }

        ctx.restore();
      }
    }

    // Lyrics overlay (simple canvas text)
    if (project.lyrics?.enabled && project.lyrics.words && project.lyrics.words.length > 0) {
      drawLyricsOverlay(ctx, W, H, currentTime, project.lyrics);
    }
  }, []);

  // RAF loop for live preview during playback
  const rafRef = useRef<number>(0);
  useEffect(() => {
    if (isPlaying) {
      const loop = () => {
        drawFrame();
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
      return () => cancelAnimationFrame(rafRef.current);
    } else {
      drawFrame();
    }
  }, [isPlaying, drawFrame]);

  // Pause all cached video elements when playback stops
  useEffect(() => {
    if (!isPlaying) {
      videoElementCache.forEach((el) => {
        if (!el.paused) el.pause();
      });
    }
  }, [isPlaying]);

  // Draw on time change when paused
  useEffect(() => {
    if (!isPlaying) {
      drawFrame();
    }
  }, [currentTime, isPlaying, drawFrame, project]);

  // Resize canvas to fill container
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const ro = new ResizeObserver(() => {
      const { clientWidth, clientHeight } = container;
      // Keep 9:16 aspect ratio
      const aspect = project
        ? project.outputResolution.w / project.outputResolution.h
        : 9 / 16;
      let w = clientWidth;
      let h = w / aspect;
      if (h > clientHeight) {
        h = clientHeight;
        w = h * aspect;
      }
      canvas.width = Math.round(w);
      canvas.height = Math.round(h);
      drawFrame();
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [drawFrame, project?.outputResolution]);

  return (
    <div
      ref={containerRef}
      className="flex-1 flex items-center justify-center bg-black"
      style={{ minHeight: 0 }}
    >
      <canvas
        ref={canvasRef}
        style={{
          display: 'block',
          imageRendering: 'auto',
        }}
      />
    </div>
  );
}

function drawLyricsOverlay(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  currentTime: number,
  lyrics: NonNullable<Project['lyrics']>
) {
  const words = lyrics.words ?? [];
  const style = lyrics.style ?? {
    fontSize: 48,
    color: '#FFFFFF',
    highlightColor: '#FFE600',
    position: 'bottom',
    wordsPerChunk: 3,
  };

  const chunkSize = style.wordsPerChunk;
  const fontSize = Math.round((style.fontSize / 1920) * H);

  // Find current chunk
  let chunkStart = -1;
  for (let i = 0; i < words.length; i += chunkSize) {
    const chunk = words.slice(i, i + chunkSize);
    if (currentTime >= chunk[0].start && currentTime <= (chunk[chunk.length - 1].end + 0.5)) {
      chunkStart = i;
      break;
    }
  }

  if (chunkStart < 0) return;

  const chunk = words.slice(chunkStart, chunkStart + chunkSize);

  ctx.save();
  ctx.font = `bold ${fontSize}px Arial`;
  ctx.textAlign = 'center';

  const y = style.position === 'bottom'
    ? H - fontSize * 2
    : style.position === 'top'
    ? fontSize * 2
    : H / 2;

  // Shadow
  ctx.shadowColor = 'rgba(0,0,0,0.8)';
  ctx.shadowBlur = 8;

  // Draw each word
  const texts = chunk.map((w) => w.word);
  const fullText = texts.join(' ');
  const totalWidth = ctx.measureText(fullText).width;
  let x = (W - totalWidth) / 2;

  for (let i = 0; i < chunk.length; i++) {
    const w = chunk[i];
    const isCurrentWord = currentTime >= w.start && currentTime <= w.end;
    ctx.fillStyle = isCurrentWord ? style.highlightColor : style.color;

    const wordText = i < chunk.length - 1 ? w.word + ' ' : w.word;
    ctx.fillText(wordText, x + ctx.measureText(wordText).width / 2, y);
    x += ctx.measureText(wordText).width;
  }

  ctx.restore();
}
