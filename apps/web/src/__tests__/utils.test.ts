import { describe, it, expect } from 'vitest';
import {
  formatTime,
  parseTime,
  genId,
  getClipColor,
  easeOut,
  easeIn,
  easeInOut,
  getBeatZoomScale,
  filterBeatsByDivision,
  clamp,
  snap,
} from '../lib/utils';

// ─── formatTime ───────────────────────────────────────────────────────────────

describe('formatTime', () => {
  it('formats zero as 00:00.0', () => {
    expect(formatTime(0)).toBe('00:00.0');
  });

  it('formats 1.5 seconds', () => {
    expect(formatTime(1.5)).toBe('00:01.5');
  });

  it('formats minutes correctly', () => {
    expect(formatTime(65)).toBe('01:05.0');
  });

  it('formats 1h 23m 45.6s correctly', () => {
    const t = 1 * 3600 + 23 * 60 + 45.6;
    expect(formatTime(t)).toContain('83:45');
  });

  it('pads single-digit seconds', () => {
    expect(formatTime(62)).toBe('01:02.0');
  });
});

// ─── parseTime ────────────────────────────────────────────────────────────────

describe('parseTime', () => {
  it('parses mm:ss format', () => {
    expect(parseTime('01:30')).toBe(90);
  });

  it('parses mm:ss.ms format', () => {
    expect(parseTime('00:05.5')).toBeCloseTo(5.5, 3);
  });

  it('parses plain seconds string', () => {
    expect(parseTime('42.5')).toBeCloseTo(42.5, 3);
  });

  it('round-trips with formatTime (integer seconds)', () => {
    const t = 125;
    expect(parseTime(formatTime(t))).toBeCloseTo(t, 0);
  });
});

// ─── genId ────────────────────────────────────────────────────────────────────

describe('genId', () => {
  it('returns a non-empty string', () => {
    expect(genId()).toBeTruthy();
  });

  it('uses the given prefix', () => {
    expect(genId('clip')).toMatch(/^clip_/);
  });

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => genId()));
    expect(ids.size).toBe(100);
  });
});

// ─── getClipColor ─────────────────────────────────────────────────────────────

describe('getClipColor', () => {
  it('returns a valid hex color', () => {
    const color = getClipColor('asset_abc');
    expect(color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('returns same color for same assetId', () => {
    expect(getClipColor('stable_id')).toBe(getClipColor('stable_id'));
  });

  it('returns different colors for different assets (mostly)', () => {
    const colors = new Set(['id_a', 'id_b', 'id_c', 'id_d', 'id_e'].map(getClipColor));
    // At least some variation expected
    expect(colors.size).toBeGreaterThan(1);
  });
});

// ─── Easing functions ─────────────────────────────────────────────────────────

describe('easeOut', () => {
  it('easeOut(0) === 0', () => expect(easeOut(0)).toBeCloseTo(0, 5));
  it('easeOut(1) === 1', () => expect(easeOut(1)).toBeCloseTo(1, 5));
  it('easeOut(0.5) > 0.5 (fast start)', () => expect(easeOut(0.5)).toBeGreaterThan(0.5));
  it('output stays in [0, 1] for inputs in [0, 1]', () => {
    for (let t = 0; t <= 1; t += 0.1) {
      expect(easeOut(t)).toBeGreaterThanOrEqual(0);
      expect(easeOut(t)).toBeLessThanOrEqual(1);
    }
  });
});

describe('easeIn', () => {
  it('easeIn(0) === 0', () => expect(easeIn(0)).toBeCloseTo(0, 5));
  it('easeIn(1) === 1', () => expect(easeIn(1)).toBeCloseTo(1, 5));
  it('easeIn(0.5) < 0.5 (slow start)', () => expect(easeIn(0.5)).toBeLessThan(0.5));
});

describe('easeInOut', () => {
  it('easeInOut(0) === 0', () => expect(easeInOut(0)).toBeCloseTo(0, 5));
  it('easeInOut(1) === 1', () => expect(easeInOut(1)).toBeCloseTo(1, 5));
  it('easeInOut(0.5) === 0.5 (midpoint symmetry)', () => expect(easeInOut(0.5)).toBeCloseTo(0.5, 5));
  it('easeInOut is symmetric around 0.5', () => {
    expect(easeInOut(0.25)).toBeCloseTo(1 - easeInOut(0.75), 5);
  });
});

// ─── getBeatZoomScale ─────────────────────────────────────────────────────────

describe('getBeatZoomScale', () => {
  // beats[] contains absolute timeline timestamps
  const beats = [1.0, 2.0, 3.0];
  const intensity = 0.1;
  const durationMs = 200; // 0.2s

  it('returns 1 when not near any beat', () => {
    expect(getBeatZoomScale(0.5, beats, intensity, durationMs, 'easeOut')).toBe(1);
  });

  it('returns > 1 at the start of a beat window', () => {
    // At exactly the beat time, progress = 0, invProgress = 1, scale = 1 + intensity * easeOut(1) = 1.1
    const scale = getBeatZoomScale(1.0, beats, intensity, durationMs, 'easeOut');
    expect(scale).toBeCloseTo(1 + intensity, 2);
  });

  it('returns ~1 just after the end of a beat window', () => {
    // At 1.0 + 0.201 (just past window end), should return 1
    const scale = getBeatZoomScale(1.201, beats, intensity, durationMs, 'easeOut');
    expect(scale).toBe(1);
  });

  it('handles easeIn easing', () => {
    const scale = getBeatZoomScale(1.0, beats, intensity, durationMs, 'easeIn');
    expect(scale).toBeGreaterThan(1);
    expect(scale).toBeLessThanOrEqual(1 + intensity);
  });

  it('handles easeInOut easing', () => {
    const scale = getBeatZoomScale(1.0, beats, intensity, durationMs, 'easeInOut');
    expect(scale).toBeGreaterThan(1);
  });

  it('handles linear easing (unknown easing string)', () => {
    const scale = getBeatZoomScale(1.0, beats, intensity, durationMs, 'linear');
    expect(scale).toBeCloseTo(1 + intensity, 2); // invProgress = 1 at t = beat start
  });

  it('uses absolute timeline timestamps — beat at 6s triggers zoom at t=6s', () => {
    // Beat at 6s absolute → triggers zoom when currentTime = 6s
    const scale = getBeatZoomScale(6.0, [6.0], intensity, durationMs, 'easeOut');
    expect(scale).toBeGreaterThan(1);
    // Does NOT trigger at t=1s (old offset-based behavior was wrong)
    expect(getBeatZoomScale(1.0, [6.0], intensity, durationMs, 'easeOut')).toBe(1);
  });

  it('returns 1 for empty beats array', () => {
    expect(getBeatZoomScale(1.0, [], intensity, durationMs, 'easeOut')).toBe(1);
  });
});

// ─── filterBeatsByDivision ─────────────────────────────────────────────────────

describe('filterBeatsByDivision', () => {
  const beats = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0];

  it('division=1 returns all beats', () => {
    expect(filterBeatsByDivision(beats, 1)).toEqual(beats);
  });

  it('division=2 returns every 2nd beat', () => {
    expect(filterBeatsByDivision(beats, 2)).toEqual([1.0, 3.0, 5.0, 7.0]);
  });

  it('division=4 returns every 4th beat', () => {
    expect(filterBeatsByDivision(beats, 4)).toEqual([1.0, 5.0]);
  });

  it('division=8 returns every 8th beat', () => {
    expect(filterBeatsByDivision(beats, 8)).toEqual([1.0]);
  });

  it('division=0.5 (2/1) returns 2x triggers per beat interval', () => {
    const twoBeats = [0.0, 1.0];
    const result = filterBeatsByDivision(twoBeats, 0.5);
    // expects: [0.0, 0.5, 1.0]
    expect(result).toHaveLength(3);
    expect(result[0]).toBeCloseTo(0.0);
    expect(result[1]).toBeCloseTo(0.5);
    expect(result[2]).toBeCloseTo(1.0);
  });

  it('division=0.25 (4/1) returns 4x triggers per beat interval', () => {
    const twoBeats = [0.0, 1.0];
    const result = filterBeatsByDivision(twoBeats, 0.25);
    expect(result).toHaveLength(5);
    expect(result[1]).toBeCloseTo(0.25);
    expect(result[2]).toBeCloseTo(0.5);
    expect(result[3]).toBeCloseTo(0.75);
  });

  it('returns empty array for empty input', () => {
    expect(filterBeatsByDivision([], 2)).toEqual([]);
  });
});

// ─── getBeatZoomScale with beatDivision ────────────────────────────────────────

describe('getBeatZoomScale with beatDivision', () => {
  const beats = [1.0, 2.0, 3.0, 4.0];
  const intensity = 0.1;
  const durationMs = 100; // 0.1s

  it('division=2: zooms on 1st beat, skips 2nd', () => {
    expect(getBeatZoomScale(1.0, beats, intensity, durationMs, 'easeOut', 2)).toBeGreaterThan(1);
    expect(getBeatZoomScale(2.0, beats, intensity, durationMs, 'easeOut', 2)).toBe(1);
  });

  it('division=4: zooms only on 1st beat', () => {
    expect(getBeatZoomScale(1.0, beats, intensity, durationMs, 'easeOut', 4)).toBeGreaterThan(1);
    expect(getBeatZoomScale(2.0, beats, intensity, durationMs, 'easeOut', 4)).toBe(1);
    expect(getBeatZoomScale(3.0, beats, intensity, durationMs, 'easeOut', 4)).toBe(1);
    expect(getBeatZoomScale(4.0, beats, intensity, durationMs, 'easeOut', 4)).toBe(1);
  });

  it('division=1 (default): behaves same as no division argument', () => {
    const withDivision = getBeatZoomScale(2.0, beats, intensity, durationMs, 'easeOut', 1);
    const withoutDivision = getBeatZoomScale(2.0, beats, intensity, durationMs, 'easeOut');
    expect(withDivision).toBe(withoutDivision);
  });
});

// ─── clamp ────────────────────────────────────────────────────────────────────

describe('clamp', () => {
  it('returns value when within bounds', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it('clamps to min', () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });

  it('clamps to max', () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it('clamps exactly at bounds', () => {
    expect(clamp(0, 0, 10)).toBe(0);
    expect(clamp(10, 0, 10)).toBe(10);
  });
});

// ─── snap ─────────────────────────────────────────────────────────────────────

describe('snap', () => {
  it('snaps to nearby target', () => {
    expect(snap(4.9, [5.0], 0.2)).toBe(5.0);
  });

  it('does not snap when outside threshold', () => {
    expect(snap(4.7, [5.0], 0.2)).toBe(4.7);
  });

  it('snaps to nearest of multiple targets', () => {
    // 2.9 is 0.1 from 3.0 and 0.9 from 2.0
    expect(snap(2.9, [2.0, 3.0], 0.2)).toBe(3.0);
  });

  it('returns original value when no targets', () => {
    expect(snap(5.0, [], 0.5)).toBe(5.0);
  });

  it('snaps to exact target value', () => {
    expect(snap(7.0, [7.0, 14.0], 0.01)).toBe(7.0);
  });
});

// ─── snap mode behaviour ──────────────────────────────────────────────────────
// These tests simulate what getSnapTargets() returns for each SnapMode and
// verify that the snap() utility respects the resulting target list.

describe('snap with mode:none (empty targets)', () => {
  it('does not snap when targets are empty', () => {
    expect(snap(4.95, [], 0.2)).toBe(4.95);
  });

  it('returns original value regardless of proximity', () => {
    expect(snap(5.0, [], 0.5)).toBe(5.0);
  });
});

describe('snap with mode:beats (only beat positions)', () => {
  const beats = [0.5, 1.0, 1.5, 2.0]; // sample beat timestamps

  it('snaps to a nearby beat', () => {
    expect(snap(0.95, beats, 0.1)).toBe(1.0);
  });

  it('does not snap to clip edge (only beats supplied)', () => {
    const clipEdge = 1.3; // not a beat
    expect(snap(1.28, [clipEdge], 0.1)).toBe(clipEdge); // would snap to clipEdge
    expect(snap(1.28, beats, 0.1)).toBe(1.28); // beats only → no snap
  });

  it('snaps to the closest beat among several', () => {
    // 1.48 is 0.02 from beat 1.5 and 0.48 from beat 1.0
    expect(snap(1.48, beats, 0.1)).toBe(1.5);
  });
});

describe('snap with mode:clips (only clip edges)', () => {
  const clipEdges = [0, 1.0, 2.5, 4.0]; // starts/ends of other clips

  it('snaps to a nearby clip edge', () => {
    expect(snap(2.48, clipEdges, 0.1)).toBe(2.5);
  });

  it('does not snap to beat (only clip edges supplied)', () => {
    const beat = 1.8; // not a clip edge
    expect(snap(1.79, [beat], 0.1)).toBe(beat); // would snap to beat
    expect(snap(1.79, clipEdges, 0.1)).toBe(1.79); // clips only → no snap
  });

  it('snaps to timeline start (0) when close enough', () => {
    expect(snap(0.05, clipEdges, 0.1)).toBe(0);
  });
});
