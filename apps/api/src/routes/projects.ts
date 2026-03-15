import { FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { config } from '../config';
import * as ws from '../services/workspace';
import * as jq from '../services/jobQueue';
import { exportPipeline } from '../elements/ExportPipeline';
import type { Project, BeatsData, Clip } from '@video-editor/shared';

function makeDefaultProject(name: string): Project {
  const now = new Date().toISOString();
  return {
    id: `proj_${uuidv4().replace(/-/g, '').slice(0, 12)}`,
    name,
    duration: 0,
    aspectRatio: '9:16',
    outputResolution: { w: 1080, h: 1920 },
    tracks: [
      {
        id: `track_v1_${uuidv4().slice(0, 8)}`,
        type: 'video',
        name: 'Video',
        clips: [],
      },
      {
        id: `track_master_${uuidv4().slice(0, 8)}`,
        type: 'audio',
        isMaster: true,
        name: 'Audio',
        clips: [],
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
}

export async function projectsRoutes(app: FastifyInstance) {
  // POST /projects
  app.post<{ Body: { name?: string } }>('/projects', async (req, reply) => {
    const rawName = req.body?.name ?? 'Untitled Project';
    const name = String(rawName).slice(0, 200); // limit name length
    const project = makeDefaultProject(name);
    ws.writeProject(project);
    return reply.code(201).send({ id: project.id, project });
  });

  // GET /projects
  app.get('/projects', async (_req, reply) => {
    const list = ws.listProjects();
    return reply.send({ projects: list });
  });

  // GET /projects/:id
  app.get<{ Params: { id: string } }>('/projects/:id', async (req, reply) => {
    const project = ws.readProject(req.params.id);
    if (!project) return reply.code(404).send({ error: 'Project not found' });
    return reply.send({ project });
  });

  // PUT /projects/:id
  app.put<{ Params: { id: string }; Body: Project }>('/projects/:id', async (req, reply) => {
    const existing = ws.readProject(req.params.id);
    if (!existing) return reply.code(404).send({ error: 'Project not found' });

    // Basic structural validation
    const body = req.body;
    if (!body || typeof body !== 'object' || !Array.isArray(body.tracks)) {
      return reply.code(400).send({ error: 'Invalid project structure' });
    }

    const updated: Project = {
      ...body,
      id: req.params.id, // prevent ID spoofing
      updatedAt: new Date().toISOString(),
    };
    ws.writeProject(updated);
    return reply.send({ project: updated });
  });

  // POST /projects/:id/align-lyrics
  app.post<{
    Params: { id: string };
    Body: { text: string; audioAssetId?: string };
  }>('/projects/:id/align-lyrics', async (req, reply) => {
    const project = ws.readProject(req.params.id);
    if (!project) return reply.code(404).send({ error: 'Project not found' });

    const { text, audioAssetId } = req.body;
    if (!text || typeof text !== 'string' || !text.trim()) {
      return reply.code(400).send({ error: 'text is required' });
    }
    if (text.length > 100_000) {
      return reply.code(400).send({ error: 'Lyrics text too long (max 100k chars)' });
    }

    // Find master audio wav
    let audioWavPath: string | null = null;
    const masterTrack = project.tracks.find((t) => t.type === 'audio' && t.isMaster);
    const masterClip = masterTrack?.clips[0];
    const targetAssetId = audioAssetId ?? masterClip?.assetId;

    if (targetAssetId) {
      const asset = ws.getAsset(targetAssetId);
      if (asset?.audioPath) {
        const wavPath = path.join(ws.getWorkspaceDir(), asset.audioPath);
        if (fs.existsSync(wavPath)) audioWavPath = wavPath;
      }
    }

    if (!audioWavPath) {
      return reply.code(400).send({ error: 'No audio WAV available. Import and wait for a master audio track.' });
    }

    const projectDir = ws.getProjectDir(project.id);
    fs.mkdirSync(projectDir, { recursive: true });

    const job = jq.createJob('lyrics', project.id);
    const lyricsOutputPath = path.join(projectDir, 'words.json');
    const textFilePath = path.join(projectDir, 'lyrics_input.txt');
    fs.writeFileSync(textFilePath, text);

    const scriptPath = path.join(config.scriptsDir, 'align_lyrics.py');

    jq.runCommand(
      job.id,
      config.pythonBin,
      [scriptPath, audioWavPath, textFilePath, lyricsOutputPath],
      {
        onDone: () => {
          try {
            const words = JSON.parse(fs.readFileSync(lyricsOutputPath, 'utf8'));
            const proj = ws.readProject(project.id);
            if (proj) {
              ws.writeProject({
                ...proj,
                lyrics: {
                  text,
                  words,
                  enabled: true,
                  style: proj.lyrics?.style ?? {
                    fontSize: 48,
                    color: '#FFFFFF',
                    highlightColor: '#FFE600',
                    position: 'bottom',
                    wordsPerChunk: 3,
                  },
                },
                updatedAt: new Date().toISOString(),
              });
            }
          } catch (e) {
            ws.appendJobLog(job.id, `Failed to update project with lyrics: ${e}`);
          }
        },
        outputPath: lyricsOutputPath,
      }
    );

    return reply.code(202).send({ jobId: job.id });
  });

  // POST /projects/:id/clips/:clipId/align-lyrics
  // Aligns lyrics for a specific lyrics clip using Whisper and updates the clip's lyricsWords field.
  app.post<{
    Params: { id: string; clipId: string };
    Body: { text: string; audioAssetId?: string };
  }>('/projects/:id/clips/:clipId/align-lyrics', async (req, reply) => {
    const project = ws.readProject(req.params.id);
    if (!project) return reply.code(404).send({ error: 'Project not found' });

    const { text, audioAssetId } = req.body;
    if (!text || typeof text !== 'string' || !text.trim()) {
      return reply.code(400).send({ error: 'text is required' });
    }
    if (text.length > 100_000) {
      return reply.code(400).send({ error: 'Lyrics text too long (max 100k chars)' });
    }

    // Find the clip
    let targetClip: Clip | undefined;
    for (const track of project.tracks) {
      const found = track.clips.find((c) => c.id === req.params.clipId);
      if (found) { targetClip = found; break; }
    }
    if (!targetClip) return reply.code(404).send({ error: 'Clip not found' });

    // Find master audio wav
    let audioWavPath: string | null = null;
    const masterTrack = project.tracks.find((t) => t.type === 'audio' && t.isMaster);
    const masterClip = masterTrack?.clips[0];
    const targetAssetId = audioAssetId ?? masterClip?.assetId;

    if (targetAssetId) {
      const asset = ws.getAsset(targetAssetId);
      if (asset?.audioPath) {
        const wavPath = path.join(ws.getWorkspaceDir(), asset.audioPath);
        if (fs.existsSync(wavPath)) audioWavPath = wavPath;
      }
    }

    if (!audioWavPath) {
      return reply.code(400).send({ error: 'No audio WAV available. Import and wait for a master audio track.' });
    }

    const projectDir = ws.getProjectDir(project.id);
    fs.mkdirSync(projectDir, { recursive: true });

    const clipId = req.params.clipId;
    const job = jq.createJob('lyrics', project.id);
    const lyricsOutputPath = path.join(projectDir, `words_${clipId}.json`);
    const textFilePath = path.join(projectDir, `lyrics_input_${clipId}.txt`);
    fs.writeFileSync(textFilePath, text);

    const scriptPath = path.join(config.scriptsDir, 'align_lyrics.py');

    jq.runCommand(
      job.id,
      config.pythonBin,
      [scriptPath, audioWavPath, textFilePath, lyricsOutputPath],
      {
        onDone: () => {
          try {
            const words = JSON.parse(fs.readFileSync(lyricsOutputPath, 'utf8'));
            const proj = ws.readProject(project.id);
            if (proj) {
              const updatedProject: Project = {
                ...proj,
                tracks: proj.tracks.map((t) => ({
                  ...t,
                  clips: t.clips.map((c) =>
                    c.id === clipId
                      ? { ...c, lyricsWords: words, lyricsAlignStatus: 'done' as const }
                      : c
                  ),
                })),
                updatedAt: new Date().toISOString(),
              };
              ws.writeProject(updatedProject);
            }
          } catch (e) {
            ws.appendJobLog(job.id, `Failed to update clip with lyrics: ${e}`);
          }
        },
        outputPath: lyricsOutputPath,
      }
    );

    return reply.code(202).send({ jobId: job.id });
  });

  // POST /projects/:id/clips/:clipId/transcribe-lyrics
  // Auto-transcribes sung lyrics using Whisper (no pre-written lyrics required).
  // Updates clip.lyricsContent with the detected text AND clip.lyricsWords with word timestamps.
  app.post<{
    Params: { id: string; clipId: string };
    Body: { audioAssetId?: string };
  }>('/projects/:id/clips/:clipId/transcribe-lyrics', async (req, reply) => {
    const project = ws.readProject(req.params.id);
    if (!project) return reply.code(404).send({ error: 'Project not found' });

    // Find the clip
    let targetClip: Clip | undefined;
    for (const track of project.tracks) {
      const found = track.clips.find((c) => c.id === req.params.clipId);
      if (found) { targetClip = found; break; }
    }
    if (!targetClip) return reply.code(404).send({ error: 'Clip not found' });

    // Find master audio wav
    let audioWavPath: string | null = null;
    const masterTrack = project.tracks.find((t) => t.type === 'audio' && t.isMaster);
    const masterClip = masterTrack?.clips[0];
    const targetAssetId = req.body?.audioAssetId ?? masterClip?.assetId;

    if (targetAssetId) {
      const asset = ws.getAsset(targetAssetId);
      if (asset?.audioPath) {
        const wavPath = path.join(ws.getWorkspaceDir(), asset.audioPath);
        if (fs.existsSync(wavPath)) audioWavPath = wavPath;
      }
    }

    if (!audioWavPath) {
      return reply.code(400).send({ error: 'No audio WAV available. Import and wait for a master audio track.' });
    }

    const projectDir = ws.getProjectDir(project.id);
    fs.mkdirSync(projectDir, { recursive: true });

    const clipId = req.params.clipId;
    const job = jq.createJob('lyrics', project.id);
    const transcribeOutputPath = path.join(projectDir, `transcribe_${clipId}.json`);

    const scriptPath = path.join(config.scriptsDir, 'transcribe_lyrics.py');

    jq.runCommand(
      job.id,
      config.pythonBin,
      [scriptPath, audioWavPath, transcribeOutputPath],
      {
        onDone: () => {
          try {
            const result = JSON.parse(fs.readFileSync(transcribeOutputPath, 'utf8'));
            const detectedText: string = result.text ?? '';
            const words = result.words ?? [];
            const proj = ws.readProject(project.id);
            if (proj) {
              const updatedProject: Project = {
                ...proj,
                tracks: proj.tracks.map((t) => ({
                  ...t,
                  clips: t.clips.map((c) =>
                    c.id === clipId
                      ? {
                          ...c,
                          lyricsContent: detectedText,
                          lyricsWords: words,
                          lyricsAlignStatus: 'done' as const,
                        }
                      : c
                  ),
                })),
                updatedAt: new Date().toISOString(),
              };
              ws.writeProject(updatedProject);
            }
          } catch (e) {
            ws.appendJobLog(job.id, `Failed to update clip with transcription: ${e}`);
          }
        },
        outputPath: transcribeOutputPath,
      }
    );

    return reply.code(202).send({ jobId: job.id });
  });

  // POST /projects/:id/clips/:clipId/sync-audio
  // Finds where the clip's audio best aligns within the master audio using cross-correlation.
  // Returns { offset, confidence, newTimelineStart } without modifying the project.
  app.post<{
    Params: { id: string; clipId: string };
  }>('/projects/:id/clips/:clipId/sync-audio', async (req, reply) => {
    const project = ws.readProject(req.params.id);
    if (!project) return reply.code(404).send({ error: 'Project not found' });

    // Find the clip
    let targetClip: Clip | undefined;
    for (const track of project.tracks) {
      const found = track.clips.find((c) => c.id === req.params.clipId);
      if (found) { targetClip = found; break; }
    }
    if (!targetClip) return reply.code(404).send({ error: 'Clip not found' });

    // Get clip audio WAV
    const clipAsset = ws.getAsset(targetClip.assetId);
    if (!clipAsset?.audioPath) {
      return reply.code(400).send({ error: 'Clip asset has no extracted audio. Wait for import to finish.' });
    }
    const clipWavPath = path.join(ws.getWorkspaceDir(), clipAsset.audioPath);
    if (!fs.existsSync(clipWavPath)) {
      return reply.code(400).send({ error: 'Clip audio WAV file not found.' });
    }

    // Get master audio WAV
    const masterTrack = project.tracks.find((t) => t.type === 'audio' && t.isMaster);
    const masterClip = masterTrack?.clips[0];
    if (!masterClip) {
      return reply.code(400).send({ error: 'No master audio clip on the master track.' });
    }
    const masterAsset = ws.getAsset(masterClip.assetId);
    if (!masterAsset?.audioPath) {
      return reply.code(400).send({ error: 'Master audio has no extracted WAV. Wait for import to finish.' });
    }
    const masterWavPath = path.join(ws.getWorkspaceDir(), masterAsset.audioPath);
    if (!fs.existsSync(masterWavPath)) {
      return reply.code(400).send({ error: 'Master audio WAV file not found.' });
    }

    // Run sync_audio.py
    const projectDir = ws.getProjectDir(project.id);
    fs.mkdirSync(projectDir, { recursive: true });
    const outputPath = path.join(projectDir, `sync_${targetClip.id}.json`);
    const scriptPath = path.join(config.scriptsDir, 'sync_audio.py');

    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(config.pythonBin, [scriptPath, clipWavPath, masterWavPath, outputPath], {
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        const logLines: string[] = [];
        const handleLine = (line: string) => {
          logLines.push(line);
          if (logLines.length > 50) logLines.shift();
        };
        child.stdout.on('data', (d: Buffer) => d.toString().split('\n').filter(Boolean).forEach(handleLine));
        child.stderr.on('data', (d: Buffer) => d.toString().split('\n').filter(Boolean).forEach(handleLine));
        child.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`sync_audio.py exited with code ${code}: ${logLines.slice(-3).join(' | ')}`));
        });
        child.on('error', reject);
      });
    } catch (e: any) {
      return reply.code(500).send({ error: `Audio sync failed: ${e.message}` });
    }

    let result: { offset: number; confidence: number };
    try {
      result = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
    } catch (e: any) {
      return reply.code(500).send({ error: 'Failed to read sync result.' });
    }

    // Compute the new timeline position:
    //   master plays its WAV from sourceStart at timelineStart
    //   result.offset = seconds into the master WAV where the clip audio best matches
    //   → clip should be placed so its start aligns there on the timeline
    const masterSourceStart = masterClip.sourceStart ?? 0;
    const masterTimelineStart = masterClip.timelineStart ?? 0;
    const newTimelineStart = Math.max(0, masterTimelineStart + (result.offset - masterSourceStart));

    return reply.send({
      offset: result.offset,
      confidence: result.confidence,
      newTimelineStart,
    });
  });

  // POST /projects/:id/export
  app.post<{
    Params: { id: string };
    Body: { width?: number; height?: number; crf?: number; preset?: string; startTime?: number; endTime?: number };
  }>('/projects/:id/export', async (req, reply) => {
    const project = ws.readProject(req.params.id);
    if (!project) return reply.code(404).send({ error: 'Project not found' });

    const exportDir = path.join(ws.getProjectDir(project.id), 'exports');
    fs.mkdirSync(exportDir, { recursive: true });

    const timestamp = Date.now();
    const outputPath = path.join(exportDir, `export_${timestamp}.mp4`);

    const job = jq.createJob('export', project.id);

    setImmediate(async () => {
      try {
        // Load beats for all assets referenced in project
        const beatsMap = new Map<string, BeatsData>();
        for (const track of project.tracks) {
          for (const clip of track.clips) {
            if (!beatsMap.has(clip.assetId)) {
              const asset = ws.getAsset(clip.assetId);
              if (asset?.beatsPath) {
                const bp = path.join(ws.getWorkspaceDir(), asset.beatsPath);
                if (fs.existsSync(bp)) {
                  try {
                    beatsMap.set(clip.assetId, JSON.parse(fs.readFileSync(bp, 'utf8')));
                  } catch { /* ignore corrupted beats */ }
                }
              }
            }
          }
        }

        // Compute stabilized asset IDs (head-stabilized video paths)
        const videoTracks = project.tracks.filter((t) => t.type === 'video' && !t.muted);
        const stabilizedAssetIds = new Set<string>();
        for (const track of videoTracks) {
          const hsEffectTrack = project.tracks.find(
            (t) => t.type === 'effect' && t.effectType === 'headStabilization' && t.parentTrackId === track.id
          );
          const hasEnabledHs = hsEffectTrack?.clips.some((ec) => ec.effectConfig?.enabled);
          if (hasEnabledHs) {
            for (const clip of track.clips) {
              const asset = ws.getAsset(clip.assetId);
              if (asset?.headStabilizedPath) {
                stabilizedAssetIds.add(clip.assetId);
              }
            }
          }
        }

        const W = req.body?.width ?? project.outputResolution.w;
        const H = req.body?.height ?? project.outputResolution.h;
        const CRF = req.body?.crf ?? 18;
        const PRESET = req.body?.preset ?? 'medium';

        // Build filter complex using the unified ExportPipeline (registry-driven).
        // This handles ALL visual elements and effects (including Cutout, Cartoon,
        // ColorGrade, BeatZoom, Text, Rectangle, Lyrics) via CLIP_REGISTRY and
        // EFFECT_REGISTRY — same element definitions used by the preview pipeline.
        const pipelineResult = exportPipeline.build(
          project,
          {
            outputPath,
            width: W,
            height: H,
            crf: CRF,
            preset: PRESET,
            startTime: req.body?.startTime,
            endTime: req.body?.endTime,
          },
          beatsMap,
          stabilizedAssetIds
        );

        // Assemble the final ffmpeg command from pipeline result
        const cmd = config.ffmpegBin;
        const args: string[] = ['-y', ...pipelineResult.inputArgs];
        args.push('-filter_complex', pipelineResult.filterComplex);
        args.push('-map', `[${pipelineResult.videoOutPad}]`);
        if (pipelineResult.audioOutPad) {
          args.push('-map', pipelineResult.audioOutPad);
        }

        // Compute effective project duration for -t flag
        let effectiveProjDuration = project.duration;
        if (effectiveProjDuration <= 0) {
          for (const track of project.tracks) {
            for (const clip of track.clips) {
              if (clip.timelineEnd > effectiveProjDuration) effectiveProjDuration = clip.timelineEnd;
            }
          }
        }
        if (effectiveProjDuration <= 0) effectiveProjDuration = 1;

        const outStart = req.body?.startTime ?? 0;
        const outEnd = req.body?.endTime ?? effectiveProjDuration;
        const outDur = Math.max(0.1, outEnd - outStart);

        if (outStart > 0) {
          args.push('-ss', outStart.toFixed(4));
        }
        args.push(
          '-t', outDur.toFixed(4),
          '-c:v', 'libx264',
          '-preset', PRESET,
          '-crf', String(CRF),
          '-pix_fmt', 'yuv420p',
          '-r', '30',
        );
        if (pipelineResult.audioOutPad) {
          args.push('-c:a', 'aac', '-b:a', '192k');
        }
        args.push(outputPath);

        // Log the full command and filter_complex for debugging
        const fcArgIdx = args.indexOf('-filter_complex');
        if (fcArgIdx >= 0) {
          ws.appendJobLog(job.id, `[export] filter_complex:\n${args[fcArgIdx + 1].replace(/; /g, ';\n  ')}`);
        }
        ws.appendJobLog(job.id, `[export] cmd: ${cmd} ${args.join(' ')}`);
        ws.appendJobLog(job.id, `[export] running ffmpeg...`);

        // Use outDur for progress calculation
        const effectiveDuration = outDur;

        await new Promise<void>((resolve, reject) => {
          const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
          const errorLines: string[] = [];

          const updateProgress = (line: string) => {
            ws.appendJobLog(job.id, line);
            // Collect recent stderr lines for error reporting (keep more for diagnostics)
            if (errorLines.length >= 50) errorLines.shift();
            errorLines.push(line);
            const timeMatch = line.match(/time=(\d+):(\d+):(\d+\.\d+)/);
            if (timeMatch) {
              const t = parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + parseFloat(timeMatch[3]);
              const pct = Math.min(99, Math.round((t / effectiveDuration) * 100));
              jq.setJobProgress(job.id, pct);
            }
          };

          child.stdout.on('data', (d: Buffer) => d.toString().split('\n').filter(Boolean).forEach(updateProgress));
          child.stderr.on('data', (d: Buffer) => d.toString().split('\n').filter(Boolean).forEach(updateProgress));
          child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
            if (code === 0) {
              resolve();
            } else {
              const exitInfo = code !== null ? `code ${code}` : `signal ${signal ?? 'unknown'}`;
              // Prefer lines that look like actual errors; skip ffmpeg startup noise
              const startupNoise = /press \[q\]|ffmpeg version|built with|configuration:|lib[a-z]+\s+\d/i;
              const errorKeywords = /error|invalid|unknown|not found|failed|abort|conversion|no such|impossible|does not|cannot|mismatch|discarded/i;
              const meaningfulErrors = errorLines
                .filter((l) => !startupNoise.test(l) && errorKeywords.test(l));
              // Include last 3 meaningful errors for better diagnostics
              const recentErrors = meaningfulErrors.slice(-3);
              const errorDetail = recentErrors.length > 0
                ? recentErrors.join(' | ')
                : errorLines.filter((l) => !startupNoise.test(l)).pop()
                ?? errorLines[errorLines.length - 1]
                ?? '';
              reject(new Error(`ffmpeg exited with ${exitInfo}${errorDetail ? `: ${errorDetail.slice(0, 500)}` : ''}`));
            }
          });
          child.on('error', (err) => {
            reject(new Error(`Failed to spawn ffmpeg: ${err.message}`));
          });
        });

        jq.setJobDone(job.id, outputPath);
        ws.appendJobLog(job.id, `[export] done: ${outputPath}`);
      } catch (e: any) {
        ws.appendJobLog(job.id, `[export] ERROR: ${e.message}`);
        jq.setJobError(job.id, e.message);
      }
    });

    return reply.code(202).send({ jobId: job.id });
  });
}
