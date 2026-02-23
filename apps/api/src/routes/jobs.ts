import { FastifyInstance } from 'fastify';
import path from 'path';
import fs from 'fs';
import * as ws from '../services/workspace';
import * as jq from '../services/jobQueue';

export async function jobsRoutes(app: FastifyInstance) {
  // GET /jobs/:id/status
  app.get<{ Params: { id: string } }>('/jobs/:id/status', async (req, reply) => {
    const job = jq.getJob(req.params.id);
    if (!job) return reply.code(404).send({ error: 'Job not found' });

    const lastLogLines = ws.readJobLog(req.params.id).slice(-20);
    return reply.send({ job: { ...job, lastLogLines } });
  });

  // POST /jobs/:id/cancel - cancel a running job
  app.post<{ Params: { id: string } }>('/jobs/:id/cancel', async (req, reply) => {
    const job = jq.getJob(req.params.id);
    if (!job) return reply.code(404).send({ error: 'Job not found' });
    if (job.status !== 'RUNNING' && job.status !== 'QUEUED') {
      return reply.code(400).send({ error: `Job is not running (status: ${job.status})` });
    }
    const cancelled = jq.cancelJob(req.params.id);
    if (!cancelled) return reply.code(500).send({ error: 'Failed to cancel job' });
    return reply.send({ ok: true });
  });

  // GET /jobs/:id/log - full log output
  app.get<{ Params: { id: string } }>('/jobs/:id/log', async (req, reply) => {
    const job = jq.getJob(req.params.id);
    if (!job) return reply.code(404).send({ error: 'Job not found' });
    const lines = ws.readJobLog(req.params.id);
    return reply.send({ lines });
  });

  // GET /jobs/:id/output - download output file
  app.get<{ Params: { id: string } }>('/jobs/:id/output', async (req, reply) => {
    const job = jq.getJob(req.params.id);
    if (!job) return reply.code(404).send({ error: 'Job not found' });
    if (job.status !== 'DONE') return reply.code(400).send({ error: 'Job not done' });
    if (!job.outputPath) return reply.code(404).send({ error: 'No output file' });

    // Validate output path stays within workspace (path traversal prevention)
    let filePath: string;
    try {
      filePath = path.isAbsolute(job.outputPath)
        ? job.outputPath
        : ws.safeResolve(job.outputPath);
    } catch {
      return reply.code(403).send({ error: 'Invalid output path' });
    }

    // Extra guard: ensure file is within workspace even for absolute paths
    const workspaceAbs = path.resolve(ws.getWorkspaceDir());
    if (!path.resolve(filePath).startsWith(workspaceAbs + path.sep)) {
      return reply.code(403).send({ error: 'Output path outside workspace' });
    }

    if (!fs.existsSync(filePath)) {
      return reply.code(404).send({ error: 'Output file not found' });
    }

    const stat = fs.statSync(filePath);
    const filename = path.basename(filePath);

    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    reply.header('Content-Length', stat.size);
    reply.header('Content-Type', 'video/mp4');

    return reply.send(fs.createReadStream(filePath));
  });
}
