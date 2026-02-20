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

export async function assetsRoutes(app: FastifyInstance) {
  // POST /assets/import
  app.post('/assets/import', async (req, reply) => {
    const data = await req.file();
    if (!data) {
      return reply.code(400).send({ error: 'No file uploaded' });
    }

    const assetId = `asset_${uuidv4().replace(/-/g, '').slice(0, 12)}`;
    const assetDir = ws.getAssetDir(assetId);
    fs.mkdirSync(assetDir, { recursive: true });

    const ext = path.extname(data.filename).toLowerCase();
    const originalPath = path.join(assetDir, `original${ext}`);

    // Save upload
    await pipeline(data.file, fs.createWriteStream(originalPath));

    // Probe
    let probe: ffmpeg.ProbeResult;
    try {
      probe = ffmpeg.probeFile(originalPath);
    } catch (e: any) {
      fs.rmSync(assetDir, { recursive: true });
      return reply.code(400).send({ error: 'Cannot probe file', details: e.message });
    }

    const isAudio = !probe.hasVideo && probe.hasAudio;
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

    // Start import job
    const job = jq.createJob('import', assetId);

    // Run in background
    setImmediate(async () => {
      try {
        await ffmpeg.runImportPipeline(job.id, assetId, originalPath, probe);
        const j = jq.getJob(job.id)!;
        ws.writeJob({ ...j, status: 'DONE', progress: 100 });
      } catch (e: any) {
        ws.appendJobLog(job.id, `ERROR: ${e.message}`);
        const j = jq.getJob(job.id)!;
        ws.writeJob({ ...j, status: 'ERROR', error: e.message });
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
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    return reply.send(data);
  });

  // GET /assets/:id/beats
  app.get<{ Params: { id: string } }>('/assets/:id/beats', async (req, reply) => {
    const asset = ws.getAsset(req.params.id);
    if (!asset?.beatsPath) return reply.code(404).send({ error: 'Beats not ready' });
    const p = path.join(ws.getWorkspaceDir(), asset.beatsPath);
    if (!fs.existsSync(p)) return reply.code(404).send({ error: 'Beats file missing' });
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    return reply.send(data);
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
          asset.beatsPath = `assets/${asset.id}/beats.json`;
          ws.upsertAsset(asset);
        },
        outputPath: beatsOutputPath,
      }
    );

    return reply.code(202).send({ jobId: job.id });
  });

  // POST /assets/:id/cutout - start cutout mask generation
  app.post<{ Params: { id: string } }>('/assets/:id/cutout', async (req, reply) => {
    const asset = ws.getAsset(req.params.id);
    if (!asset || asset.type !== 'video') {
      return reply.code(404).send({ error: 'Video asset not found' });
    }

    const proxyPath = asset.proxyPath
      ? path.join(ws.getWorkspaceDir(), asset.proxyPath)
      : path.join(ws.getWorkspaceDir(), asset.originalPath);

    if (!fs.existsSync(proxyPath)) {
      return reply.code(400).send({ error: 'Proxy not ready' });
    }

    const job = jq.createJob('cutout', asset.id);
    const maskOutputPath = path.join(ws.getAssetDir(asset.id), 'mask.mp4');
    const scriptPath = path.join(config.scriptsDir, 'cutout.py');

    jq.runCommand(
      job.id,
      config.pythonBin,
      [scriptPath, proxyPath, maskOutputPath],
      {
        onDone: () => {
          asset.maskPath = `assets/${asset.id}/mask.mp4`;
          ws.upsertAsset(asset);
        },
        outputPath: maskOutputPath,
      }
    );

    return reply.code(202).send({ jobId: job.id });
  });
}
