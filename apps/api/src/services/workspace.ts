import fs from 'fs';
import path from 'path';
import { config } from '../config';
import type { Asset, Project, Job } from '@video-editor/shared';

// Use a function so config.workspaceDir mutations (e.g. in tests) are reflected.
export function getWorkspaceDir() {
  return config.workspaceDir;
}

export function getAssetsDir() {
  return path.join(getWorkspaceDir(), 'assets');
}

export function getAssetDir(assetId: string) {
  return path.join(getWorkspaceDir(), 'assets', assetId);
}

export function getProjectsDir() {
  return path.join(getWorkspaceDir(), 'projects');
}

export function getProjectDir(projectId: string) {
  return path.join(getWorkspaceDir(), 'projects', projectId);
}

export function getJobsDir() {
  return path.join(getWorkspaceDir(), 'jobs');
}

export function getJobDir(jobId: string) {
  return path.join(getWorkspaceDir(), 'jobs', jobId);
}

export function ensureWorkspace() {
  const ws = getWorkspaceDir();
  try {
    for (const dir of [ws, getAssetsDir(), getProjectsDir(), getJobsDir()]) {
      fs.mkdirSync(dir, { recursive: true });
    }
  } catch (e: any) {
    throw new Error(`Failed to initialise workspace at ${ws}: ${e.message}`);
  }
}

// ─── Path safety ─────────────────────────────────────────────────────────────

/**
 * Resolve a path and assert it stays inside the workspace.
 * Throws if path traversal is detected.
 */
export function safeResolve(relative: string): string {
  const ws = getWorkspaceDir();
  const resolved = path.resolve(ws, relative);
  if (!resolved.startsWith(path.resolve(ws) + path.sep) && resolved !== path.resolve(ws)) {
    throw new Error(`Path traversal detected: ${relative}`);
  }
  return resolved;
}

// ─── Assets DB (file-based) ──────────────────────────────────────────────────

const assetsIndexPath = () => path.join(getWorkspaceDir(), 'assets.json');

export function readAssetsIndex(): Asset[] {
  const p = assetsIndexPath();
  if (!fs.existsSync(p)) return [];
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as Asset[];
  } catch {
    return [];
  }
}

export function writeAssetsIndex(assets: Asset[]) {
  const tmp = assetsIndexPath() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(assets, null, 2));
  fs.renameSync(tmp, assetsIndexPath()); // atomic write
}

export function getAsset(id: string): Asset | undefined {
  return readAssetsIndex().find((a) => a.id === id);
}

export function upsertAsset(asset: Asset) {
  const assets = readAssetsIndex();
  const idx = assets.findIndex((a) => a.id === asset.id);
  if (idx >= 0) {
    assets[idx] = asset;
  } else {
    assets.push(asset);
  }
  writeAssetsIndex(assets);
}

// ─── Projects ────────────────────────────────────────────────────────────────

export function readProject(projectId: string): Project | null {
  const p = path.join(getProjectDir(projectId), 'project.json');
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as Project;
  } catch {
    return null;
  }
}

export function writeProject(project: Project) {
  const dir = getProjectDir(project.id);
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, 'project.json');
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(project, null, 2));
  fs.renameSync(tmp, p);
}

export function listProjects(): Pick<Project, 'id' | 'name' | 'createdAt' | 'updatedAt'>[] {
  const dir = getProjectsDir();
  if (!fs.existsSync(dir)) return [];
  const ids = fs.readdirSync(dir).filter((d) => {
    return fs.existsSync(path.join(dir, d, 'project.json'));
  });
  return ids.reduce<Pick<Project, 'id' | 'name' | 'createdAt' | 'updatedAt'>[]>((acc, id) => {
    const p = readProject(id);
    if (!p) return acc;
    return [...acc, { id: p.id, name: p.name, createdAt: p.createdAt, updatedAt: p.updatedAt }];
  }, []);
}

// ─── Jobs ────────────────────────────────────────────────────────────────────

export function readJob(jobId: string): Job | null {
  const p = path.join(getJobDir(jobId), 'job.json');
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as Job;
  } catch {
    return null;
  }
}

export function writeJob(job: Job) {
  const dir = getJobDir(job.id);
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, 'job.json');
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(job, null, 2));
  fs.renameSync(tmp, p);
}

export function appendJobLog(jobId: string, line: string) {
  const dir = getJobDir(jobId);
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, 'log.txt'), line + '\n');
}

export function readJobLog(jobId: string): string[] {
  const p = path.join(getJobDir(jobId), 'log.txt');
  if (!fs.existsSync(p)) return [];
  // Read at most last 64KB to avoid memory spikes on large log files
  const stat = fs.statSync(p);
  const MAX = 65536;
  const fd = fs.openSync(p, 'r');
  const readSize = Math.min(stat.size, MAX);
  const buf = Buffer.alloc(readSize);
  fs.readSync(fd, buf, 0, readSize, Math.max(0, stat.size - readSize));
  fs.closeSync(fd);
  return buf.toString('utf8').split('\n').filter(Boolean).slice(-50);
}

// ─── Startup cleanup ─────────────────────────────────────────────────────────

/**
 * Mark any RUNNING jobs as ERROR (server restarted while they were running).
 */
export function cleanupStaleJobs() {
  const dir = getJobsDir();
  if (!fs.existsSync(dir)) return;
  for (const jobId of fs.readdirSync(dir)) {
    const job = readJob(jobId);
    if (job && job.status === 'RUNNING') {
      writeJob({
        ...job,
        status: 'ERROR',
        error: 'Server restarted while job was running',
        updatedAt: new Date().toISOString(),
      });
    }
  }
}
