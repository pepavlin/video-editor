import { execFileSync, spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { config } from '../config';
import * as ws from './workspace';
import { computeWaveform } from './waveform';
import type { Project, Clip, Track, BeatZoomEffect, WaveformData, BeatsData, LyricsData } from '@video-editor/shared';

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

  const data = JSON.parse(raw);
  const streams: any[] = data.streams ?? [];
  const format = data.format ?? {};

  const videoStream = streams.find((s) => s.codec_type === 'video');
  const audioStream = streams.find((s) => s.codec_type === 'audio');

  const duration = parseFloat(format.duration ?? '0');

  let fps: number | undefined;
  if (videoStream?.r_frame_rate) {
    const [num, den] = videoStream.r_frame_rate.split('/').map(Number);
    fps = den > 0 ? num / den : undefined;
  }

  return {
    duration,
    width: videoStream?.width,
    height: videoStream?.height,
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
    '-vf', 'scale=-2:540',
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

  ws.appendJobLog(jobId, `[import] probing done: duration=${probe.duration}s`);

  // Step 1: create proxy (if video)
  if (probe.hasVideo) {
    ws.appendJobLog(jobId, '[import] creating proxy...');
    createProxy(originalPath, proxyPath);
    ws.appendJobLog(jobId, '[import] proxy done');
  }

  // Step 2: extract audio WAV
  ws.appendJobLog(jobId, '[import] extracting audio WAV...');
  try {
    extractAudio(probe.hasVideo ? (fs.existsSync(proxyPath) ? proxyPath : originalPath) : originalPath, audioWavPath);
  } catch {
    // fallback: try original
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

  // Update asset record
  const asset = ws.getAsset(assetId)!;
  asset.proxyPath = probe.hasVideo ? `assets/${assetId}/proxy.mp4` : undefined;
  asset.audioPath = `assets/${assetId}/audio.wav`;
  asset.waveformPath = `assets/${assetId}/waveform.json`;
  ws.upsertAsset(asset);
}

// ─── Export pipeline ─────────────────────────────────────────────────────────

export interface ExportOptions {
  outputPath: string;
  width?: number;
  height?: number;
  crf?: number;
  preset?: string;
}

export async function buildExportCommand(
  project: Project,
  opts: ExportOptions,
  beatsMap: Map<string, BeatsData>
): Promise<{ cmd: string; args: string[] }> {
  const W = opts.width ?? 1080;
  const H = opts.height ?? 1920;
  const CRF = opts.crf ?? 20;
  const PRESET = opts.preset ?? 'medium';

  // Gather all unique assets referenced in video tracks
  const videoTracks = project.tracks.filter((t) => t.type === 'video' && !t.muted);
  const masterAudioTrack = project.tracks.find((t) => t.type === 'audio' && t.isMaster);

  // Inputs: first input is master audio (if any), then video proxies
  const inputs: string[] = [];
  const inputArgs: string[] = [];

  // Collect unique asset paths for video clips
  const assetPathMap = new Map<string, string>(); // assetId -> proxy path
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

  // Master audio input
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

  // Build ffmpeg input args
  for (const inp of inputs) {
    inputArgs.push('-i', inp);
  }

  // Build filter_complex
  const filterParts: string[] = [];
  const overlayPads: string[] = [];
  let filterIdx = 0;

  // Base canvas (black background)
  filterParts.push(`color=black:s=${W}x${H}:r=30[base]`);

  let prevPad = 'base';

  for (const track of videoTracks) {
    for (const clip of track.clips) {
      const inputIdx = assetInputIdxMap.get(clip.assetId);
      if (inputIdx === undefined) continue;

      const srcDuration = clip.sourceEnd - clip.sourceStart;
      const outDuration = clip.timelineEnd - clip.timelineStart;
      const delay = clip.timelineStart;

      const scale = clip.transform.scale;
      const opacity = clip.transform.opacity;
      const tx = Math.round(clip.transform.x);
      const ty = Math.round(clip.transform.y);

      // Position on canvas
      const scaledW = Math.round(W * scale);
      const scaledH = Math.round(H * scale);
      const posX = Math.round((W - scaledW) / 2 + tx);
      const posY = Math.round((H - scaledH) / 2 + ty);

      // Determine smart crop for non-9:16 input
      // We use scale to fit and then pad/crop
      const scaleFilter = `scale=${scaledW}:${scaledH}:force_original_aspect_ratio=decrease,pad=${scaledW}:${scaledH}:(ow-iw)/2:(oh-ih)/2`;

      // Trim from source
      const trimFilter = `trim=start=${clip.sourceStart}:end=${clip.sourceEnd},setpts=PTS-STARTPTS`;

      // Apply beat zoom if needed
      let zoomFilter = '';
      const beatZoomEffect = clip.effects.find((e) => e.type === 'beatZoom') as BeatZoomEffect | undefined;
      const assetBeats = beatsMap.get(clip.assetId);
      if (beatZoomEffect?.enabled && assetBeats) {
        // Generate enable expressions for zoom at each beat within clip timeline window
        const beatsInClip = assetBeats.beats.filter(
          (b) => b >= clip.timelineStart && b < clip.timelineEnd
        );
        if (beatsInClip.length > 0) {
          const pulseDur = beatZoomEffect.durationMs / 1000;
          const zoomScale = 1 + beatZoomEffect.intensity;
          const enableExpr = beatsInClip
            .map((b) => {
              const t = b - clip.timelineStart;
              return `between(t,${t.toFixed(3)},${(t + pulseDur).toFixed(3)})`;
            })
            .join('+');
          zoomFilter = `,scale=iw*if(${enableExpr},${zoomScale.toFixed(3)},1):ih*if(${enableExpr},${zoomScale.toFixed(3)},1),setpts=PTS`;
        }
      }

      const clipPad = `clip${filterIdx}`;
      filterParts.push(
        `[${inputIdx}:v]${trimFilter},${scaleFilter}${zoomFilter},setsar=1,format=yuva420p,colorchannelmixer=aa=${opacity.toFixed(3)}[${clipPad}]`
      );

      const overlayPad = `ov${filterIdx}`;
      const delayedPad = `delayed${filterIdx}`;

      // Delay video to correct timeline position using 'setpts'
      // Use 'tpad' and 'overlay' with 'enable'
      filterParts.push(
        `[${prevPad}][${clipPad}]overlay=${posX}:${posY}:enable='between(t,${delay.toFixed(3)},${(delay + outDuration).toFixed(3)})'[${overlayPad}]`
      );

      prevPad = overlayPad;
      filterIdx++;
    }
  }

  // Audio filter: mix master + clip audios
  const audioInputs: string[] = [];
  if (masterAudioInputIdx >= 0) {
    audioInputs.push(`[${masterAudioInputIdx}:a]`);
  }

  // Clip audio contributions
  for (const track of videoTracks) {
    for (const clip of track.clips) {
      if (!clip.useClipAudio) continue;
      const inputIdx = assetInputIdxMap.get(clip.assetId);
      if (inputIdx === undefined) continue;

      const vol = clip.clipAudioVolume;
      const trimFilter = `atrim=start=${clip.sourceStart}:end=${clip.sourceEnd},asetpts=PTS-STARTPTS`;
      const delayFilter = `adelay=${Math.round(clip.timelineStart * 1000)}:all=1`;
      const clipAudioPad = `caudio${filterIdx}`;
      filterParts.push(
        `[${inputIdx}:a]${trimFilter},${delayFilter},volume=${vol}[${clipAudioPad}]`
      );
      audioInputs.push(`[${clipAudioPad}]`);
      filterIdx++;
    }
  }

  let audioOut = 'aout';
  if (audioInputs.length > 1) {
    filterParts.push(`${audioInputs.join('')}amix=inputs=${audioInputs.length}:normalize=0[${audioOut}]`);
  } else if (audioInputs.length === 1) {
    // pass through
    audioOut = audioInputs[0].replace(/[\[\]]/g, '');
    if (audioOut.includes(':')) {
      // raw stream like 0:a - remap
      const tmpAudio = 'aout';
      filterParts.push(`${audioInputs[0]}acopy[${tmpAudio}]`);
      audioOut = tmpAudio;
    }
  }

  // Lyrics subtitle filter (if enabled)
  let outputVideoStream = `[${prevPad}]`;
  if (project.lyrics?.enabled && project.lyrics?.words && project.lyrics.words.length > 0) {
    const projectDir = ws.getProjectDir(project.id);
    const assPath = path.join(projectDir, 'lyrics.ass');
    if (fs.existsSync(assPath)) {
      const subPad = `subbed`;
      filterParts.push(`${outputVideoStream}subtitles='${assPath.replace(/'/g, "\\'")}':force_style='Fontsize=24'[${subPad}]`);
      outputVideoStream = `[${subPad}]`;
    }
  }

  // Build full ffmpeg command
  const filterComplex = filterParts.join('; ');
  const args: string[] = [
    '-y',
    ...inputArgs,
    '-filter_complex', filterComplex,
    '-map', outputVideoStream,
  ];

  if (audioInputs.length > 0) {
    args.push('-map', `[${audioOut}]`);
  }

  args.push(
    '-c:v', 'libx264',
    '-preset', PRESET,
    '-crf', String(CRF),
    '-pix_fmt', 'yuv420p',
    '-r', '30',
  );

  if (audioInputs.length > 0) {
    args.push('-c:a', 'aac', '-b:a', '192k');
  }

  args.push(opts.outputPath);

  return { cmd: FF, args };
}

// ─── ASS subtitle generation ─────────────────────────────────────────────────

export function generateAss(lyrics: LyricsData, outputPath: string) {
  const style = lyrics.style ?? {
    fontSize: 48,
    color: 'FFFFFF',
    highlightColor: 'FFFF00',
    position: 'bottom',
    wordsPerChunk: 3,
  };

  const alignmentMap = { top: 8, center: 5, bottom: 2 };
  const alignment = alignmentMap[style.position] ?? 2;

  const hex2ass = (hex: string) => {
    const h = hex.replace('#', '');
    if (h.length === 6) {
      // ASS color is &H00BBGGRR
      return `&H00${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}&`;
    }
    return `&H00FFFFFF&`;
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

  const toAssTime = (t: number) => {
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = Math.floor(t % 60);
    const cs = Math.round((t % 1) * 100);
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
  };

  const words = lyrics.words ?? [];
  const chunkSize = style.wordsPerChunk;
  const events: string[] = [];

  for (let i = 0; i < words.length; i += chunkSize) {
    const chunk = words.slice(i, Math.min(i + chunkSize, words.length));
    if (chunk.length === 0) continue;

    const chunkStart = chunk[0].start;
    const chunkEnd = chunk[chunk.length - 1].end;

    // For each word in chunk, show chunk with that word highlighted
    for (let j = 0; j < chunk.length; j++) {
      const w = chunk[j];
      const wordStart = w.start;
      const wordEnd = j + 1 < chunk.length ? chunk[j + 1].start : chunkEnd;

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
