import { spawn, ChildProcess } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import type { Job, JobType } from '@video-editor/shared';
import * as ws from './workspace';

// In-memory map for quick status checks (persisted to disk too)
const activeJobs = new Map<string, Job>();

// Map of running child processes (for cancellation)
const activeProcesses = new Map<string, ChildProcess>();

export function createJob(type: JobType, relatedId?: string): Job {
  const now = new Date().toISOString();
  const job: Job = {
    id: uuidv4(),
    type,
    status: 'QUEUED',
    progress: 0,
    relatedId,
    createdAt: now,
    updatedAt: now,
  };
  activeJobs.set(job.id, job);
  ws.writeJob(job);
  return job;
}

export function getJob(jobId: string): Job | null {
  if (activeJobs.has(jobId)) {
    return activeJobs.get(jobId)!;
  }
  return ws.readJob(jobId);
}

function updateJob(jobId: string, updates: Partial<Job>) {
  const job = getJob(jobId);
  if (!job) return;
  const updated: Job = { ...job, ...updates, updatedAt: new Date().toISOString() };
  activeJobs.set(jobId, updated);
  ws.writeJob(updated);
}

export function cancelJob(jobId: string): boolean {
  const job = getJob(jobId);
  if (!job) return false;
  if (job.status !== 'RUNNING' && job.status !== 'QUEUED') return false;

  const child = activeProcesses.get(jobId);
  if (child) {
    child.kill('SIGTERM');
    // Give process a moment to exit gracefully, then force kill if needed
    setTimeout(() => {
      if (activeProcesses.has(jobId)) {
        child.kill('SIGKILL');
      }
    }, 3000);
  }

  updateJob(jobId, { status: 'CANCELLED', error: 'Cancelled by user' });
  ws.appendJobLog(jobId, 'Job cancelled by user');
  activeProcesses.delete(jobId);
  return true;
}

export function runCommand(
  jobId: string,
  cmd: string,
  args: string[],
  {
    onProgress,
    onDone,
    onError,
    outputPath,
  }: {
    onProgress?: (line: string) => number | undefined;
    onDone?: () => void;
    onError?: (err: string) => void;
    outputPath?: string;
  } = {}
): ChildProcess {
  updateJob(jobId, { status: 'RUNNING', progress: 0 });
  ws.appendJobLog(jobId, `$ ${cmd} ${args.join(' ')}`);

  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  activeProcesses.set(jobId, child);

  const handleLine = (line: string) => {
    ws.appendJobLog(jobId, line);
    if (onProgress) {
      const progress = onProgress(line);
      if (progress !== undefined) {
        updateJob(jobId, { progress });
      }
    }
  };

  child.stdout.on('data', (d: Buffer) => {
    d.toString().split('\n').filter(Boolean).forEach(handleLine);
  });
  child.stderr.on('data', (d: Buffer) => {
    d.toString().split('\n').filter(Boolean).forEach(handleLine);
  });

  child.on('close', (code, signal) => {
    activeProcesses.delete(jobId);

    // Check if the job was already marked as CANCELLED (cancelJob() was called)
    const currentJob = getJob(jobId);
    if (currentJob?.status === 'CANCELLED') {
      // Already handled by cancelJob()
      return;
    }

    // Process killed by signal (e.g. SIGTERM) without explicit cancel → treat as cancelled
    if (signal !== null && code === null) {
      updateJob(jobId, { status: 'CANCELLED', error: 'Cancelled by user' });
      ws.appendJobLog(jobId, `Process terminated by signal ${signal}`);
      return;
    }

    if (code === 0) {
      updateJob(jobId, { status: 'DONE', progress: 100, outputPath });
      onDone?.();
    } else {
      const err = `Process exited with code ${code}`;
      ws.appendJobLog(jobId, err);
      updateJob(jobId, { status: 'ERROR', error: err });
      onError?.(err);
    }
  });

  child.on('error', (err) => {
    activeProcesses.delete(jobId);
    ws.appendJobLog(jobId, err.message);
    updateJob(jobId, { status: 'ERROR', error: err.message });
    onError?.(err.message);
  });

  return child;
}

// Update progress in both in-memory map and disk (for routes that manage their own processes)
export function setJobProgress(jobId: string, progress: number) {
  updateJob(jobId, { progress });
}

export function setJobDone(jobId: string, outputPath?: string) {
  updateJob(jobId, { status: 'DONE', progress: 100, outputPath });
}

export function setJobError(jobId: string, error: string) {
  updateJob(jobId, { status: 'ERROR', error });
}

// For jobs that run multiple commands in sequence
export async function runSequential(
  jobId: string,
  steps: Array<{ cmd: string; args: string[]; progressStart: number; progressEnd: number }>
): Promise<void> {
  updateJob(jobId, { status: 'RUNNING', progress: 0 });

  for (const step of steps) {
    // Check if cancelled before starting next step
    const currentJob = getJob(jobId);
    if (currentJob?.status === 'CANCELLED') {
      throw new Error('Job cancelled');
    }

    await new Promise<void>((resolve, reject) => {
      updateJob(jobId, { progress: step.progressStart });
      ws.appendJobLog(jobId, `$ ${step.cmd} ${step.args.join(' ')}`);

      const child = spawn(step.cmd, step.args, { stdio: ['ignore', 'pipe', 'pipe'] });
      activeProcesses.set(jobId, child);

      child.stdout.on('data', (d: Buffer) => {
        d.toString().split('\n').filter(Boolean).forEach((l) => ws.appendJobLog(jobId, l));
      });
      child.stderr.on('data', (d: Buffer) => {
        d.toString().split('\n').filter(Boolean).forEach((l) => ws.appendJobLog(jobId, l));
      });

      child.on('close', (code, signal) => {
        activeProcesses.delete(jobId);

        const job = getJob(jobId);
        if (job?.status === 'CANCELLED') {
          reject(new Error('Job cancelled'));
          return;
        }

        if (signal !== null && code === null) {
          updateJob(jobId, { status: 'CANCELLED', error: 'Cancelled by user' });
          reject(new Error('Job cancelled'));
          return;
        }

        if (code === 0) {
          updateJob(jobId, { progress: step.progressEnd });
          resolve();
        } else {
          const err = `Step failed (code ${code}): ${step.cmd}`;
          updateJob(jobId, { status: 'ERROR', error: err });
          reject(new Error(err));
        }
      });
      child.on('error', (err) => {
        activeProcesses.delete(jobId);
        updateJob(jobId, { status: 'ERROR', error: err.message });
        reject(err);
      });
    });
  }

  updateJob(jobId, { status: 'DONE', progress: 100 });
}
