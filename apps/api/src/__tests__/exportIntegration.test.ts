/**
 * Integration test: actually runs ffmpeg to verify the export pipeline works.
 * Requires ffmpeg to be installed on the host. Skipped automatically if not found.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync, spawnSync } from 'child_process';

let tmpDir: string;

// Resolve ffmpeg binary (same logic as config.ts)
const FF = process.env.FFMPEG_BIN ?? 'ffmpeg';
const FFP = process.env.FFPROBE_BIN ?? 'ffprobe';

function ffmpegAvailable(): boolean {
  try {
    execFileSync(FF, ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 've-export-int-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('export integration (real ffmpeg)', () => {
  it.skipIf(!ffmpegAvailable())('basic export: black canvas + audio + video clip', () => {
    // Create 3-second test video: 304x540 @ 30fps, colour bars pattern
    const testVideoPath = path.join(tmpDir, 'test_video.mp4');
    execFileSync(FF, [
      '-y',
      '-f', 'lavfi', '-i', 'testsrc=size=304x540:rate=30:duration=3',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30',
      '-c:a', 'aac', '-shortest',
      testVideoPath,
    ]);

    // Create 3-second WAV for master audio
    const testAudioPath = path.join(tmpDir, 'test_audio.wav');
    execFileSync(FF, [
      '-y',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
      '-ac', '2', '-ar', '44100', '-f', 'wav',
      testAudioPath,
    ]);

    expect(fs.existsSync(testVideoPath)).toBe(true);
    expect(fs.existsSync(testAudioPath)).toBe(true);

    // Build the same filter_complex that buildExportCommand would generate:
    // - black canvas 1080x1920
    // - video clip with beat zoom (2 beats at 1s and 2s)
    // - master audio trimmed and delayed
    const W = 1080;
    const H = 1920;
    const outputPath = path.join(tmpDir, 'output_basic.mp4');

    const filterComplex = [
      `color=c=black:s=${W}x${H}:r=30[base]`,
      `[1:v]trim=start=0:end=3,setpts=PTS-STARTPTS,` +
        `scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
        `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p[clip0]`,
      `[base][clip0]overlay=0:0:enable='between(t,0,3)'[ov0]`,
      `[0:a]atrim=start=0:end=3,asetpts=PTS-STARTPTS,adelay=0:all=1[maudio]`,
    ].join('; ');

    const result = spawnSync(FF, [
      '-y',
      '-i', testAudioPath,
      '-i', testVideoPath,
      '-filter_complex', filterComplex,
      '-map', '[ov0]',
      '-map', '[maudio]',
      '-t', '3',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30',
      '-pix_fmt', 'yuv420p', '-r', '30',
      '-c:a', 'aac', '-b:a', '128k',
      outputPath,
    ]);

    if (result.status !== 0) {
      const stderr = result.stderr?.toString() ?? '';
      throw new Error(`ffmpeg exited with code ${result.status}:\n${stderr.slice(-2000)}`);
    }

    expect(fs.existsSync(outputPath)).toBe(true);
    expect(fs.statSync(outputPath).size).toBeGreaterThan(1000);
  });

  it.skipIf(!ffmpegAvailable())('beat zoom export: crop=eval=frame baked into clip chain (no separate zoomed chain)', () => {
    const testVideoPath = path.join(tmpDir, 'test_video_bz.mp4');
    execFileSync(FF, [
      '-y',
      '-f', 'lavfi', '-i', 'testsrc=size=304x540:rate=30:duration=3',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30',
      '-c:a', 'aac', '-shortest',
      testVideoPath,
    ]);
    const testAudioPath = path.join(tmpDir, 'test_audio_bz.wav');
    execFileSync(FF, [
      '-y',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
      '-ac', '2', '-ar', '44100', '-f', 'wav',
      testAudioPath,
    ]);

    const W = 1080;
    const H = 1920;
    const outputPath = path.join(tmpDir, 'output_beatzoom.mp4');
    const zf = (1.08).toFixed(6);
    const pulseDur = 0.2;

    // Clip: timelineStart=0, sourceStart=0, duration=3s. Two beats at 1.0s and 2.0s.
    // Beat zoom is baked into the single clip chain via a crop filter with eval=frame.
    // During beat windows, crop takes center region iw/ZF × ih/ZF; outside beats it's
    // a no-op (full frame). The following scale upscales the cropped region to canvas
    // size, producing the zoom pulse. No separate zoomed chain, no overlay+enable for
    // zoom (which is unreliable in ffmpeg 8.x and caused "stays zoomed" permanently).
    const beatSumExpr =
      `between(t,1.0000,${(1.0 + pulseDur).toFixed(4)})+between(t,2.0000,${(2.0 + pulseDur).toFixed(4)})`;

    const filterComplex = [
      `color=c=black:s=${W}x${H}:r=30[base]`,
      // Single clip chain: timeline-aligned setpts → beat-zoom crop → scale → format
      `[1:v]trim=start=0:end=3,setpts=PTS-STARTPTS+0.0000/TB,` +
        `crop=w='if(gt(${beatSumExpr},0),iw/${zf},iw)':h='if(gt(${beatSumExpr},0),ih/${zf},ih)':x='(iw-ow)/2':y='(ih-oh)/2',` +
        `scale=${W}:${H}:force_original_aspect_ratio=increase,` +
        `crop=${W}:${H},format=yuv420p[clip0]`,
      `[base][clip0]overlay=0:0:enable='between(t,0.0000,3.0000)'[ov0]`,
      `[0:a]atrim=start=0:end=3,asetpts=PTS-STARTPTS,adelay=0:all=1[maudio]`,
    ].join('; ');

    const result = spawnSync(FF, [
      '-y',
      '-i', testAudioPath,
      '-i', testVideoPath,
      '-filter_complex', filterComplex,
      '-map', '[ov0]',
      '-map', '[maudio]',
      '-t', '3',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30',
      '-pix_fmt', 'yuv420p', '-r', '30',
      '-c:a', 'aac', '-b:a', '128k',
      outputPath,
    ]);

    if (result.status !== 0) {
      const stderr = result.stderr?.toString() ?? '';
      throw new Error(`ffmpeg exited with code ${result.status}:\n${stderr.slice(-2000)}`);
    }

    expect(fs.existsSync(outputPath)).toBe(true);
    expect(fs.statSync(outputPath).size).toBeGreaterThan(1000);
  });

  it.skipIf(!ffmpegAvailable())('multi-audio export: amix with two audio inputs', () => {
    const vid1 = path.join(tmpDir, 'vid1.mp4');
    execFileSync(FF, [
      '-y',
      '-f', 'lavfi', '-i', 'color=red:size=304x540:rate=30:duration=2',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30',
      '-c:a', 'aac', '-shortest', vid1,
    ]);
    const masterAudio = path.join(tmpDir, 'master.wav');
    execFileSync(FF, [
      '-y',
      '-f', 'lavfi', '-i', 'sine=frequency=220:duration=2',
      '-ac', '2', '-ar', '44100', '-f', 'wav', masterAudio,
    ]);

    const W = 1080;
    const H = 1920;
    const outputPath = path.join(tmpDir, 'output_multiaudio.mp4');

    const filterComplex = [
      `color=c=black:s=${W}x${H}:r=30[base]`,
      `[1:v]trim=start=0:end=2,setpts=PTS-STARTPTS,scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p[clip0]`,
      `[base][clip0]overlay=0:0:enable='between(t,0,2)'[ov0]`,
      `[0:a]atrim=start=0:end=2,asetpts=PTS-STARTPTS,adelay=0:all=1[maudio]`,
      `[1:a]atrim=start=0:end=2,asetpts=PTS-STARTPTS,adelay=0:all=1,volume=0.5[caudio0]`,
      `[maudio][caudio0]amix=inputs=2[aout]`,
    ].join('; ');

    const result = spawnSync(FF, [
      '-y',
      '-i', masterAudio,
      '-i', vid1,
      '-filter_complex', filterComplex,
      '-map', '[ov0]',
      '-map', '[aout]',
      '-t', '2',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30',
      '-pix_fmt', 'yuv420p', '-r', '30',
      '-c:a', 'aac', '-b:a', '128k',
      outputPath,
    ]);

    if (result.status !== 0) {
      const stderr = result.stderr?.toString() ?? '';
      throw new Error(`ffmpeg exited with code ${result.status}:\n${stderr.slice(-2000)}`);
    }

    expect(fs.existsSync(outputPath)).toBe(true);
    expect(fs.statSync(outputPath).size).toBeGreaterThan(1000);
  });
});
