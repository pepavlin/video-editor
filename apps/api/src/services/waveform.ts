import fs from 'fs';

/**
 * Compute a waveform from a WAV file by reading raw PCM samples.
 * Returns ~100 samples/second (configurable via bucketsPerSecond).
 */
export function computeWaveform(
  wavPath: string,
  bucketsPerSecond = 100
): { samples: number[]; duration: number; sampleRate: number } {
  const buf = fs.readFileSync(wavPath);

  // Parse WAV header (44-byte standard header)
  const chunkId = buf.slice(0, 4).toString('ascii');
  if (chunkId !== 'RIFF') {
    throw new Error('Not a valid WAV file');
  }

  const audioFormat = buf.readUInt16LE(20);
  const numChannels = buf.readUInt16LE(22);
  const sampleRate = buf.readUInt32LE(24);
  const bitsPerSample = buf.readUInt16LE(34);

  if (audioFormat !== 1) {
    throw new Error('Only PCM WAV supported for waveform');
  }

  // Find 'data' chunk
  let dataOffset = 12;
  let dataSize = 0;
  while (dataOffset < buf.length - 8) {
    const chunkName = buf.slice(dataOffset, dataOffset + 4).toString('ascii');
    const chunkSize = buf.readUInt32LE(dataOffset + 4);
    if (chunkName === 'data') {
      dataOffset += 8;
      dataSize = chunkSize;
      break;
    }
    dataOffset += 8 + chunkSize;
  }

  if (dataSize === 0) {
    throw new Error('No data chunk found in WAV');
  }

  const bytesPerSample = bitsPerSample / 8;
  const totalSamples = dataSize / (bytesPerSample * numChannels);
  const duration = totalSamples / sampleRate;

  const samplesPerBucket = Math.floor(sampleRate / bucketsPerSecond);
  const numBuckets = Math.ceil(totalSamples / samplesPerBucket);
  const result: number[] = [];

  for (let b = 0; b < numBuckets; b++) {
    const start = b * samplesPerBucket;
    const end = Math.min(start + samplesPerBucket, totalSamples);
    let sumSquares = 0;
    let count = 0;

    for (let i = start; i < end; i++) {
      // Read first channel only (interleaved)
      const byteOffset = dataOffset + i * bytesPerSample * numChannels;
      if (byteOffset + bytesPerSample > buf.length) break;

      let sample = 0;
      if (bitsPerSample === 16) {
        sample = buf.readInt16LE(byteOffset) / 32768;
      } else if (bitsPerSample === 8) {
        sample = (buf.readUInt8(byteOffset) - 128) / 128;
      } else if (bitsPerSample === 32) {
        sample = buf.readFloatLE(byteOffset);
      }

      sumSquares += sample * sample;
      count++;
    }

    const rms = count > 0 ? Math.sqrt(sumSquares / count) : 0;
    result.push(rms);
  }

  // Normalize to 0..1
  const max = Math.max(...result, 0.001);
  const normalized = result.map((v) => Math.min(v / max, 1));

  return { samples: normalized, duration, sampleRate: bucketsPerSecond };
}
