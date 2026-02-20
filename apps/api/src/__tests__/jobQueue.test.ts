import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

let tmpDir: string;

vi.mock('../config', () => ({
  config: {
    workspaceDir: '',
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

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 've-jq-'));
  (config as any).workspaceDir = tmpDir;
  fs.mkdirSync(path.join(tmpDir, 'jobs'), { recursive: true });

  // Reset job queue module state between tests
  vi.resetModules();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('jobQueue', () => {
  it('createJob creates a job with QUEUED status', async () => {
    const { createJob } = await import('../services/jobQueue');
    const job = createJob('import', 'asset_1');

    expect(job.id).toBeTruthy();
    expect(job.type).toBe('import');
    expect(job.status).toBe('QUEUED');
    expect(job.progress).toBe(0);
    expect(job.relatedId).toBe('asset_1');
  });

  it('createJob persists to disk', async () => {
    const { createJob } = await import('../services/jobQueue');
    const { readJob } = await import('../services/workspace');
    const job = createJob('beats', 'asset_2');

    const saved = readJob(job.id);
    expect(saved).not.toBeNull();
    expect(saved?.id).toBe(job.id);
    expect(saved?.type).toBe('beats');
  });

  it('getJob returns job from memory after creation', async () => {
    const { createJob, getJob } = await import('../services/jobQueue');
    const job = createJob('export', 'proj_1');
    const retrieved = getJob(job.id);
    expect(retrieved?.id).toBe(job.id);
  });

  it('getJob falls back to disk for unknown jobs', async () => {
    const { getJob } = await import('../services/jobQueue');
    const { writeJob } = await import('../services/workspace');

    // Write a job directly to disk
    const diskJob = {
      id: 'disk_job_1',
      type: 'import' as const,
      status: 'DONE' as const,
      progress: 100,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    writeJob(diskJob);

    const retrieved = getJob('disk_job_1');
    expect(retrieved?.status).toBe('DONE');
  });

  it('getJob returns null for completely unknown jobs', async () => {
    const { getJob } = await import('../services/jobQueue');
    expect(getJob('nonexistent_job')).toBeNull();
  });

  it('runCommand transitions job to RUNNING then DONE', async () => {
    const { createJob, getJob, runCommand } = await import('../services/jobQueue');
    const job = createJob('beats');

    await new Promise<void>((resolve) => {
      runCommand(job.id, 'echo', ['hello'], {
        onDone: () => resolve(),
      });
    });

    const finalJob = getJob(job.id);
    expect(finalJob?.status).toBe('DONE');
    expect(finalJob?.progress).toBe(100);
  });

  it('runCommand transitions job to ERROR on failure', async () => {
    const { createJob, getJob, runCommand } = await import('../services/jobQueue');
    const job = createJob('export');

    await new Promise<void>((resolve) => {
      runCommand(job.id, 'false', [], {
        onError: () => resolve(),
      });
    });

    const finalJob = getJob(job.id);
    expect(finalJob?.status).toBe('ERROR');
    expect(finalJob?.error).toBeTruthy();
  });

  it('runCommand calls onDone with correct outputPath', async () => {
    const { createJob, getJob, runCommand } = await import('../services/jobQueue');
    const job = createJob('export');
    const outputPath = '/tmp/test-output.mp4';

    await new Promise<void>((resolve) => {
      runCommand(job.id, 'echo', ['done'], {
        onDone: resolve,
        outputPath,
      });
    });

    const finalJob = getJob(job.id);
    expect(finalJob?.outputPath).toBe(outputPath);
  });

  it('runCommand logs stdout to job log', async () => {
    const { createJob, runCommand } = await import('../services/jobQueue');
    const { readJobLog } = await import('../services/workspace');
    const job = createJob('import');
    const marker = `UNIQUE_MARKER_${Date.now()}`;

    await new Promise<void>((resolve) => {
      runCommand(job.id, 'echo', [marker], { onDone: resolve });
    });

    const logs = readJobLog(job.id);
    expect(logs.some((l) => l.includes(marker))).toBe(true);
  });

  it('runCommand handles non-existent commands gracefully', async () => {
    const { createJob, getJob, runCommand } = await import('../services/jobQueue');
    const job = createJob('import');

    await new Promise<void>((resolve) => {
      runCommand(job.id, 'this_command_does_not_exist_xyz', [], {
        onError: () => resolve(),
      });
    });

    const finalJob = getJob(job.id);
    expect(finalJob?.status).toBe('ERROR');
  });
});

describe('runSequential', () => {
  it('runs multiple commands in order', async () => {
    const { createJob, getJob, runSequential } = await import('../services/jobQueue');
    const job = createJob('export');

    await runSequential(job.id, [
      { cmd: 'echo', args: ['step1'], progressStart: 0, progressEnd: 50 },
      { cmd: 'echo', args: ['step2'], progressStart: 50, progressEnd: 100 },
    ]);

    const finalJob = getJob(job.id);
    expect(finalJob?.status).toBe('DONE');
    expect(finalJob?.progress).toBe(100);
  });

  it('stops on first failure', async () => {
    const { createJob, getJob, runSequential } = await import('../services/jobQueue');
    const job = createJob('export');

    await expect(
      runSequential(job.id, [
        { cmd: 'false', args: [], progressStart: 0, progressEnd: 50 },
        { cmd: 'echo', args: ['should not run'], progressStart: 50, progressEnd: 100 },
      ])
    ).rejects.toThrow();

    const finalJob = getJob(job.id);
    expect(finalJob?.status).toBe('ERROR');
  });
});
