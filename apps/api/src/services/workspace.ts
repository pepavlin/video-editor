import fs from 'fs';
import path from 'path';
import { config } from '../config';
import type { Asset, Project, Job } from '@video-editor/shared';

const WS = config.workspaceDir;

export function getWorkspaceDir() {
  return WS;
}

export function getAssetsDir() {
  return path.join(WS, 'assets');
}

export function getAssetDir(assetId: string) {
  return path.join(WS, 'assets', assetId);
}

export function getProjectsDir() {
  return path.join(WS, 'projects');
}

export function getProjectDir(projectId: string) {
  return path.join(WS, 'projects', projectId);
}

export function getJobsDir() {
  return path.join(WS, 'jobs');
}

export function getJobDir(jobId: string) {
  return path.join(WS, 'jobs', jobId);
}

export function ensureWorkspace() {
  for (const dir of [
    WS,
    getAssetsDir(),
    getProjectsDir(),
    getJobsDir(),
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ─── Assets DB (file-based) ──────────────────────────────────────────────────

const assetsIndexPath = () => path.join(WS, 'assets.json');

export function readAssetsIndex(): Asset[] {
  const p = assetsIndexPath();
  if (!fs.existsSync(p)) return [];
  return JSON.parse(fs.readFileSync(p, 'utf8')) as Asset[];
}

export function writeAssetsIndex(assets: Asset[]) {
  fs.writeFileSync(assetsIndexPath(), JSON.stringify(assets, null, 2));
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
  return JSON.parse(fs.readFileSync(p, 'utf8')) as Project;
}

export function writeProject(project: Project) {
  const dir = getProjectDir(project.id);
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, 'project.json');
  fs.writeFileSync(p, JSON.stringify(project, null, 2));
}

export function listProjects(): Pick<Project, 'id' | 'name' | 'createdAt' | 'updatedAt'>[] {
  const dir = getProjectsDir();
  if (!fs.existsSync(dir)) return [];
  const ids = fs.readdirSync(dir).filter((d) => {
    return fs.existsSync(path.join(dir, d, 'project.json'));
  });
  return ids.map((id) => {
    const p = readProject(id)!;
    return { id: p.id, name: p.name, createdAt: p.createdAt, updatedAt: p.updatedAt };
  });
}

// ─── Jobs ────────────────────────────────────────────────────────────────────

export function readJob(jobId: string): Job | null {
  const p = path.join(getJobDir(jobId), 'job.json');
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8')) as Job;
}

export function writeJob(job: Job) {
  const dir = getJobDir(job.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'job.json'), JSON.stringify(job, null, 2));
}

export function appendJobLog(jobId: string, line: string) {
  const dir = getJobDir(jobId);
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, 'log.txt'), line + '\n');
}

export function readJobLog(jobId: string): string[] {
  const p = path.join(getJobDir(jobId), 'log.txt');
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).slice(-50);
}
