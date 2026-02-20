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

  it.skipIf(!ffmpegAvailable())('beat zoom export: per-beat-segment approach (fixed PTS, eof_action=pass)', () => {
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
    const zoomFactor = 1.08;
    const pulseDur = 0.2;
    const zoomedW = Math.round(W * zoomFactor);
    const zoomedH = Math.round(H * zoomFactor);

    // Two beats at 1.0s and 2.0s — per-beat-segment approach.
    // Each beat gets its own trimmed+PTS-offset zoomed clip so PTS aligns with timeline time,
    // preventing the eof_action=repeat "stays zoomed" bug of the old single-chain approach.
    const beats = [1.0, 2.0];
    const beatSegments = beats.map((b, ki) => {
      const beatEnd = b + pulseDur;
      // trim source to only the frames for this beat, set PTS to absolute timeline time
      return (
        `[1:v]trim=start=${b.toFixed(4)}:end=${beatEnd.toFixed(4)},` +
        `setpts=PTS-STARTPTS+${b.toFixed(4)}/TB,` +
        `scale=${zoomedW}:${zoomedH}:force_original_aspect_ratio=increase,` +
        `crop=${W}:${H},format=yuv420p[beat0_${ki}]`
      );
    });
    const beatOverlays = beats.map((b, ki) => {
      const beatEnd = b + pulseDur;
      const inPad = ki === 0 ? 'ov0' : `ov0b${ki - 1}`;
      return `[${inPad}][beat0_${ki}]overlay=0:0:eof_action=pass:enable='between(t,${b.toFixed(4)},${beatEnd.toFixed(4)})'[ov0b${ki}]`;
    });

    const filterComplex = [
      `color=c=black:s=${W}x${H}:r=30[base]`,
      `[1:v]trim=start=0:end=3,setpts=PTS-STARTPTS,` +
        `scale=${W}:${H}:force_original_aspect_ratio=increase,` +
        `crop=${W}:${H},format=yuv420p[clip0]`,
      `[base][clip0]overlay=0:0:enable='between(t,0,3)'[ov0]`,
      ...beatSegments,
      ...beatOverlays,
      `[0:a]atrim=start=0:end=3,asetpts=PTS-STARTPTS,adelay=0:all=1[maudio]`,
    ].join('; ');

    const finalVideoOut = `[ov0b${beats.length - 1}]`;

    const result = spawnSync(FF, [
      '-y',
      '-i', testAudioPath,
      '-i', testVideoPath,
      '-filter_complex', filterComplex,
      '-map', finalVideoOut,
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
