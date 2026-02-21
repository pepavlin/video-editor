// ─── Time formatting ──────────────────────────────────────────────────────────

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 10);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${ms}`;
}

export function parseTime(str: string): number {
  const parts = str.split(':');
  if (parts.length === 2) {
    return parseInt(parts[0]) * 60 + parseFloat(parts[1]);
  }
  return parseFloat(str);
}

// ─── ID generation ────────────────────────────────────────────────────────────

let _counter = 0;
export function genId(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${(++_counter).toString(36)}`;
}

// ─── Clip color ───────────────────────────────────────────────────────────────

const CLIP_COLORS = [
  '#5c6bc0', '#42a5f5', '#26c6da', '#66bb6a',
  '#d4e157', '#ffca28', '#ffa726', '#ef5350',
  '#ab47bc', '#ec407a',
];

const colorCache = new Map<string, string>();
export function getClipColor(assetId: string): string {
  if (!colorCache.has(assetId)) {
    let hash = 0;
    for (let i = 0; i < assetId.length; i++) hash += assetId.charCodeAt(i);
    colorCache.set(assetId, CLIP_COLORS[hash % CLIP_COLORS.length]);
  }
  return colorCache.get(assetId)!;
}

// ─── Easing functions ─────────────────────────────────────────────────────────

export function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function easeIn(t: number): number {
  return t * t * t;
}

export function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// ─── Beat division filter ─────────────────────────────────────────────────────

// beatDivision controls how many beats trigger the zoom:
//   >= 1  → use every Nth beat (1=every beat, 2=every 2nd, 4=every 4th, …)
//   < 1   → interpolate sub-beat triggers (0.5=twice per beat, 0.25=4x per beat)
export function filterBeatsByDivision(beats: number[], beatDivision: number): number[] {
  if (beatDivision <= 0) return beats;

  if (beatDivision >= 1) {
    const step = Math.round(beatDivision);
    return beats.filter((_, i) => i % step === 0);
  }

  // Sub-beat: interpolate evenly between consecutive beats
  const subdivisions = Math.round(1 / beatDivision);
  const result: number[] = [];
  for (let i = 0; i < beats.length; i++) {
    result.push(beats[i]);
    if (i < beats.length - 1) {
      const interval = beats[i + 1] - beats[i];
      for (let j = 1; j < subdivisions; j++) {
        result.push(beats[i] + (j / subdivisions) * interval);
      }
    }
  }
  return result;
}

// ─── Beat zoom scale at time t ────────────────────────────────────────────────

// beats[] contains absolute timeline timestamps (= song time, since master audio starts at 0).
// t is also absolute timeline time. Compare directly without any offset.
export function getBeatZoomScale(
  t: number,
  beats: number[],
  intensity: number,
  durationMs: number,
  easing: string,
  beatDivision = 1
): number {
  const activeBeats = beatDivision === 1 ? beats : filterBeatsByDivision(beats, beatDivision);
  const dur = durationMs / 1000;
  for (const beat of activeBeats) {
    if (t >= beat && t < beat + dur) {
      const progress = (t - beat) / dur;
      const invProgress = 1 - progress; // zoom then release
      let e: number;
      if (easing === 'easeOut') e = easeOut(invProgress);
      else if (easing === 'easeIn') e = easeIn(invProgress);
      else if (easing === 'easeInOut') e = easeInOut(invProgress);
      else e = invProgress;
      return 1 + intensity * e;
    }
  }
  return 1;
}

// ─── Clamp ────────────────────────────────────────────────────────────────────

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

// ─── Snap value ───────────────────────────────────────────────────────────────

export function snap(v: number, targets: number[], threshold: number): number {
  for (const t of targets) {
    if (Math.abs(v - t) < threshold) return t;
  }
  return v;
}
