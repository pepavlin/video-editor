import { describe, it, expect } from 'vitest';
import type { Project, Track, Clip, WordTimestamp, LyricsStyle } from '@video-editor/shared';
import { explodeLyricsClipToChunks } from '../hooks/useProject';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeProject(tracks: Track[]): Project {
  return {
    id: 'proj_1',
    name: 'Test',
    duration: 30,
    aspectRatio: '9:16',
    outputResolution: { w: 1080, h: 1920 },
    tracks,
    createdAt: '2025-01-01',
    updatedAt: '2025-01-01',
  };
}

function makeLyricsTrack(clips: Clip[], overrides: Partial<Track> = {}): Track {
  return {
    id: 'track_lyrics',
    type: 'lyrics',
    name: 'Lyrics',
    muted: false,
    clips,
    ...overrides,
  };
}

function makeMasterAudioTrack(): Track {
  return {
    id: 'track_audio',
    type: 'audio',
    name: 'Audio',
    isMaster: true,
    muted: false,
    clips: [{
      id: 'clip_master',
      assetId: 'audio_1',
      trackId: 'track_audio',
      timelineStart: 0,
      timelineEnd: 30,
      sourceStart: 0,
      sourceEnd: 30,
    }],
  };
}

const defaultStyle: LyricsStyle = {
  fontSize: 48,
  color: '#ffffff',
  highlightColor: '#FFE600',
  position: 'bottom',
  wordsPerChunk: 2,
};

function makeWords(): WordTimestamp[] {
  return [
    { word: 'Hello', start: 1.0, end: 1.5 },
    { word: 'world', start: 1.5, end: 2.0 },
    { word: 'how', start: 3.0, end: 3.3 },
    { word: 'are', start: 3.3, end: 3.6 },
    { word: 'you', start: 4.0, end: 4.5 },
    { word: 'today', start: 4.5, end: 5.0 },
  ];
}

function makeLyricsClip(words: WordTimestamp[], style?: LyricsStyle): Clip {
  return {
    id: 'clip_lyrics',
    assetId: '',
    trackId: 'track_lyrics',
    timelineStart: 0,
    timelineEnd: 30,
    sourceStart: 0,
    sourceEnd: 30,
    lyricsContent: words.map((w) => w.word).join(' '),
    lyricsWords: words,
    lyricsStyle: style ?? defaultStyle,
    lyricsAlignStatus: 'done',
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('explodeLyricsClipToChunks', () => {
  it('splits a lyrics clip into per-chunk clips', () => {
    const words = makeWords();
    const clip = makeLyricsClip(words);
    const project = makeProject([
      makeMasterAudioTrack(),
      makeLyricsTrack([clip]),
    ]);

    const result = explodeLyricsClipToChunks(project, 'clip_lyrics');
    const lyricsTrack = result.tracks.find((t) => t.type === 'lyrics')!;

    // 6 words / 2 wordsPerChunk = 3 chunks
    expect(lyricsTrack.clips).toHaveLength(3);
  });

  it('each chunk has the correct words', () => {
    const words = makeWords();
    const clip = makeLyricsClip(words);
    const project = makeProject([
      makeMasterAudioTrack(),
      makeLyricsTrack([clip]),
    ]);

    const result = explodeLyricsClipToChunks(project, 'clip_lyrics');
    const lyricsTrack = result.tracks.find((t) => t.type === 'lyrics')!;

    expect(lyricsTrack.clips[0].lyricsContent).toBe('Hello world');
    expect(lyricsTrack.clips[1].lyricsContent).toBe('how are');
    expect(lyricsTrack.clips[2].lyricsContent).toBe('you today');
  });

  it('word timestamps are clip-relative (start from 0)', () => {
    const words = makeWords();
    const clip = makeLyricsClip(words);
    const project = makeProject([
      makeMasterAudioTrack(),
      makeLyricsTrack([clip]),
    ]);

    const result = explodeLyricsClipToChunks(project, 'clip_lyrics');
    const lyricsTrack = result.tracks.find((t) => t.type === 'lyrics')!;

    // First chunk: words "Hello" (1.0-1.5) and "world" (1.5-2.0)
    // Clip-relative: "Hello" starts at 0, "world" starts at 0.5
    const chunk1Words = lyricsTrack.clips[0].lyricsWords!;
    expect(chunk1Words[0].start).toBe(0);
    expect(chunk1Words[0].end).toBe(0.5);
    expect(chunk1Words[1].start).toBe(0.5);
    expect(chunk1Words[1].end).toBe(1.0);

    // Second chunk: words "how" (3.0-3.3) and "are" (3.3-3.6)
    // Clip-relative: "how" starts at 0
    const chunk2Words = lyricsTrack.clips[1].lyricsWords!;
    expect(chunk2Words[0].start).toBe(0);
    expect(chunk2Words[0].end).toBeCloseTo(0.3, 5);
    expect(chunk2Words[1].start).toBeCloseTo(0.3, 5);
    expect(chunk2Words[1].end).toBeCloseTo(0.6, 5);
  });

  it('clip timelineStart/End matches word WAV timing on timeline', () => {
    const words = makeWords();
    const clip = makeLyricsClip(words);
    const project = makeProject([
      makeMasterAudioTrack(),
      makeLyricsTrack([clip]),
    ]);

    const result = explodeLyricsClipToChunks(project, 'clip_lyrics');
    const lyricsTrack = result.tracks.find((t) => t.type === 'lyrics')!;

    // Master audio: sourceStart=0, timelineStart=0, so offset=0
    // Chunk 1: WAV 1.0-2.0 → timeline 1.0-2.0
    expect(lyricsTrack.clips[0].timelineStart).toBe(1.0);
    expect(lyricsTrack.clips[0].timelineEnd).toBe(2.0);

    // Chunk 2: WAV 3.0-3.6 → timeline 3.0-3.6
    expect(lyricsTrack.clips[1].timelineStart).toBe(3.0);
    expect(lyricsTrack.clips[1].timelineEnd).toBe(3.6);

    // Chunk 3: WAV 4.0-5.0 → timeline 4.0-5.0
    expect(lyricsTrack.clips[2].timelineStart).toBe(4.0);
    expect(lyricsTrack.clips[2].timelineEnd).toBe(5.0);
  });

  it('accounts for master audio offset when converting WAV → timeline', () => {
    const words: WordTimestamp[] = [
      { word: 'A', start: 5.0, end: 5.5 },
      { word: 'B', start: 5.5, end: 6.0 },
      { word: 'C', start: 7.0, end: 7.5 },
      { word: 'D', start: 7.5, end: 8.0 },
    ];
    const style: LyricsStyle = { ...defaultStyle, wordsPerChunk: 2 };
    const clip = makeLyricsClip(words, style);

    // Master audio starts at timeline 2s, sourceStart 5s
    // So audioTimeOffset = 5 - 2 = 3
    // WAV 5.0 → timeline 5.0 - 3 = 2.0
    const masterTrack: Track = {
      id: 'track_audio',
      type: 'audio',
      name: 'Audio',
      isMaster: true,
      muted: false,
      clips: [{
        id: 'clip_master',
        assetId: 'audio_1',
        trackId: 'track_audio',
        timelineStart: 2,
        timelineEnd: 32,
        sourceStart: 5,
        sourceEnd: 35,
      }],
    };

    const project = makeProject([masterTrack, makeLyricsTrack([clip])]);
    const result = explodeLyricsClipToChunks(project, 'clip_lyrics');
    const lyricsTrack = result.tracks.find((t) => t.type === 'lyrics')!;

    // Chunk 1: WAV 5.0-6.0 → timeline 2.0-3.0
    expect(lyricsTrack.clips[0].timelineStart).toBe(2.0);
    expect(lyricsTrack.clips[0].timelineEnd).toBe(3.0);

    // Chunk 2: WAV 7.0-8.0 → timeline 4.0-5.0
    expect(lyricsTrack.clips[1].timelineStart).toBe(4.0);
    expect(lyricsTrack.clips[1].timelineEnd).toBe(5.0);
  });

  it('returns same project if clip has no lyricsWords', () => {
    const clip: Clip = {
      id: 'clip_lyrics',
      assetId: '',
      trackId: 'track_lyrics',
      timelineStart: 0,
      timelineEnd: 30,
      sourceStart: 0,
      sourceEnd: 30,
      lyricsContent: 'Hello world',
      lyricsAlignStatus: 'idle',
    };
    const project = makeProject([makeLyricsTrack([clip])]);
    const result = explodeLyricsClipToChunks(project, 'clip_lyrics');
    expect(result).toBe(project); // same reference = no change
  });

  it('returns same project if clip has words <= wordsPerChunk', () => {
    const words: WordTimestamp[] = [
      { word: 'Hello', start: 1.0, end: 1.5 },
      { word: 'world', start: 1.5, end: 2.0 },
    ];
    const clip = makeLyricsClip(words); // wordsPerChunk=2, 2 words = 1 chunk
    const project = makeProject([makeLyricsTrack([clip])]);
    const result = explodeLyricsClipToChunks(project, 'clip_lyrics');
    expect(result).toBe(project); // same reference = no change
  });

  it('returns same project if clip is not on a lyrics track', () => {
    const words = makeWords();
    const clip = makeLyricsClip(words);
    const videoTrack: Track = {
      id: 'track_video',
      type: 'video',
      name: 'Video',
      muted: false,
      clips: [clip],
    };
    const project = makeProject([videoTrack]);
    const result = explodeLyricsClipToChunks(project, 'clip_lyrics');
    expect(result).toBe(project);
  });

  it('preserves lyrics style on all chunks', () => {
    const words = makeWords();
    const style: LyricsStyle = {
      fontSize: 64,
      color: '#ff0000',
      highlightColor: '#00ff00',
      position: 'top',
      wordsPerChunk: 2,
    };
    const clip = makeLyricsClip(words, style);
    const project = makeProject([makeMasterAudioTrack(), makeLyricsTrack([clip])]);

    const result = explodeLyricsClipToChunks(project, 'clip_lyrics');
    const lyricsTrack = result.tracks.find((t) => t.type === 'lyrics')!;

    for (const c of lyricsTrack.clips) {
      expect(c.lyricsStyle).toEqual(style);
      expect(c.lyricsAlignStatus).toBe('done');
    }
  });

  it('preserves other clips on the same track', () => {
    const words = makeWords();
    const clip = makeLyricsClip(words);
    const otherClip: Clip = {
      id: 'clip_other',
      assetId: '',
      trackId: 'track_lyrics',
      timelineStart: 20,
      timelineEnd: 25,
      sourceStart: 0,
      sourceEnd: 5,
      lyricsContent: 'Other',
      lyricsAlignStatus: 'idle',
    };
    const project = makeProject([
      makeMasterAudioTrack(),
      makeLyricsTrack([otherClip, clip]),
    ]);

    const result = explodeLyricsClipToChunks(project, 'clip_lyrics');
    const lyricsTrack = result.tracks.find((t) => t.type === 'lyrics')!;

    // 1 other clip + 3 new chunks = 4 total
    expect(lyricsTrack.clips).toHaveLength(4);
    expect(lyricsTrack.clips.some((c) => c.id === 'clip_other')).toBe(true);
  });

  it('does not modify the original project object', () => {
    const words = makeWords();
    const clip = makeLyricsClip(words);
    const project = makeProject([
      makeMasterAudioTrack(),
      makeLyricsTrack([clip]),
    ]);
    const originalTrackCount = project.tracks.length;
    const originalClipCount = project.tracks.find((t) => t.type === 'lyrics')!.clips.length;

    explodeLyricsClipToChunks(project, 'clip_lyrics');

    expect(project.tracks.length).toBe(originalTrackCount);
    expect(project.tracks.find((t) => t.type === 'lyrics')!.clips.length).toBe(originalClipCount);
  });

  it('handles odd number of words (last chunk has fewer words)', () => {
    const words: WordTimestamp[] = [
      { word: 'One', start: 0, end: 0.5 },
      { word: 'two', start: 0.5, end: 1.0 },
      { word: 'three', start: 1.5, end: 2.0 },
      { word: 'four', start: 2.0, end: 2.5 },
      { word: 'five', start: 3.0, end: 3.5 },
    ];
    const style: LyricsStyle = { ...defaultStyle, wordsPerChunk: 2 };
    const clip = makeLyricsClip(words, style);
    const project = makeProject([makeMasterAudioTrack(), makeLyricsTrack([clip])]);

    const result = explodeLyricsClipToChunks(project, 'clip_lyrics');
    const lyricsTrack = result.tracks.find((t) => t.type === 'lyrics')!;

    // 5 words / 2 = 3 chunks (2, 2, 1)
    expect(lyricsTrack.clips).toHaveLength(3);
    expect(lyricsTrack.clips[0].lyricsWords).toHaveLength(2);
    expect(lyricsTrack.clips[1].lyricsWords).toHaveLength(2);
    expect(lyricsTrack.clips[2].lyricsWords).toHaveLength(1);
    expect(lyricsTrack.clips[2].lyricsContent).toBe('five');
  });
});
