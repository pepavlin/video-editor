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
