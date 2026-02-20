import { FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
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
    const name = req.body?.name ?? 'Untitled Project';
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
    const updated: Project = {
      ...req.body,
      id: req.params.id,
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
    if (!text) return reply.code(400).send({ error: 'text is required' });

    // Find master audio
    let audioWavPath: string | null = null;
    const masterTrack = project.tracks.find((t) => t.type === 'audio' && t.isMaster);
    const masterClip = masterTrack?.clips[0];
    let targetAssetId = audioAssetId ?? masterClip?.assetId;

    if (targetAssetId) {
      const asset = ws.getAsset(targetAssetId);
      if (asset?.audioPath) {
        audioWavPath = path.join(ws.getWorkspaceDir(), asset.audioPath);
      }
    }

    if (!audioWavPath || !fs.existsSync(audioWavPath)) {
      return reply.code(400).send({ error: 'No audio WAV available. Import a master audio first.' });
    }

    const job = jq.createJob('lyrics', project.id);
    const lyricsOutputPath = path.join(ws.getProjectDir(project.id), 'words.json');
    const textFilePath = path.join(ws.getProjectDir(project.id), 'lyrics.txt');
    fs.mkdirSync(ws.getProjectDir(project.id), { recursive: true });
    fs.writeFileSync(textFilePath, text);

    const scriptPath = path.join(config.scriptsDir, 'align_lyrics.py');

    jq.runCommand(
      job.id,
      config.pythonBin,
      [scriptPath, audioWavPath, textFilePath, lyricsOutputPath],
      {
        onDone: () => {
          // Update project with lyrics data
          try {
            const words = JSON.parse(fs.readFileSync(lyricsOutputPath, 'utf8'));
            const proj = ws.readProject(project.id);
            if (proj) {
              proj.lyrics = {
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
              };
              ws.writeProject(proj);
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

    // Run export in background
    setImmediate(async () => {
      try {
        // Load beats for all assets
        const beatsMap = new Map<string, BeatsData>();
        for (const track of project.tracks) {
          for (const clip of track.clips) {
            if (!beatsMap.has(clip.assetId)) {
              const asset = ws.getAsset(clip.assetId);
              if (asset?.beatsPath) {
                const bp = path.join(ws.getWorkspaceDir(), asset.beatsPath);
                if (fs.existsSync(bp)) {
                  beatsMap.set(clip.assetId, JSON.parse(fs.readFileSync(bp, 'utf8')));
                }
              }
            }
          }
        }

        // Generate ASS lyrics if enabled
        if (project.lyrics?.enabled && project.lyrics.words && project.lyrics.words.length > 0) {
          const assPath = path.join(ws.getProjectDir(project.id), 'lyrics.ass');
          ffmpeg.generateAss(project.lyrics, assPath);
          ws.appendJobLog(job.id, '[export] generated ASS subtitles');
        }

        const { cmd, args } = await ffmpeg.buildExportCommand(
          project,
          {
            outputPath,
            width: req.body?.width ?? project.outputResolution.w,
            height: req.body?.height ?? project.outputResolution.h,
            crf: req.body?.crf ?? 20,
            preset: req.body?.preset ?? 'medium',
          },
          beatsMap
        );

        ws.appendJobLog(job.id, `[export] running: ${cmd} ${args.slice(0, 10).join(' ')}...`);

        await new Promise<void>((resolve, reject) => {
          const { spawn } = require('child_process');
          const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });

          const updateProgress = (line: string) => {
            ws.appendJobLog(job.id, line);
            // Parse ffmpeg progress
            const timeMatch = line.match(/time=(\d+):(\d+):(\d+\.\d+)/);
            if (timeMatch) {
              const t = parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + parseFloat(timeMatch[3]);
              const pct = Math.min(99, Math.round((t / (project.duration || 1)) * 100));
              const j = jq.getJob(job.id)!;
              ws.writeJob({ ...j, progress: pct, updatedAt: new Date().toISOString() });
            }
          };

          child.stdout.on('data', (d: Buffer) => d.toString().split('\n').forEach(updateProgress));
          child.stderr.on('data', (d: Buffer) => d.toString().split('\n').forEach(updateProgress));

          child.on('close', (code: number) => {
            if (code === 0) resolve();
            else reject(new Error(`ffmpeg exited with code ${code}`));
          });
          child.on('error', reject);
        });

        const j = jq.getJob(job.id)!;
        ws.writeJob({
          ...j,
          status: 'DONE',
          progress: 100,
          outputPath: outputPath,
          updatedAt: new Date().toISOString(),
        });
        ws.appendJobLog(job.id, `[export] done: ${outputPath}`);
      } catch (e: any) {
        ws.appendJobLog(job.id, `[export] ERROR: ${e.message}`);
        const j = jq.getJob(job.id)!;
        ws.writeJob({ ...j, status: 'ERROR', error: e.message, updatedAt: new Date().toISOString() });
      }
    });

    return reply.code(202).send({ jobId: job.id });
  });
}
