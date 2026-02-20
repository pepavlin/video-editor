import path from 'path';
import os from 'os';

export const config = {
  port: parseInt(process.env.PORT ?? '3001', 10),
  host: process.env.HOST ?? '0.0.0.0',
  workspaceDir: process.env.WORKSPACE_DIR ?? path.join(process.cwd(), 'workspace'),
  scriptsDir: process.env.SCRIPTS_DIR ?? path.join(process.cwd(), '../../scripts'),
  pythonBin: process.env.PYTHON_BIN ?? 'python3',
  ffmpegBin: process.env.FFMPEG_BIN ?? 'ffmpeg',
  ffprobeBin: process.env.FFPROBE_BIN ?? 'ffprobe',
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
};
