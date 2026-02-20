import { FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { config } from '../config';
import * as ws from '../services/workspace';
import * as ffmpeg from '../services/ffmpegService';
import * as jq from '../services/jobQueue';
import type { Project, BeatsData } from '@video-editor/shared';

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
        name: 'Video 1',
        clips: [],
      },
      {
        id: `track_v2_${uuidv4().slice(0, 8)}`,
        type: 'video',
        name: 'Video 2',
        clips: [],
      },
      {
        id: `track_master_${uuidv4().slice(0, 8)}`,
        type: 'audio',
        isMaster: true,
        name: 'Master Audio',
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

  // POST /projects/:id/export
  app.post<{
    Params: { id: string };
    Body: { width?: number; height?: number; crf?: number; preset?: string };
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

        // Generate ASS lyrics
        if (project.lyrics?.enabled && project.lyrics.words && project.lyrics.words.length > 0) {
          const assPath = path.join(ws.getProjectDir(project.id), 'lyrics.ass');
          ffmpeg.generateAss(project.lyrics, assPath);
          ws.appendJobLog(job.id, '[export] generated ASS subtitles');
        }

        const { cmd, args } = ffmpeg.buildExportCommand(
          project,
          {
            outputPath,
            width: req.body?.width ?? project.outputResolution.w,
            height: req.body?.height ?? project.outputResolution.h,
            crf: req.body?.crf,
            preset: req.body?.preset,
          },
          beatsMap
        );

        ws.appendJobLog(job.id, `[export] running ffmpeg...`);

        await new Promise<void>((resolve, reject) => {
          const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });

          // Use effective duration (from clips) in case project.duration is 0
        let effectiveDuration = project.duration;
        if (effectiveDuration <= 0) {
          for (const track of project.tracks) {
            for (const clip of track.clips) {
              if (clip.timelineEnd > effectiveDuration) effectiveDuration = clip.timelineEnd;
            }
          }
        }
        if (effectiveDuration <= 0) effectiveDuration = 1;

        const updateProgress = (line: string) => {
            ws.appendJobLog(job.id, line);
            const timeMatch = line.match(/time=(\d+):(\d+):(\d+\.\d+)/);
            if (timeMatch) {
              const t = parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + parseFloat(timeMatch[3]);
              const pct = Math.min(99, Math.round((t / effectiveDuration) * 100));
              jq.setJobProgress(job.id, pct);
            }
          };

          child.stdout.on('data', (d: Buffer) => d.toString().split('\n').filter(Boolean).forEach(updateProgress));
          child.stderr.on('data', (d: Buffer) => d.toString().split('\n').filter(Boolean).forEach(updateProgress));
          child.on('close', (code: number | null) => code === 0 ? resolve() : reject(new Error(`ffmpeg exited with code ${code}`)));
          child.on('error', reject);
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
