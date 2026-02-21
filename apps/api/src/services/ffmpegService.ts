import { execFileSync, spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { config } from '../config';
import * as ws from './workspace';
import { computeWaveform } from './waveform';
import type { Project, Clip, BeatZoomEffect, WaveformData, BeatsData, LyricsData } from '@video-editor/shared';

const FF = config.ffmpegBin;
const FFP = config.ffprobeBin;

// ─── Probe ───────────────────────────────────────────────────────────────────

export interface ProbeResult {
  duration: number;
  width?: number;
  height?: number;
  fps?: number;
  hasAudio: boolean;
  hasVideo: boolean;
}

export function probeFile(filePath: string): ProbeResult {
  const raw = execFileSync(FFP, [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_streams',
    '-show_format',
    filePath,
  ]).toString();

  const data = JSON.parse(raw) as { streams?: Record<string, unknown>[]; format?: Record<string, unknown> };
  const streams = data.streams ?? [];
  const format = data.format ?? {};

  const videoStream = streams.find((s) => s['codec_type'] === 'video');
  const audioStream = streams.find((s) => s['codec_type'] === 'audio');

  const duration = parseFloat(String(format['duration'] ?? '0'));

  let fps: number | undefined;
  const rateStr = videoStream?.['r_frame_rate'];
  if (typeof rateStr === 'string' && rateStr.includes('/')) {
    const [num, den] = rateStr.split('/').map(Number);
    fps = den > 0 ? num / den : undefined;
  }

  return {
    duration,
    width: typeof videoStream?.['width'] === 'number' ? videoStream['width'] as number : undefined,
    height: typeof videoStream?.['height'] === 'number' ? videoStream['height'] as number : undefined,
    fps,
    hasAudio: !!audioStream,
    hasVideo: !!videoStream,
  };
}

// ─── Proxy creation ──────────────────────────────────────────────────────────

export function createProxy(inputPath: string, outputPath: string): void {
  execFileSync(FF, [
    '-y',
    '-i', inputPath,
    '-vf', 'scale=-2:540,setsar=1',  // setsar=1 normalizes non-square-pixel SAR
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '28',
    '-c:a', 'aac',
    '-b:a', '96k',
    outputPath,
  ]);
}

export function extractAudio(inputPath: string, outputPath: string): void {
  execFileSync(FF, [
    '-y',
    '-i', inputPath,
    '-ac', '2',
    '-ar', '48000',
    '-f', 'wav',
    outputPath,
  ]);
}

// ─── Import pipeline (runs in background job) ────────────────────────────────

export async function runImportPipeline(
  jobId: string,
  assetId: string,
  originalPath: string,
  probe: ProbeResult
) {
  const assetDir = ws.getAssetDir(assetId);
  const proxyPath = path.join(assetDir, 'proxy.mp4');
  const audioWavPath = path.join(assetDir, 'audio.wav');
  const waveformPath = path.join(assetDir, 'waveform.json');

  ws.appendJobLog(jobId, `[import] probing done: duration=${probe.duration.toFixed(2)}s`);

  // Step 1: create proxy (if video)
  if (probe.hasVideo) {
    ws.appendJobLog(jobId, '[import] creating proxy...');
    createProxy(originalPath, proxyPath);
    ws.appendJobLog(jobId, '[import] proxy done');
  }

  // Step 2: extract audio WAV
  ws.appendJobLog(jobId, '[import] extracting audio WAV...');
  try {
    const audioSource = probe.hasVideo && fs.existsSync(proxyPath) ? proxyPath : originalPath;
    extractAudio(audioSource, audioWavPath);
  } catch {
    // Fallback to original if proxy failed
    extractAudio(originalPath, audioWavPath);
  }
  ws.appendJobLog(jobId, '[import] audio WAV done');

  // Step 3: compute waveform
  ws.appendJobLog(jobId, '[import] computing waveform...');
  const wf = computeWaveform(audioWavPath);
  const wfData: WaveformData = {
    samples: wf.samples,
    sampleRate: wf.sampleRate,
    duration: wf.duration,
  };
  fs.writeFileSync(waveformPath, JSON.stringify(wfData));
  ws.appendJobLog(jobId, `[import] waveform done (${wf.samples.length} buckets)`);

  // Update asset record (re-read to avoid overwriting concurrent changes)
  const asset = ws.getAsset(assetId);
  if (asset) {
    ws.upsertAsset({
      ...asset,
      proxyPath: probe.hasVideo ? `assets/${assetId}/proxy.mp4` : undefined,
      audioPath: `assets/${assetId}/audio.wav`,
      waveformPath: `assets/${assetId}/waveform.json`,
    });
  }
}

// ─── Export pipeline ─────────────────────────────────────────────────────────

export interface ExportOptions {
  outputPath: string;
  width?: number;
  height?: number;
  crf?: number;
  preset?: string;
}

export function buildExportCommand(
  project: Project,
  opts: ExportOptions,
  beatsMap: Map<string, BeatsData>
): { cmd: string; args: string[] } {
  const W = opts.width ?? 1080;
  const H = opts.height ?? 1920;
  const CRF = opts.crf ?? 20;
  const PRESET = opts.preset ?? 'medium';

  const videoTracks = project.tracks.filter((t) => t.type === 'video' && !t.muted);
  const masterAudioTrack = project.tracks.find((t) => t.type === 'audio' && t.isMaster);

  const inputs: string[] = [];
  const inputArgs: string[] = [];

  // Collect unique asset proxy paths for video clips
  const assetPathMap = new Map<string, string>();
  for (const track of videoTracks) {
    for (const clip of track.clips) {
      if (!assetPathMap.has(clip.assetId)) {
        const asset = ws.getAsset(clip.assetId);
        if (asset) {
          const absProxy = asset.proxyPath
            ? path.join(ws.getWorkspaceDir(), asset.proxyPath)
            : path.join(ws.getWorkspaceDir(), asset.originalPath);
          assetPathMap.set(clip.assetId, absProxy);
        }
      }
    }
  }

  // Master audio input (index 0 if exists)
  let masterAudioInputIdx = -1;
  if (masterAudioTrack && masterAudioTrack.clips.length > 0) {
    const masterClip = masterAudioTrack.clips[0];
    const masterAsset = ws.getAsset(masterClip.assetId);
    if (masterAsset) {
      const masterPath = path.join(ws.getWorkspaceDir(), masterAsset.originalPath);
      masterAudioInputIdx = inputs.length;
      inputs.push(masterPath);
    }
  }

  // Video asset inputs
  const assetInputIdxMap = new Map<string, number>();
  for (const [assetId, assetPath] of assetPathMap) {
    assetInputIdxMap.set(assetId, inputs.length);
    inputs.push(assetPath);
  }

  for (const inp of inputs) {
    inputArgs.push('-i', inp);
  }

  const filterParts: string[] = [];
  let filterIdx = 0;

  // Compute effective project duration from clips if project.duration is 0
  let effectiveDuration = project.duration;
  if (effectiveDuration <= 0) {
    for (const track of project.tracks) {
      for (const clip of track.clips) {
        if (clip.timelineEnd > effectiveDuration) effectiveDuration = clip.timelineEnd;
      }
    }
  }
  if (effectiveDuration <= 0) effectiveDuration = 1; // safety fallback

  // Base canvas (black background at 30fps).
  // Duration is controlled by the output -t flag below; don't add it here because
  // the `duration` option on the color source filter is unreliable inside filter_complex
  // across ffmpeg versions.
  filterParts.push(`color=c=black:s=${W}x${H}:r=30[base]`);
  let prevPad = 'base';

  // Video clips
  for (const track of videoTracks) {
    for (const clip of track.clips) {
      const inputIdx = assetInputIdxMap.get(clip.assetId);
      if (inputIdx === undefined) continue;

      const srcDuration = clip.sourceEnd - clip.sourceStart;
      if (srcDuration <= 0) continue;

      const outDuration = clip.timelineEnd - clip.timelineStart;
      if (outDuration <= 0) continue;

      const delay = clip.timelineStart;
      const scale = Math.max(0.01, clip.transform.scale);
      const tx = Math.round(clip.transform.x);
      const ty = Math.round(clip.transform.y);

      // Scale to fill canvas with aspect-aware scaling
      const scaledW = Math.round(W * scale);
      const scaledH = Math.round(H * scale);
      const posX = Math.round((W - scaledW) / 2 + tx);
      const posY = Math.round((H - scaledH) / 2 + ty);

      // Use increase+crop instead of decrease+pad. With "decrease", scale output can be 1-2px
      // larger than the target due to even-pixel rounding, causing pad to fail with
      // "Padded dimensions cannot be smaller than input dimensions" in ffmpeg 5.1.
      // With "increase", scale output is always >= target, and crop always succeeds.
      // crop without explicit x/y defaults to center-crop.
      const scaleFilter = `scale=${scaledW}:${scaledH}:force_original_aspect_ratio=increase,crop=${scaledW}:${scaledH}`;
      // Timeline-aligned PTS: setpts=PTS-STARTPTS+timelineStart/TB makes the clip's `t`
      // variable in subsequent filter expressions equal to absolute timeline time. This
      // ensures the overlay enable expression and the beat-zoom crop filter both see the
      // same timeline time, eliminating PTS sync issues.
      const trimFilter = `trim=start=${clip.sourceStart.toFixed(4)}:end=${clip.sourceEnd.toFixed(4)},setpts=PTS-STARTPTS+${clip.timelineStart.toFixed(4)}/TB`;

      // Beat Zoom: bake the zoom effect directly into the clip's filter chain using a
      // crop filter with eval=frame. During beat windows, the crop takes a smaller
      // center region (iw/ZF × ih/ZF), which the following scale then upscales to fill
      // the canvas — creating the zoom-in effect. Outside beat windows, the crop is a
      // no-op (iw × ih). This approach uses a single-input filter and avoids the
      // overlay+enable pattern which is unreliable for multi-input filters in ffmpeg 8.x
      // (causes "stays zoomed" or OOM).
      let beatZoomCropFilter = '';
      const beatZoomEffect = clip.effects.find((e) => e.type === 'beatZoom') as BeatZoomEffect | undefined;
      const masterAudioClip = masterAudioTrack?.clips[0];
      const masterBeats = masterAudioClip ? beatsMap.get(masterAudioClip.assetId) : undefined;

      if (beatZoomEffect?.enabled && masterBeats && masterAudioClip) {
        const timelineBeats = masterBeats.beats.map(
          (b) => masterAudioClip.timelineStart + (b - masterAudioClip.sourceStart)
        );
        const beatsInClip = timelineBeats.filter(
          (b) => b >= clip.timelineStart && b < clip.timelineEnd
        );
        if (beatsInClip.length > 0) {
          const pulseDur = beatZoomEffect.durationMs / 1000;
          const zf = (1 + beatZoomEffect.intensity).toFixed(6);
          const beatSumExpr = beatsInClip
            .map((b) => {
              const beatEnd = Math.min(b + pulseDur, clip.timelineEnd);
              return `between(t,${b.toFixed(4)},${beatEnd.toFixed(4)})`;
            })
            .join('+');
          // crop to center region iw/ZF × ih/ZF during beat windows; full frame otherwise.
          // ffmpeg evaluates expressions containing `t` per-frame automatically.
          beatZoomCropFilter =
            `,crop=w='if(gt(${beatSumExpr},0),iw/${zf},iw)'` +
            `:h='if(gt(${beatSumExpr},0),ih/${zf},ih)'` +
            `:x='(iw-ow)/2':y='(ih-oh)/2'`;
        }
      }

      // Single clip chain with optional beat-zoom crop baked in
      const clipPad = `clip${filterIdx}`;
      filterParts.push(
        `[${inputIdx}:v]${trimFilter}${beatZoomCropFilter},${scaleFilter},format=yuv420p[${clipPad}]`
      );

      // Overlay clip for its full timeline duration
      const overlayPad = `ov${filterIdx}`;
      filterParts.push(
        `[${prevPad}][${clipPad}]overlay=${posX}:${posY}:enable='between(t,${delay.toFixed(4)},${(delay + outDuration).toFixed(4)})'[${overlayPad}]`
      );
      prevPad = overlayPad;

      filterIdx++;
    }
  }

  // ─── Audio ───────────────────────────────────────────────────────────────────
  const audioInputPads: string[] = [];

  if (masterAudioInputIdx >= 0) {
    // Trim master audio to project duration
    const masterClip = masterAudioTrack?.clips[0];
    if (masterClip) {
      const masterAudioPad = `maudio`;
      filterParts.push(
        `[${masterAudioInputIdx}:a]atrim=start=${masterClip.sourceStart.toFixed(4)}:end=${masterClip.sourceEnd.toFixed(4)},asetpts=PTS-STARTPTS,adelay=${Math.round(masterClip.timelineStart * 1000)}:all=1[${masterAudioPad}]`
      );
      audioInputPads.push(`[${masterAudioPad}]`);
    }
  }

  // Clip audio contributions
  for (const track of videoTracks) {
    for (const clip of track.clips) {
      if (!clip.useClipAudio) continue;
      const inputIdx = assetInputIdxMap.get(clip.assetId);
      if (inputIdx === undefined) continue;

      const vol = Math.max(0, clip.clipAudioVolume);
      const clipAudioPad = `caudio${filterIdx}`;
      filterParts.push(
        `[${inputIdx}:a]atrim=start=${clip.sourceStart.toFixed(4)}:end=${clip.sourceEnd.toFixed(4)},asetpts=PTS-STARTPTS,adelay=${Math.round(clip.timelineStart * 1000)}:all=1,volume=${vol.toFixed(4)}[${clipAudioPad}]`
      );
      audioInputPads.push(`[${clipAudioPad}]`);
      filterIdx++;
    }
  }

  // Mix all audio into one named pad [aout]
  let audioOutPad: string | null = null;
  if (audioInputPads.length > 1) {
    // Use amix without normalize/dropout options for broad ffmpeg version compatibility
    filterParts.push(
      `${audioInputPads.join('')}amix=inputs=${audioInputPads.length}[aout]`
    );
    audioOutPad = '[aout]';
  } else if (audioInputPads.length === 1) {
    // Single audio pad: use it directly, no need for acopy
    audioOutPad = audioInputPads[0];
  }

  // ─── Subtitle burn-in ─────────────────────────────────────────────────────────
  let videoOutPad = `[${prevPad}]`;
  if (project.lyrics?.enabled && project.lyrics?.words && project.lyrics.words.length > 0) {
    const projectDir = ws.getProjectDir(project.id);
    const assPath = path.join(projectDir, 'lyrics.ass');
    if (fs.existsSync(assPath)) {
      // Escape path for ffmpeg (forward slashes, escape colons and backslashes)
      const escapedPath = assPath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
      const subbedPad = `subbed`;
      filterParts.push(`${videoOutPad}subtitles='${escapedPath}'[${subbedPad}]`);
      videoOutPad = `[${subbedPad}]`;
    }
  }

  // ─── Build final args ─────────────────────────────────────────────────────────
  const filterComplex = filterParts.join('; ');
  const args: string[] = [
    '-y',
    ...inputArgs,
    '-filter_complex', filterComplex,
    '-map', videoOutPad,
  ];

  if (audioOutPad) {
    args.push('-map', audioOutPad);
  }

  args.push(
    '-t', effectiveDuration.toFixed(4),   // hard stop — prevents infinite encoding
    '-c:v', 'libx264',
    '-preset', PRESET,
    '-crf', String(CRF),
    '-pix_fmt', 'yuv420p',
    '-r', '30',
  );

  if (audioOutPad) {
    args.push('-c:a', 'aac', '-b:a', '192k');
  }

  args.push(opts.outputPath);

  return { cmd: FF, args };
}

// ─── ASS subtitle generation ─────────────────────────────────────────────────

export function generateAss(lyrics: LyricsData, outputPath: string) {
  const style = lyrics.style ?? {
    fontSize: 48,
    color: '#FFFFFF',
    highlightColor: '#FFE600',
    position: 'bottom',
    wordsPerChunk: 3,
  };

  const alignmentMap: Record<string, number> = { top: 8, center: 5, bottom: 2 };
  const alignment = alignmentMap[style.position] ?? 2;

  const hex2ass = (hex: string): string => {
    const h = hex.replace('#', '');
    if (h.length === 6) {
      return `&H00${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}&`;
    }
    return '&H00FFFFFF&';
  };

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 1

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,${style.fontSize},${hex2ass(style.color)},${hex2ass(style.highlightColor)},&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,2,1,${alignment},80,80,60,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const toAssTime = (t: number): string => {
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = Math.floor(t % 60);
    const cs = Math.round((t % 1) * 100);
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
  };

  const words = lyrics.words ?? [];
  const chunkSize = Math.max(1, style.wordsPerChunk);
  const events: string[] = [];

  for (let i = 0; i < words.length; i += chunkSize) {
    const chunk = words.slice(i, i + chunkSize);
    if (chunk.length === 0) continue;

    for (let j = 0; j < chunk.length; j++) {
      const w = chunk[j];
      const wordStart = w.start;
      const wordEnd = j + 1 < chunk.length ? chunk[j + 1].start : w.end;

      // Build text: highlight current word
      const textParts = chunk.map((cw, ci) => {
        if (ci === j) {
          return `{\\c${hex2ass(style.highlightColor)}}${cw.word}{\\c${hex2ass(style.color)}}`;
        }
        return cw.word;
      });

      events.push(
        `Dialogue: 0,${toAssTime(wordStart)},${toAssTime(wordEnd)},Default,,0,0,0,,${textParts.join(' ')}`
      );
    }
  }

  fs.writeFileSync(outputPath, header + events.join('\n') + '\n');
}
