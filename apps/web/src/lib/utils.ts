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

// ─── Beat zoom scale at time t ────────────────────────────────────────────────

export function getBeatZoomScale(
  t: number,
  beats: number[],
  clipTimelineStart: number,
  intensity: number,
  durationMs: number,
  easing: string
): number {
  const dur = durationMs / 1000;
  for (const beat of beats) {
    const localBeat = beat - clipTimelineStart;
    if (t >= localBeat && t < localBeat + dur) {
      const progress = (t - localBeat) / dur;
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
