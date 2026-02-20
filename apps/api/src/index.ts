import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import staticFiles from '@fastify/static';
import path from 'path';
import { config } from './config';
import * as ws from './services/workspace';
import { assetsRoutes } from './routes/assets';
import { projectsRoutes } from './routes/projects';
import { jobsRoutes } from './routes/jobs';

async function main() {
  // Ensure workspace directories exist
  ws.ensureWorkspace();

  const app = Fastify({
    logger: {
      transport: {
        target: 'pino-pretty',
        options: { colorize: true },
      },
    },
    bodyLimit: 2 * 1024 * 1024 * 1024, // 2GB
  });

  await app.register(cors, {
    origin: config.corsOrigin,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  });

  await app.register(multipart, {
    limits: {
      fileSize: 2 * 1024 * 1024 * 1024, // 2GB
    },
  });

  // Serve workspace files (proxy videos, waveforms, etc.)
  await app.register(staticFiles, {
    root: ws.getWorkspaceDir(),
    prefix: '/files/',
    decorateReply: false,
  });

  // Routes
  await app.register(assetsRoutes, { prefix: '/api' });
  await app.register(projectsRoutes, { prefix: '/api' });
  await app.register(jobsRoutes, { prefix: '/api' });

  // Health check
  app.get('/health', async () => ({ status: 'ok', workspace: ws.getWorkspaceDir() }));

  try {
    await app.listen({ port: config.port, host: config.host });
    console.log(`API running at http://localhost:${config.port}`);
    console.log(`Workspace: ${ws.getWorkspaceDir()}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
