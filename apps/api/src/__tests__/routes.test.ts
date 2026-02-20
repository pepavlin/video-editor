import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import cors from '@fastify/cors';
import fs from 'fs';
import os from 'os';
import path from 'path';

let tmpDir: string;

vi.mock('../config', () => ({
  config: {
    workspaceDir: '',
    scriptsDir: '/scripts',
    pythonBin: 'python3',
    ffmpegBin: 'ffmpeg',
    ffprobeBin: 'ffprobe',
    port: 3001,
    host: '0.0.0.0',
    corsOrigin: 'http://localhost:3000',
    mediaDir: null,
  },
}));

vi.mock('../services/ffmpegService', () => ({
  probeFile: vi.fn(() => ({
    hasVideo: true,
    hasAudio: true,
    duration: 10.0,
    width: 1920,
    height: 1080,
    fps: 30,
  })),
  runImportPipeline: vi.fn().mockResolvedValue(undefined),
  buildExportCommand: vi.fn(() => ({ cmd: 'echo', args: ['done'] })),
  generateAss: vi.fn(),
}));

import { config } from '../config';
import { assetsRoutes } from '../routes/assets';
import { projectsRoutes } from '../routes/projects';
import { jobsRoutes } from '../routes/jobs';
import * as ws from '../services/workspace';

async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(cors, { origin: '*' });
  await app.register(multipart);
  await app.register(assetsRoutes, { prefix: '/api' });
  await app.register(projectsRoutes, { prefix: '/api' });
  await app.register(jobsRoutes, { prefix: '/api' });
  app.get('/health', async () => ({ status: 'ok', workspace: ws.getWorkspaceDir() }));
  await app.ready();
  return app;
}

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 've-routes-'));
  (config as any).workspaceDir = tmpDir;
  ws.ensureWorkspace();
  vi.resetModules();
});

afterEach(async () => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── Health ───────────────────────────────────────────────────────────────────

describe('GET /health', () => {
  it('returns status ok', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).status).toBe('ok');
    await app.close();
  });
});

// ─── Assets ───────────────────────────────────────────────────────────────────

describe('GET /api/assets', () => {
  it('returns empty array when no assets', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/assets' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ assets: [] });
    await app.close();
  });

  it('returns assets after upsert', async () => {
    ws.upsertAsset({
      id: 'a1',
      name: 'video.mp4',
      type: 'video',
      originalPath: 'assets/a1/original.mp4',
      duration: 5,
      createdAt: new Date().toISOString(),
    });
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/assets' });
    const body = JSON.parse(res.body);
    expect(res.statusCode).toBe(200);
    expect(body.assets).toHaveLength(1);
    expect(body.assets[0].id).toBe('a1');
    await app.close();
  });
});

describe('GET /api/assets/:id', () => {
  it('returns 404 for unknown asset', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/assets/nope' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('returns asset when found', async () => {
    ws.upsertAsset({
      id: 'a2',
      name: 'audio.mp3',
      type: 'audio',
      originalPath: 'assets/a2/original.mp3',
      duration: 120,
      createdAt: new Date().toISOString(),
    });
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/assets/a2' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).asset.id).toBe('a2');
    await app.close();
  });
});

describe('GET /api/assets/:id/waveform', () => {
  it('returns 404 when asset has no waveformPath', async () => {
    ws.upsertAsset({
      id: 'a3',
      name: 'video.mp4',
      type: 'video',
      originalPath: 'assets/a3/original.mp4',
      duration: 5,
      createdAt: new Date().toISOString(),
    });
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/assets/a3/waveform' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('returns waveform data when available', async () => {
    const assetId = 'a_wf';
    const assetDir = ws.getAssetDir(assetId);
    fs.mkdirSync(assetDir, { recursive: true });
    const wfData = { samples: [0.1, 0.5, 0.8], duration: 1, sampleRate: 100 };
    fs.writeFileSync(path.join(assetDir, 'waveform.json'), JSON.stringify(wfData));
    ws.upsertAsset({
      id: assetId,
      name: 'video.mp4',
      type: 'video',
      originalPath: `assets/${assetId}/original.mp4`,
      waveformPath: `assets/${assetId}/waveform.json`,
      duration: 1,
      createdAt: new Date().toISOString(),
    });

    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: `/api/assets/${assetId}/waveform` });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.samples).toEqual([0.1, 0.5, 0.8]);
    await app.close();
  });
});

describe('POST /api/assets/:id/analyze-beats', () => {
  it('returns 404 for unknown asset', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'POST', url: '/api/assets/nope/analyze-beats' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('returns 400 when audio WAV not ready', async () => {
    ws.upsertAsset({
      id: 'a4',
      name: 'video.mp4',
      type: 'video',
      originalPath: 'assets/a4/original.mp4',
      duration: 5,
      createdAt: new Date().toISOString(),
    });
    const app = await buildTestApp();
    const res = await app.inject({ method: 'POST', url: '/api/assets/a4/analyze-beats' });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

// ─── Projects ─────────────────────────────────────────────────────────────────

describe('POST /api/projects', () => {
  it('creates a project and returns 201', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'My Test Project' }),
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.id).toBeTruthy();
    expect(body.project.name).toBe('My Test Project');
    await app.close();
  });

  it('defaults name to Untitled Project', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.project.name).toBe('Untitled Project');
    await app.close();
  });

  it('truncates long project names to 200 chars', async () => {
    const app = await buildTestApp();
    const longName = 'A'.repeat(300);
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: longName }),
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.project.name).toHaveLength(200);
    await app.close();
  });
});

describe('GET /api/projects', () => {
  it('returns empty array when no projects', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/projects' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).projects).toEqual([]);
    await app.close();
  });

  it('returns created projects in list', async () => {
    const app = await buildTestApp();
    // Create project
    await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Listed Project' }),
    });
    const res = await app.inject({ method: 'GET', url: '/api/projects' });
    const body = JSON.parse(res.body);
    expect(body.projects).toHaveLength(1);
    expect(body.projects[0].name).toBe('Listed Project');
    // List should NOT include tracks
    expect(body.projects[0]).not.toHaveProperty('tracks');
    await app.close();
  });
});

describe('GET /api/projects/:id', () => {
  it('returns 404 for unknown project', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/projects/nonexistent' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('returns full project when found', async () => {
    const app = await buildTestApp();
    const created = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Full Project' }),
    });
    const { id } = JSON.parse(created.body);
    const res = await app.inject({ method: 'GET', url: `/api/projects/${id}` });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.project.id).toBe(id);
    expect(body.project.tracks).toBeDefined();
    await app.close();
  });
});

describe('PUT /api/projects/:id', () => {
  it('returns 404 for unknown project', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/projects/nonexistent',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tracks: [] }),
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('returns 400 when tracks is missing', async () => {
    const app = await buildTestApp();
    const created = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Proj' }),
    });
    const { id } = JSON.parse(created.body);

    const res = await app.inject({
      method: 'PUT',
      url: `/api/projects/${id}`,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'No tracks', notTracks: true }),
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('updates project and returns updated data', async () => {
    const app = await buildTestApp();
    const created = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Before Update' }),
    });
    const orig = JSON.parse(created.body).project;

    const updated = { ...orig, name: 'After Update', tracks: [] };
    const res = await app.inject({
      method: 'PUT',
      url: `/api/projects/${orig.id}`,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(updated),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.project.name).toBe('After Update');
    // ID must not be spoofed
    expect(body.project.id).toBe(orig.id);
    await app.close();
  });

  it('prevents ID spoofing via PUT body', async () => {
    const app = await buildTestApp();
    const created = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Real' }),
    });
    const orig = JSON.parse(created.body).project;

    const spoofed = { ...orig, id: 'evil_id', tracks: [] };
    const res = await app.inject({
      method: 'PUT',
      url: `/api/projects/${orig.id}`,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(spoofed),
    });
    expect(res.statusCode).toBe(200);
    // ID stays as URL param, not body
    expect(JSON.parse(res.body).project.id).toBe(orig.id);
    await app.close();
  });
});

describe('POST /api/projects/:id/align-lyrics', () => {
  it('returns 404 for unknown project', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects/unknown/align-lyrics',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'some lyrics' }),
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('returns 400 when text is empty', async () => {
    const app = await buildTestApp();
    const created = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'P' }),
    });
    const { id } = JSON.parse(created.body);

    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${id}/align-lyrics`,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '   ' }),
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('returns 400 when text exceeds 100k chars', async () => {
    const app = await buildTestApp();
    const created = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'P' }),
    });
    const { id } = JSON.parse(created.body);

    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${id}/align-lyrics`,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'x'.repeat(100_001) }),
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('returns 400 when no audio WAV is available', async () => {
    const app = await buildTestApp();
    const created = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'P' }),
    });
    const { id } = JSON.parse(created.body);

    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${id}/align-lyrics`,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'Hello World' }),
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

// ─── Jobs ─────────────────────────────────────────────────────────────────────

describe('GET /api/jobs/:id/status', () => {
  it('returns 404 for unknown job', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/jobs/nope/status' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('returns job status for known job', async () => {
    const jobId = 'test_job_1';
    const now = new Date().toISOString();
    ws.writeJob({ id: jobId, type: 'import', status: 'QUEUED', progress: 0, createdAt: now, updatedAt: now });

    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: `/api/jobs/${jobId}/status` });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.job.id).toBe(jobId);
    expect(body.job.status).toBe('QUEUED');
    expect(Array.isArray(body.job.lastLogLines)).toBe(true);
    await app.close();
  });
});

describe('GET /api/jobs/:id/output', () => {
  it('returns 404 for unknown job', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/jobs/unknown/output' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('returns 400 when job is not DONE', async () => {
    const jobId = 'job_not_done';
    const now = new Date().toISOString();
    ws.writeJob({ id: jobId, type: 'export', status: 'RUNNING', progress: 50, createdAt: now, updatedAt: now });

    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: `/api/jobs/${jobId}/output` });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('returns 404 when DONE job has no outputPath', async () => {
    const jobId = 'job_no_out';
    const now = new Date().toISOString();
    ws.writeJob({ id: jobId, type: 'export', status: 'DONE', progress: 100, createdAt: now, updatedAt: now });

    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: `/api/jobs/${jobId}/output` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('serves output file when DONE with valid outputPath', async () => {
    const jobId = 'job_with_out';
    const outputPath = path.join(tmpDir, 'projects', 'proj1', 'exports', 'export.mp4');
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, 'fake-video-content');

    const now = new Date().toISOString();
    ws.writeJob({ id: jobId, type: 'export', status: 'DONE', progress: 100, outputPath, createdAt: now, updatedAt: now });

    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: `/api/jobs/${jobId}/output` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toContain('export.mp4');
    await app.close();
  });

  it('rejects path traversal in outputPath', async () => {
    const jobId = 'job_traversal';
    const now = new Date().toISOString();
    ws.writeJob({
      id: jobId,
      type: 'export',
      status: 'DONE',
      progress: 100,
      outputPath: '/etc/passwd',
      createdAt: now,
      updatedAt: now,
    });

    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: `/api/jobs/${jobId}/output` });
    // Should reject: /etc/passwd is outside workspace
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});

// ─── Local media browser ──────────────────────────────────────────────────────

describe('GET /api/media', () => {
  it('returns 404 when mediaDir is not configured', async () => {
    (config as any).mediaDir = null;
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/media' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('returns empty files array when mediaDir exists but is empty', async () => {
    const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 've-media-'));
    (config as any).mediaDir = mediaDir;
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/media' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).files).toEqual([]);
    fs.rmSync(mediaDir, { recursive: true, force: true });
    await app.close();
  });

  it('returns only allowed file types', async () => {
    const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 've-media-'));
    fs.writeFileSync(path.join(mediaDir, 'clip.mp4'), 'fake');
    fs.writeFileSync(path.join(mediaDir, 'audio.mp3'), 'fake');
    fs.writeFileSync(path.join(mediaDir, 'readme.txt'), 'text');
    (config as any).mediaDir = mediaDir;
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/media' });
    expect(res.statusCode).toBe(200);
    const { files } = JSON.parse(res.body);
    const names = files.map((f: { name: string }) => f.name);
    expect(names).toContain('clip.mp4');
    expect(names).toContain('audio.mp3');
    expect(names).not.toContain('readme.txt');
    fs.rmSync(mediaDir, { recursive: true, force: true });
    await app.close();
  });
});

describe('POST /api/assets/link', () => {
  it('returns 400 when mediaDir is not configured', async () => {
    (config as any).mediaDir = null;
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/assets/link',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ filename: 'clip.mp4' }),
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('returns 400 when filename is missing', async () => {
    const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 've-media-'));
    (config as any).mediaDir = mediaDir;
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/assets/link',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.statusCode).toBe(400);
    fs.rmSync(mediaDir, { recursive: true, force: true });
    await app.close();
  });

  it('returns 404 when file does not exist in mediaDir', async () => {
    const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 've-media-'));
    (config as any).mediaDir = mediaDir;
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/assets/link',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ filename: 'missing.mp4' }),
    });
    expect(res.statusCode).toBe(404);
    fs.rmSync(mediaDir, { recursive: true, force: true });
    await app.close();
  });

  it('blocks path traversal attempts', async () => {
    const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 've-media-'));
    (config as any).mediaDir = mediaDir;
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/assets/link',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ filename: '../../../etc/passwd' }),
    });
    // basename strips the traversal, so the file simply won't exist in mediaDir
    expect(res.statusCode).toBe(404);
    fs.rmSync(mediaDir, { recursive: true, force: true });
    await app.close();
  });

  it('creates asset with symlink and starts import job', async () => {
    const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 've-media-'));
    fs.writeFileSync(path.join(mediaDir, 'clip.mp4'), 'fake-video');
    (config as any).mediaDir = mediaDir;

    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/assets/link',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ filename: 'clip.mp4' }),
    });
    expect(res.statusCode).toBe(202);
    const body = JSON.parse(res.body);
    expect(body.assetId).toBeTruthy();
    expect(body.jobId).toBeTruthy();

    // Asset should be registered
    const asset = ws.getAsset(body.assetId);
    expect(asset).toBeTruthy();
    expect(asset!.name).toBe('clip.mp4');

    // Original path should be a symlink
    const originalAbs = path.join(tmpDir, asset!.originalPath);
    expect(fs.lstatSync(originalAbs).isSymbolicLink()).toBe(true);

    fs.rmSync(mediaDir, { recursive: true, force: true });
    await app.close();
  });
});
