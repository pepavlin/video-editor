import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { computeWaveform } from '../services/waveform';

// ─── WAV builder helper ───────────────────────────────────────────────────────

function buildWav(options: {
  sampleRate?: number;
  numChannels?: number;
  bitsPerSample?: 8 | 16 | 32;
  samples: number[]; // values -1..1
}): Buffer {
  const {
    sampleRate = 48000,
    numChannels = 1,
    bitsPerSample = 16,
    samples,
  } = options;

  const bytesPerSample = bitsPerSample / 8;
  const dataSize = samples.length * bytesPerSample * numChannels;
  const fileSize = 44 + dataSize;

  const buf = Buffer.alloc(fileSize);
  let offset = 0;

  // RIFF header
  buf.write('RIFF', offset); offset += 4;
  buf.writeUInt32LE(fileSize - 8, offset); offset += 4;
  buf.write('WAVE', offset); offset += 4;

  // fmt chunk
  buf.write('fmt ', offset); offset += 4;
  buf.writeUInt32LE(16, offset); offset += 4; // chunk size
  buf.writeUInt16LE(1, offset); offset += 2;  // PCM
  buf.writeUInt16LE(numChannels, offset); offset += 2;
  buf.writeUInt32LE(sampleRate, offset); offset += 4;
  buf.writeUInt32LE(sampleRate * numChannels * bytesPerSample, offset); offset += 4; // byte rate
  buf.writeUInt16LE(numChannels * bytesPerSample, offset); offset += 2; // block align
  buf.writeUInt16LE(bitsPerSample, offset); offset += 2;

  // data chunk
  buf.write('data', offset); offset += 4;
  buf.writeUInt32LE(dataSize, offset); offset += 4;

  for (const sample of samples) {
    if (bitsPerSample === 16) {
      const val = Math.max(-32768, Math.min(32767, Math.round(sample * 32767)));
      buf.writeInt16LE(val, offset);
      offset += 2;
      // duplicate for each channel
      for (let c = 1; c < numChannels; c++) {
        buf.writeInt16LE(val, offset);
        offset += 2;
      }
    } else if (bitsPerSample === 8) {
      const val = Math.max(0, Math.min(255, Math.round((sample + 1) * 127.5)));
      buf.writeUInt8(val, offset++);
      for (let c = 1; c < numChannels; c++) {
        buf.writeUInt8(val, offset++);
      }
    }
  }

  return buf;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('computeWaveform', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 've-waveform-'));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeWav(filename: string, wavBuf: Buffer): string {
    const p = path.join(tmpDir, filename);
    fs.writeFileSync(p, wavBuf);
    return p;
  }

  it('returns normalized samples for a simple sine wave', () => {
    // 1 second of 440 Hz sine wave at 48kHz
    const sampleRate = 48000;
    const duration = 1;
    const samples = Array.from({ length: sampleRate * duration }, (_, i) =>
      Math.sin((2 * Math.PI * 440 * i) / sampleRate)
    );

    const p = writeWav('sine.wav', buildWav({ sampleRate, samples }));
    const result = computeWaveform(p);

    expect(result.samples.length).toBeGreaterThan(0);
    expect(result.duration).toBeCloseTo(duration, 0);
    // All samples should be in 0..1 range
    expect(result.samples.every((s) => s >= 0 && s <= 1)).toBe(true);
    // Max sample should be 1 (normalized)
    expect(Math.max(...result.samples)).toBe(1);
  });

  it('handles silent audio (all zeros)', () => {
    const samples = new Array(48000).fill(0);
    const p = writeWav('silent.wav', buildWav({ samples }));
    const result = computeWaveform(p);

    expect(result.samples.length).toBeGreaterThan(0);
    // Normalization clamps to 0 for silent audio
    expect(result.samples.every((s) => s >= 0 && s <= 1)).toBe(true);
  });

  it('handles stereo WAV', () => {
    const sampleRate = 44100;
    const samples = Array.from({ length: sampleRate }, (_, i) =>
      Math.sin((2 * Math.PI * 220 * i) / sampleRate)
    );
    const p = writeWav('stereo.wav', buildWav({ sampleRate, numChannels: 2, samples }));
    const result = computeWaveform(p);

    expect(result.duration).toBeCloseTo(1, 0);
    expect(result.samples.every((s) => s >= 0 && s <= 1)).toBe(true);
  });

  it('returns correct bucket count proportional to duration', () => {
    // 2 seconds of audio at 100 buckets/second = 200 buckets
    const sampleRate = 48000;
    const duration = 2;
    const samples = new Array(sampleRate * duration).fill(0.5);
    const p = writeWav('twosec.wav', buildWav({ sampleRate, samples }));
    const result = computeWaveform(p, 100);

    // Should have approximately 200 buckets (2s * 100/s)
    expect(result.samples.length).toBeGreaterThanOrEqual(190);
    expect(result.samples.length).toBeLessThanOrEqual(210);
    expect(result.sampleRate).toBe(100);
  });

  it('throws for non-WAV data', () => {
    const p = path.join(tmpDir, 'not-a-wav.wav');
    fs.writeFileSync(p, Buffer.from('this is not a wav file'));
    expect(() => computeWaveform(p)).toThrow('Not a valid WAV file');
  });

  it('handles 8-bit WAV', () => {
    const sampleRate = 22050;
    const samples = Array.from({ length: sampleRate }, (_, i) =>
      Math.sin((2 * Math.PI * 100 * i) / sampleRate) * 0.8
    );
    const p = writeWav('8bit.wav', buildWav({ sampleRate, bitsPerSample: 8, samples }));
    const result = computeWaveform(p);

    expect(result.samples.length).toBeGreaterThan(0);
    expect(result.samples.every((s) => s >= 0 && s <= 1)).toBe(true);
  });

  it('returns duration matching audio length', () => {
    const sampleRate = 48000;
    const durationSec = 3.5;
    const numSamples = Math.round(sampleRate * durationSec);
    const samples = new Array(numSamples).fill(0.3);
    const p = writeWav('3.5sec.wav', buildWav({ sampleRate, samples }));
    const result = computeWaveform(p);

    expect(result.duration).toBeCloseTo(durationSec, 1);
  });
});
