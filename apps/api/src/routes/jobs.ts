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

  // GET /jobs/:id/output - download output file
  app.get<{ Params: { id: string } }>('/jobs/:id/output', async (req, reply) => {
    const job = jq.getJob(req.params.id);
    if (!job) return reply.code(404).send({ error: 'Job not found' });
    if (job.status !== 'DONE') return reply.code(400).send({ error: 'Job not done' });
    if (!job.outputPath) return reply.code(404).send({ error: 'No output file' });

    // outputPath can be absolute or relative to workspace
    const filePath = path.isAbsolute(job.outputPath)
      ? job.outputPath
      : path.join(ws.getWorkspaceDir(), job.outputPath);

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
