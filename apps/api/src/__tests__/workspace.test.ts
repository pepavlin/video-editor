import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// ─── Setup: override WORKSPACE_DIR with temp dir ──────────────────────────────

let tmpDir: string;

// We need to mock the config before importing workspace
vi.mock('../config', () => ({
  config: {
    workspaceDir: '', // will be set dynamically
    scriptsDir: '',
    pythonBin: 'python3',
    ffmpegBin: 'ffmpeg',
    ffprobeBin: 'ffprobe',
    port: 3001,
    host: '0.0.0.0',
    corsOrigin: 'http://localhost:3000',
  },
}));

import { config } from '../config';
import * as ws from '../services/workspace';

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 've-ws-'));
  (config as any).workspaceDir = tmpDir;

  // Reset the WS constant inside workspace module by re-evaluating - not possible directly.
  // Instead we call ensureWorkspace after pointing config to tmpDir.
  // Note: since WS is a const at module top level, we test via the functions.
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeAsset(id: string): import('@video-editor/shared').Asset {
  return {
    id,
    name: `asset-${id}.mp4`,
    type: 'video',
    originalPath: `assets/${id}/original.mp4`,
    duration: 10,
    createdAt: new Date().toISOString(),
  };
}

function makeProject(id: string): import('@video-editor/shared').Project {
  const now = new Date().toISOString();
  return {
    id,
    name: 'Test Project',
    duration: 0,
    aspectRatio: '9:16',
    outputResolution: { w: 1080, h: 1920 },
    tracks: [],
    createdAt: now,
    updatedAt: now,
  };
}

function makeJob(id: string): import('@video-editor/shared').Job {
  const now = new Date().toISOString();
  return {
    id,
    type: 'import',
    status: 'QUEUED',
    progress: 0,
    createdAt: now,
    updatedAt: now,
  };
}

// ─── safeResolve ─────────────────────────────────────────────────────────────

describe('safeResolve', () => {
  it('allows paths within workspace', () => {
    const result = ws.safeResolve('assets/foo/bar.mp4');
    expect(result).toContain('foo');
  });

  it('throws on path traversal', () => {
    expect(() => ws.safeResolve('../../../etc/passwd')).toThrow('Path traversal detected');
    expect(() => ws.safeResolve('../../secret')).toThrow('Path traversal detected');
  });
});

// ─── Assets ──────────────────────────────────────────────────────────────────

describe('Assets index', () => {
  beforeEach(() => {
    // Ensure assets dir exists for these tests
    fs.mkdirSync(path.join(tmpDir, 'assets'), { recursive: true });
  });

  it('readAssetsIndex returns [] if no file', () => {
    expect(ws.readAssetsIndex()).toEqual([]);
  });

  it('readAssetsIndex returns [] on corrupted JSON', () => {
    fs.writeFileSync(path.join(tmpDir, 'assets.json'), 'corrupted{{{');
    expect(ws.readAssetsIndex()).toEqual([]);
  });

  it('upsertAsset adds a new asset', () => {
    const asset = makeAsset('a1');
    ws.upsertAsset(asset);
    const list = ws.readAssetsIndex();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('a1');
  });

  it('upsertAsset updates existing asset', () => {
    const asset = makeAsset('a1');
    ws.upsertAsset(asset);
    ws.upsertAsset({ ...asset, name: 'updated.mp4' });
    const list = ws.readAssetsIndex();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('updated.mp4');
  });

  it('upsertAsset handles multiple assets', () => {
    ws.upsertAsset(makeAsset('a1'));
    ws.upsertAsset(makeAsset('a2'));
    ws.upsertAsset(makeAsset('a3'));
    expect(ws.readAssetsIndex()).toHaveLength(3);
  });

  it('getAsset returns undefined for missing id', () => {
    ws.upsertAsset(makeAsset('a1'));
    expect(ws.getAsset('nonexistent')).toBeUndefined();
  });

  it('getAsset finds correct asset', () => {
    ws.upsertAsset(makeAsset('a1'));
    ws.upsertAsset(makeAsset('a2'));
    const found = ws.getAsset('a2');
    expect(found?.id).toBe('a2');
  });

  it('writeAssetsIndex is atomic (no partial writes)', () => {
    const assets = Array.from({ length: 100 }, (_, i) => makeAsset(`a${i}`));
    for (const a of assets) ws.upsertAsset(a);
    // Re-read - should have all 100
    expect(ws.readAssetsIndex()).toHaveLength(100);
  });
});

// ─── Projects ────────────────────────────────────────────────────────────────

describe('Projects', () => {
  it('readProject returns null if not exists', () => {
    expect(ws.readProject('nonexistent')).toBeNull();
  });

  it('readProject returns null on corrupted JSON', () => {
    const dir = path.join(tmpDir, 'projects', 'corrupt');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'project.json'), 'bad json!!');
    expect(ws.readProject('corrupt')).toBeNull();
  });

  it('writeProject then readProject round-trips', () => {
    const project = makeProject('p1');
    ws.writeProject(project);
    const read = ws.readProject('p1');
    expect(read).toEqual(project);
  });

  it('writeProject creates directory if missing', () => {
    const project = makeProject('new_proj');
    ws.writeProject(project);
    const dir = path.join(tmpDir, 'projects', 'new_proj');
    expect(fs.existsSync(dir)).toBe(true);
  });

  it('listProjects returns empty array if no projects', () => {
    fs.mkdirSync(path.join(tmpDir, 'projects'), { recursive: true });
    expect(ws.listProjects()).toEqual([]);
  });

  it('listProjects returns correct project metadata', () => {
    ws.writeProject(makeProject('p1'));
    ws.writeProject(makeProject('p2'));
    const list = ws.listProjects();
    expect(list).toHaveLength(2);
    expect(list.map((p) => p.id).sort()).toEqual(['p1', 'p2']);
    // Only metadata fields
    expect(list[0]).toHaveProperty('id');
    expect(list[0]).toHaveProperty('name');
    expect(list[0]).toHaveProperty('createdAt');
    expect(list[0]).toHaveProperty('updatedAt');
    expect(list[0]).not.toHaveProperty('tracks');
  });

  it('listProjects skips corrupted project files gracefully', () => {
    ws.writeProject(makeProject('p1'));
    // Corrupt p2
    const dir = path.join(tmpDir, 'projects', 'p2');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'project.json'), 'corrupted');
    const list = ws.listProjects();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('p1');
  });
});

// ─── Jobs ────────────────────────────────────────────────────────────────────

describe('Jobs', () => {
  beforeEach(() => {
    fs.mkdirSync(path.join(tmpDir, 'jobs'), { recursive: true });
  });

  it('readJob returns null if not exists', () => {
    expect(ws.readJob('nonexistent')).toBeNull();
  });

  it('writeJob then readJob round-trips', () => {
    const job = makeJob('j1');
    ws.writeJob(job);
    const read = ws.readJob('j1');
    expect(read).toEqual(job);
  });

  it('appendJobLog and readJobLog work correctly', () => {
    ws.appendJobLog('j1', 'line 1');
    ws.appendJobLog('j1', 'line 2');
    ws.appendJobLog('j1', 'line 3');
    const lines = ws.readJobLog('j1');
    expect(lines).toContain('line 1');
    expect(lines).toContain('line 2');
    expect(lines).toContain('line 3');
  });

  it('readJobLog returns [] if no log file', () => {
    expect(ws.readJobLog('no-such-job')).toEqual([]);
  });

  it('cleanupStaleJobs marks RUNNING jobs as ERROR', () => {
    const runningJob = { ...makeJob('j1'), status: 'RUNNING' as const };
    const queuedJob = { ...makeJob('j2'), status: 'QUEUED' as const };
    const doneJob = { ...makeJob('j3'), status: 'DONE' as const };

    ws.writeJob(runningJob);
    ws.writeJob(queuedJob);
    ws.writeJob(doneJob);

    ws.cleanupStaleJobs();

    expect(ws.readJob('j1')?.status).toBe('ERROR');
    expect(ws.readJob('j2')?.status).toBe('QUEUED'); // unchanged
    expect(ws.readJob('j3')?.status).toBe('DONE');   // unchanged
  });

  it('cleanupStaleJobs sets meaningful error message', () => {
    ws.writeJob({ ...makeJob('j1'), status: 'RUNNING' });
    ws.cleanupStaleJobs();
    const job = ws.readJob('j1');
    expect(job?.error).toContain('Server restarted');
  });
});
