import type {
  Asset,
  Project,
  Job,
  WaveformData,
  BeatsData,
  WordTimestamp,
} from '@video-editor/shared';

const BASE = '/api';

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

// ─── Assets ──────────────────────────────────────────────────────────────────

export async function importAsset(file: File): Promise<{ jobId: string; assetId: string }> {
  const form = new FormData();
  form.append('file', file);
  return apiFetch('/assets/import', { method: 'POST', body: form });
}

export async function listAssets(): Promise<{ assets: Asset[] }> {
  return apiFetch('/assets');
}

export async function getAsset(id: string): Promise<{ asset: Asset }> {
  return apiFetch(`/assets/${id}`);
}

export async function getWaveform(assetId: string): Promise<WaveformData> {
  return apiFetch(`/assets/${assetId}/waveform`);
}

export async function getBeats(assetId: string): Promise<BeatsData> {
  return apiFetch(`/assets/${assetId}/beats`);
}

export async function analyzeBeats(assetId: string): Promise<{ jobId: string }> {
  return apiFetch(`/assets/${assetId}/analyze-beats`, { method: 'POST' });
}

export async function startCutout(assetId: string, mode?: 'removeBg' | 'removePerson'): Promise<{ jobId: string }> {
  return apiFetch(`/assets/${assetId}/cutout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: mode ?? 'removeBg' }),
  });
}

export async function startHeadStabilization(
  assetId: string,
  opts: { smoothingX: number; smoothingY: number; smoothingZ: number }
): Promise<{ jobId: string }> {
  return apiFetch(`/assets/${assetId}/head-stabilize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  });
}

export async function listMediaFiles(): Promise<{ files: Array<{ name: string; size: number }> }> {
  return apiFetch('/media');
}

export async function linkAsset(filename: string): Promise<{ jobId: string; assetId: string }> {
  return apiFetch('/assets/link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename }),
  });
}

// ─── Projects ────────────────────────────────────────────────────────────────

export async function createProject(name: string): Promise<{ id: string; project: Project }> {
  return apiFetch('/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
}

export async function listProjects(): Promise<{ projects: Pick<Project, 'id' | 'name' | 'createdAt' | 'updatedAt'>[] }> {
  return apiFetch('/projects');
}

export async function loadProject(id: string): Promise<{ project: Project }> {
  return apiFetch(`/projects/${id}`);
}

export async function saveProject(project: Project): Promise<{ project: Project }> {
  return apiFetch(`/projects/${project.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(project),
  });
}

export async function alignLyrics(
  projectId: string,
  text: string,
  audioAssetId?: string
): Promise<{ jobId: string }> {
  return apiFetch(`/projects/${projectId}/align-lyrics`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, audioAssetId }),
  });
}

export async function alignLyricsClip(
  projectId: string,
  clipId: string,
  text: string,
  audioAssetId?: string
): Promise<{ jobId: string }> {
  return apiFetch(`/projects/${projectId}/clips/${clipId}/align-lyrics`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, audioAssetId }),
  });
}

export async function exportProject(
  projectId: string,
  opts?: { width?: number; height?: number; crf?: number; preset?: string; startTime?: number; endTime?: number }
): Promise<{ jobId: string }> {
  return apiFetch(`/projects/${projectId}/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts ?? {}),
  });
}

export async function syncClipAudio(
  projectId: string,
  clipId: string
): Promise<{ offset: number; confidence: number; newTimelineStart: number }> {
  return apiFetch(`/projects/${projectId}/clips/${clipId}/sync-audio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
}

// ─── Jobs ────────────────────────────────────────────────────────────────────

export async function getJobStatus(jobId: string): Promise<{ job: Job & { lastLogLines: string[] } }> {
  return apiFetch(`/jobs/${jobId}/status`);
}

export function getJobOutputUrl(jobId: string): string {
  return `${BASE}/jobs/${jobId}/output`;
}

export function getProxyUrl(asset: Asset): string {
  if (asset.proxyPath) return `/files/${asset.proxyPath}`;
  return `/files/${asset.originalPath}`;
}

export function getAudioUrl(asset: Asset): string {
  if (asset.audioPath) return `/files/${asset.audioPath}`;
  return `/files/${asset.originalPath}`;
}

// ─── Poll job until done ──────────────────────────────────────────────────────

export async function pollJob(
  jobId: string,
  onProgress?: (job: Job & { lastLogLines: string[] }) => void,
  intervalMs = 500
): Promise<Job> {
  return new Promise((resolve, reject) => {
    const interval = setInterval(async () => {
      try {
        const { job } = await getJobStatus(jobId);
        onProgress?.(job);
        if (job.status === 'DONE') {
          clearInterval(interval);
          resolve(job);
        } else if (job.status === 'ERROR') {
          clearInterval(interval);
          reject(new Error(job.error ?? 'Job failed'));
        }
      } catch (e) {
        clearInterval(interval);
        reject(e);
      }
    }, intervalMs);
  });
}
