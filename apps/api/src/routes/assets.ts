import { FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { pipeline } from 'stream/promises';
import { config } from '../config';
import * as ws from '../services/workspace';
import * as ffmpeg from '../services/ffmpegService';
import * as jq from '../services/jobQueue';
import type { Asset } from '@video-editor/shared';

// Allowed file extensions for import
const ALLOWED_EXTENSIONS = new Set([
  '.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v',  // video
  '.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg',  // audio
]);

const ALLOWED_MIME_PREFIXES = ['video/', 'audio/'];

export async function assetsRoutes(app: FastifyInstance) {
  // POST /assets/import
  app.post('/assets/import', async (req, reply) => {
    const data = await req.file();
    if (!data) {
      return reply.code(400).send({ error: 'No file uploaded' });
    }

    // Validate file extension
    const ext = path.extname(data.filename).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      // Drain the stream to prevent hanging
      data.file.resume();
      return reply.code(400).send({
        error: `File type not allowed: ${ext}. Allowed: ${[...ALLOWED_EXTENSIONS].join(', ')}`,
      });
    }

    const assetId = `asset_${uuidv4().replace(/-/g, '').slice(0, 12)}`;
    const assetDir = ws.getAssetDir(assetId);
    fs.mkdirSync(assetDir, { recursive: true });

    const originalPath = path.join(assetDir, `original${ext}`);

    // Save upload
    try {
      await pipeline(data.file, fs.createWriteStream(originalPath));
    } catch (e: any) {
      fs.rmSync(assetDir, { recursive: true, force: true });
      return reply.code(500).send({ error: 'Failed to save file', details: e.message });
    }

    // Probe file
    let probe: ffmpeg.ProbeResult;
    try {
      probe = ffmpeg.probeFile(originalPath);
    } catch (e: any) {
      fs.rmSync(assetDir, { recursive: true, force: true });
      return reply.code(400).send({ error: 'Cannot probe file (is it a valid video/audio?)', details: e.message });
    }

    if (!probe.hasVideo && !probe.hasAudio) {
      fs.rmSync(assetDir, { recursive: true, force: true });
      return reply.code(400).send({ error: 'File has no audio or video streams' });
    }

    const assetType: Asset['type'] = probe.hasVideo ? 'video' : 'audio';

    const asset: Asset = {
      id: assetId,
      name: data.filename,
      type: assetType,
      originalPath: `assets/${assetId}/original${ext}`,
      duration: probe.duration,
      width: probe.width,
      height: probe.height,
      fps: probe.fps,
      createdAt: new Date().toISOString(),
    };
    ws.upsertAsset(asset);

    // Start import job (proxy + waveform)
    const job = jq.createJob('import', assetId);

    setImmediate(async () => {
      try {
        await ffmpeg.runImportPipeline(job.id, assetId, originalPath, probe);
        const j = jq.getJob(job.id);
        if (j) ws.writeJob({ ...j, status: 'DONE', progress: 100, updatedAt: new Date().toISOString() });
      } catch (e: any) {
        ws.appendJobLog(job.id, `ERROR: ${e.message}`);
        const j = jq.getJob(job.id);
        if (j) ws.writeJob({ ...j, status: 'ERROR', error: e.message, updatedAt: new Date().toISOString() });
      }
    });

    return reply.code(202).send({ jobId: job.id, assetId });
  });

  // GET /assets
  app.get('/assets', async (_req, reply) => {
    const assets = ws.readAssetsIndex();
    return reply.send({ assets });
  });

  // GET /assets/:id
  app.get<{ Params: { id: string } }>('/assets/:id', async (req, reply) => {
    const asset = ws.getAsset(req.params.id);
    if (!asset) return reply.code(404).send({ error: 'Asset not found' });
    return reply.send({ asset });
  });

  // GET /assets/:id/waveform
  app.get<{ Params: { id: string } }>('/assets/:id/waveform', async (req, reply) => {
    const asset = ws.getAsset(req.params.id);
    if (!asset?.waveformPath) return reply.code(404).send({ error: 'Waveform not ready' });
    const p = path.join(ws.getWorkspaceDir(), asset.waveformPath);
    if (!fs.existsSync(p)) return reply.code(404).send({ error: 'Waveform file missing' });
    try {
      const data = JSON.parse(fs.readFileSync(p, 'utf8'));
      return reply.send(data);
    } catch {
      return reply.code(500).send({ error: 'Waveform data corrupted' });
    }
  });

  // GET /assets/:id/beats
  app.get<{ Params: { id: string } }>('/assets/:id/beats', async (req, reply) => {
    const asset = ws.getAsset(req.params.id);
    if (!asset?.beatsPath) return reply.code(404).send({ error: 'Beats not ready' });
    const p = path.join(ws.getWorkspaceDir(), asset.beatsPath);
    if (!fs.existsSync(p)) return reply.code(404).send({ error: 'Beats file missing' });
    try {
      const data = JSON.parse(fs.readFileSync(p, 'utf8'));
      return reply.send(data);
    } catch {
      return reply.code(500).send({ error: 'Beats data corrupted' });
    }
  });

  // POST /assets/:id/analyze-beats
  app.post<{ Params: { id: string } }>('/assets/:id/analyze-beats', async (req, reply) => {
    const asset = ws.getAsset(req.params.id);
    if (!asset) return reply.code(404).send({ error: 'Asset not found' });

    const audioWavPath = asset.audioPath
      ? path.join(ws.getWorkspaceDir(), asset.audioPath)
      : null;
    if (!audioWavPath || !fs.existsSync(audioWavPath)) {
      return reply.code(400).send({ error: 'Audio WAV not ready - import may still be processing' });
    }

    const job = jq.createJob('beats', asset.id);
    const beatsOutputPath = path.join(ws.getAssetDir(asset.id), 'beats.json');
    const scriptPath = path.join(config.scriptsDir, 'beat_detect.py');

    jq.runCommand(
      job.id,
      config.pythonBin,
      [scriptPath, audioWavPath, beatsOutputPath],
      {
        onDone: () => {
          // Re-read asset to avoid stale closure
          const latestAsset = ws.getAsset(asset.id);
          if (latestAsset) {
            ws.upsertAsset({ ...latestAsset, beatsPath: `assets/${asset.id}/beats.json` });
          }
        },
        outputPath: beatsOutputPath,
      }
    );

    return reply.code(202).send({ jobId: job.id });
  });

  // GET /media - list files available in the mounted local media directory
  app.get('/media', async (_req, reply) => {
    if (!config.mediaDir) {
      return reply.code(404).send({ error: 'Local media directory not configured (set MEDIA_DIR env var)' });
    }
    if (!fs.existsSync(config.mediaDir)) {
      return reply.send({ files: [] });
    }
    const files = fs.readdirSync(config.mediaDir)
      .filter((f) => {
        const ext = path.extname(f).toLowerCase();
        return ALLOWED_EXTENSIONS.has(ext) && fs.statSync(path.join(config.mediaDir!, f)).isFile();
      })
      .map((f) => ({
        name: f,
        size: fs.statSync(path.join(config.mediaDir!, f)).size,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return reply.send({ files });
  });

  // POST /assets/link - link a file from the local media dir without copying
  app.post<{ Body: { filename: string } }>('/assets/link', async (req, reply) => {
    if (!config.mediaDir) {
      return reply.code(400).send({ error: 'Local media directory not configured' });
    }

    const { filename } = req.body ?? {};
    if (!filename) return reply.code(400).send({ error: 'filename is required' });

    // Strip path components to prevent traversal
    const basename = path.basename(filename);
    const sourcePath = path.join(config.mediaDir, basename);

    // Double-check resolved path is still inside mediaDir
    if (!path.resolve(sourcePath).startsWith(path.resolve(config.mediaDir))) {
      return reply.code(400).send({ error: 'Invalid filename' });
    }

    if (!fs.existsSync(sourcePath)) {
      return reply.code(404).send({ error: 'File not found in media directory' });
    }

    const ext = path.extname(basename).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return reply.code(400).send({ error: `File type not allowed: ${ext}` });
    }

    const assetId = `asset_${uuidv4().replace(/-/g, '').slice(0, 12)}`;
    const assetDir = ws.getAssetDir(assetId);
    fs.mkdirSync(assetDir, { recursive: true });

    // Symlink to the original instead of copying — instant regardless of file size
    const originalPath = path.join(assetDir, `original${ext}`);
    fs.symlinkSync(sourcePath, originalPath);

    let probe: ffmpeg.ProbeResult;
    try {
      probe = ffmpeg.probeFile(originalPath);
    } catch (e: any) {
      fs.rmSync(assetDir, { recursive: true, force: true });
      return reply.code(400).send({ error: 'Cannot probe file', details: e.message });
    }

    if (!probe.hasVideo && !probe.hasAudio) {
      fs.rmSync(assetDir, { recursive: true, force: true });
      return reply.code(400).send({ error: 'File has no audio or video streams' });
    }

    const assetType: Asset['type'] = probe.hasVideo ? 'video' : 'audio';
    const asset: Asset = {
      id: assetId,
      name: basename,
      type: assetType,
      originalPath: `assets/${assetId}/original${ext}`,
      duration: probe.duration,
      width: probe.width,
      height: probe.height,
      fps: probe.fps,
      createdAt: new Date().toISOString(),
    };
    ws.upsertAsset(asset);

    // Start import pipeline (proxy + waveform) in background — same as regular import
    const job = jq.createJob('import', assetId);
    setImmediate(async () => {
      try {
        await ffmpeg.runImportPipeline(job.id, assetId, originalPath, probe);
        const j = jq.getJob(job.id);
        if (j) ws.writeJob({ ...j, status: 'DONE', progress: 100, updatedAt: new Date().toISOString() });
      } catch (e: any) {
        ws.appendJobLog(job.id, `ERROR: ${e.message}`);
        const j = jq.getJob(job.id);
        if (j) ws.writeJob({ ...j, status: 'ERROR', error: e.message, updatedAt: new Date().toISOString() });
      }
    });

    return reply.code(202).send({ jobId: job.id, assetId });
  });

  // POST /assets/:id/head-stabilize - start head-tracking stabilization job
  app.post<{
    Params: { id: string };
    Body: { smoothingX?: number; smoothingY?: number; smoothingZ?: number };
  }>('/assets/:id/head-stabilize', async (req, reply) => {
    const asset = ws.getAsset(req.params.id);
    if (!asset || asset.type !== 'video') {
      return reply.code(404).send({ error: 'Video asset not found' });
    }

    const proxyPath = asset.proxyPath
      ? path.join(ws.getWorkspaceDir(), asset.proxyPath)
      : path.join(ws.getWorkspaceDir(), asset.originalPath);

    if (!fs.existsSync(proxyPath)) {
      return reply.code(400).send({ error: 'Proxy not ready - import may still be processing' });
    }

    const body = req.body ?? {};
    const sx = String(Math.max(0, Math.min(1, body.smoothingX ?? 0.7)));
    const sy = String(Math.max(0, Math.min(1, body.smoothingY ?? 0.7)));
    const sz = String(Math.max(0, Math.min(1, body.smoothingZ ?? 0.0)));

    const job = jq.createJob('headStabilization', asset.id);
    const stabilizedOutputPath = path.join(ws.getAssetDir(asset.id), 'head_stabilized.mp4');
    const scriptPath = path.join(config.scriptsDir, 'head_stabilize.py');

    jq.runCommand(
      job.id,
      config.pythonBin,
      [scriptPath, proxyPath, stabilizedOutputPath, sx, sy, sz],
      {
        onDone: () => {
          const latestAsset = ws.getAsset(asset.id);
          if (latestAsset) {
            ws.upsertAsset({
              ...latestAsset,
              headStabilizedPath: `assets/${asset.id}/head_stabilized.mp4`,
            });
          }
        },
        outputPath: stabilizedOutputPath,
      }
    );

    return reply.code(202).send({ jobId: job.id });
  });

  // POST /assets/:id/cutout - start cutout mask generation
  // Body: { mode?: 'removeBg' | 'removePerson' }
  app.post<{ Params: { id: string }; Body: { mode?: string } }>('/assets/:id/cutout', async (req, reply) => {
    const asset = ws.getAsset(req.params.id);
    if (!asset || asset.type !== 'video') {
      return reply.code(404).send({ error: 'Video asset not found' });
    }

    const proxyPath = asset.proxyPath
      ? path.join(ws.getWorkspaceDir(), asset.proxyPath)
      : path.join(ws.getWorkspaceDir(), asset.originalPath);

    if (!fs.existsSync(proxyPath)) {
      return reply.code(400).send({ error: 'Proxy not ready - import may still be processing' });
    }

    const mode = req.body?.mode === 'removePerson' ? 'removePerson' : 'removeBg';

    const job = jq.createJob('cutout', asset.id);
    const maskOutputPath = path.join(ws.getAssetDir(asset.id), 'mask.mp4');
    const scriptPath = path.join(config.scriptsDir, 'cutout.py');

    jq.runCommand(
      job.id,
      config.pythonBin,
      [scriptPath, proxyPath, maskOutputPath, mode],
      {
        onDone: () => {
          const latestAsset = ws.getAsset(asset.id);
          if (latestAsset) {
            ws.upsertAsset({ ...latestAsset, maskPath: `assets/${asset.id}/mask.mp4` });
          }
        },
        outputPath: maskOutputPath,
      }
    );

    return reply.code(202).send({ jobId: job.id });
  });
}
