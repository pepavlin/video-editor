// ─── Project / EDL ──────────────────────────────────────────────────────────

export interface WorkArea {
  start: number;    // seconds – start of work area
  end: number;      // seconds – end of work area
  isManual: boolean; // false = auto-stretch to project duration
}

export interface Project {
  id: string;
  name: string;
  duration: number; // seconds (derived from tracks, but stored for quick access)
  aspectRatio: '9:16' | '1:1' | '16:9' | 'custom';
  outputResolution: { w: number; h: number };
  tracks: Track[];
  lyrics?: LyricsData;
  workArea?: WorkArea;
  createdAt: string;
  updatedAt: string;
}

export type EffectType = 'beatZoom' | 'cutout' | 'headStabilization' | 'cartoon' | 'colorGrade';

/** Cartoon sub-mode: classic edge-detection cartoon or AI painterly stylization */
export type CartoonMode = 'classic' | 'aiStyle';

/**
 * AI Style presets — each maps to an AnimeGANv2 ONNX model for true cartoonization.
 *
 * - hayao:   Hayao Miyazaki / Studio Ghibli style — soft colors, natural scenery
 * - shinkai: Makoto Shinkai style — vivid sky colors, crisp details
 * - paprika: Satoshi Kon / Paprika style — dreamy, expressive colors
 * - celeb:   Portrait-focused cartoon style — optimized for faces
 */
export type AiStylePreset = 'hayao' | 'shinkai' | 'paprika' | 'celeb';

export interface Track {
  id: string;
  type: 'video' | 'audio' | 'text' | 'lyrics' | 'effect';
  isMaster?: boolean; // master audio track
  name: string;
  muted?: boolean;
  clips: Clip[];
  effectType?: EffectType;    // only for 'effect' tracks
  parentTrackId?: string;     // only for 'effect' tracks – which video track this applies to
}

export interface TextStyle {
  fontFamily: string;
  fontSize: number;       // design pixels relative to 1920px height reference
  color: string;          // hex
  bold?: boolean;
  italic?: boolean;
  align?: 'left' | 'center' | 'right';
  background?: string;    // optional background box color (hex)
  backgroundOpacity?: number; // 0..1
}

export interface RectangleStyle {
  color: string;          // fill color hex
  fillOpacity: number;    // 0..1 fill opacity
  width: number;          // design pixels relative to 1920px height reference
  height: number;         // design pixels relative to 1920px height reference
  borderRadius?: number;  // corner radius in design pixels (optional)
  borderColor?: string;   // optional border/stroke color hex
  borderWidth?: number;   // optional border width in design pixels
}

export interface Clip {
  id: string;
  assetId: string;
  trackId: string;
  timelineStart: number; // seconds on timeline
  timelineEnd: number;   // seconds on timeline
  sourceStart: number;   // trim: start in asset (seconds)
  sourceEnd: number;     // trim: end in asset (seconds)
  // Video-clip-only fields (absent on audio clips):
  useClipAudio?: boolean;    // use embedded audio from video clip
  clipAudioVolume?: number;  // 0..2, defaults to 1
  transform?: Transform;     // position/scale/rotation/opacity (video + text tracks)
  // Text-clip-only fields:
  textContent?: string;      // text to display (text tracks only)
  textStyle?: TextStyle;     // text appearance (text tracks only)
  // Rectangle-clip-only fields:
  rectangleStyle?: RectangleStyle; // rectangle appearance (rectangle clips only)
  // Lyrics-clip-only fields:
  lyricsContent?: string;    // full lyrics text (lyrics tracks only)
  lyricsWords?: WordTimestamp[];  // word-level timestamps from Whisper (lyrics tracks only)
  lyricsStyle?: LyricsStyle; // lyrics appearance (lyrics tracks only)
  lyricsAlignStatus?: 'idle' | 'aligning' | 'done' | 'error'; // alignment job status
  // Effect track clip fields:
  effectConfig?: EffectClipConfig; // only for clips on 'effect' tracks
}

// Configuration stored on each clip that lives on an 'effect' track
export interface EffectClipConfig {
  effectType: EffectType;
  enabled: boolean;
  // beatZoom params
  intensity?: number;   // fraction e.g. 0.08 = +8%
  durationMs?: number;  // pulse duration ms
  easing?: 'linear' | 'easeOut' | 'easeIn' | 'easeInOut';
  beatDivision?: number; // how often to zoom relative to beats: 1=every beat (1/1), 2=every 2nd (1/2), 4=every 4th (1/4); 0.5=twice per beat (2/1)
  // cutout params
  background?: BackgroundConfig;
  cutoutMode?: 'removeBg' | 'removePerson';  // removeBg=keep person, removePerson=keep background
  maskBlur?: number;        // 0-20: edge smoothing radius in px (default 0)
  maskExpand?: number;      // -10 to 10: expand (+) or contract (-) mask edges (default 0)
  maskThreshold?: number;   // 0-255: luminance threshold for mask binarization (default 128)
  // headStabilization params
  smoothingX?: number;  // 0-1: stabilization strength on X axis
  smoothingY?: number;  // 0-1: stabilization strength on Y axis
  smoothingZ?: number;  // 0-1: stabilization strength on Z/zoom axis
  // cartoon params (shared)
  cartoonMode?: CartoonMode;    // 'classic' (default) or 'aiStyle'
  // cartoon classic params
  edgeStrength?: number;        // 0-1: prominence of cartoon edges
  colorSimplification?: number; // 0-1: how much to simplify/flatten colors
  saturation?: number;          // 0-2: color saturation (1=normal)
  // cartoon aiStyle params
  stylePreset?: AiStylePreset;  // AI style model preset (default: 'hayao')
  styleStrength?: number;       // 0-1: blending weight between original and stylized (1=full style)
  brushSize?: number;           // 0-1: controls brush stroke coarseness
  colorVibrance?: number;       // 0-2: color vibrancy of the painterly output (1=normal)
  // colorGrade params
  contrast?: number;            // 0-2: image contrast (1=normal)
  brightness?: number;          // 0-2: image brightness (1=normal)
  colorSaturation?: number;     // 0-2: color saturation for color grade (1=normal)
  hue?: number;                 // -180 to 180: hue rotation degrees (0=no change)
  shadows?: number;             // -1 to 1: shadow lift/push (0=no change)
  highlights?: number;          // -1 to 1: highlight boost/reduce (0=no change)
}

export interface Transform {
  scale: number;   // 1 = 100%
  x: number;       // offset px (at output res)
  y: number;
  rotation: number; // degrees
  opacity: number;  // 0..1
}

// ─── Typed effect descriptors (used by effect panel components) ─────────────

export interface CartoonEffect {
  type: 'cartoon';
  enabled: boolean;
  cartoonMode: CartoonMode;
  // classic mode params
  edgeStrength: number;
  colorSimplification: number;
  saturation: number;
  // aiStyle mode params
  stylePreset: AiStylePreset;
  styleStrength: number;
  brushSize: number;
  colorVibrance: number;
}

export interface CutoutEffect {
  type: 'cutout';
  enabled: boolean;
  background: BackgroundConfig;
  maskBlur: number;        // 0-20: edge smoothing radius
  maskExpand: number;      // -10 to 10: expand/contract mask edges
  maskThreshold: number;   // 0-255: luminance threshold
}

export interface HeadStabilizationEffect {
  type: 'headStabilization';
  enabled: boolean;
  smoothingX: number;
  smoothingY: number;
  smoothingZ: number;
}

export interface ColorGradeEffect {
  type: 'colorGrade';
  enabled: boolean;
  contrast: number;         // 0-2, default 1
  brightness: number;       // 0-2, default 1
  colorSaturation: number;  // 0-2, default 1
  hue: number;              // -180 to 180, default 0
  shadows: number;          // -1 to 1, default 0
  highlights: number;       // -1 to 1, default 0
}

// ─── Background config (used by cutout effect in EffectClipConfig) ──────────

export interface BackgroundConfig {
  type: 'none' | 'solid' | 'video';
  color?: string;    // hex, for solid
  assetId?: string;  // for video background
}

// ─── Standalone effect types (used by effect panels) ─────────────────────────

export interface CartoonEffect {
  type: 'cartoon';
  enabled: boolean;
  cartoonMode: CartoonMode;
  edgeStrength: number;        // 0-1
  colorSimplification: number; // 0-1
  saturation: number;          // 0-2
  stylePreset: AiStylePreset;  // AI style model preset
  styleStrength: number;       // 0-1
  brushSize: number;           // 0-1
  colorVibrance: number;       // 0-2
}

export interface HeadStabilizationEffect {
  type: 'headStabilization';
  enabled: boolean;
  smoothingX: number;  // 0-1
  smoothingY: number;  // 0-1
  smoothingZ: number;  // 0-1
}

// ─── Assets ─────────────────────────────────────────────────────────────────

export interface Asset {
  id: string;
  name: string;
  type: 'video' | 'audio';
  originalPath: string;   // relative to workspace
  proxyPath?: string;
  audioPath?: string;
  waveformPath?: string;
  beatsPath?: string;
  maskPath?: string;
  headStabilizedPath?: string;  // stabilized proxy video (from head-stabilize job)
  aiStylePath?: string;         // AI-stylized proxy video (from ai-style job)
  cutoutJobId?: string;         // active or last cutout job ID (for polling from UI)
  headStabJobId?: string;       // active or last head-stabilization job ID
  aiStyleJobId?: string;        // active or last AI style job ID (for polling from UI)
  duration: number;       // seconds
  width?: number;
  height?: number;
  fps?: number;
  createdAt: string;
}

export interface WaveformData {
  samples: number[];    // normalized 0..1, length ~2000-4000 per minute
  sampleRate: number;   // samples per second of audio (usually 2-10 per second after downsampling)
  duration: number;     // seconds
}

export interface BeatsData {
  tempo: number;
  beats: number[];      // timestamps in seconds
}

// ─── Lyrics ─────────────────────────────────────────────────────────────────

export interface LyricsData {
  text: string;
  words?: WordTimestamp[];
  enabled?: boolean;
  style?: LyricsStyle;
}

export interface WordTimestamp {
  word: string;
  start: number;
  end: number;
}

export interface LyricsStyle {
  fontSize: number;
  color: string;         // hex
  highlightColor: string;
  position: 'top' | 'center' | 'bottom';
  wordsPerChunk: number;
}

// ─── Jobs ────────────────────────────────────────────────────────────────────

export type JobStatus = 'QUEUED' | 'RUNNING' | 'DONE' | 'ERROR' | 'CANCELLED';
export type JobType = 'import' | 'beats' | 'lyrics' | 'export' | 'cutout' | 'headStabilization' | 'aiStyle';

export interface Job {
  id: string;
  type: JobType;
  status: JobStatus;
  progress: number;      // 0..100
  error?: string;
  outputPath?: string;   // relative to workspace
  relatedId?: string;    // assetId or projectId
  createdAt: string;
  updatedAt: string;
  lastLogLines?: string[];
}

// ─── API Response types ──────────────────────────────────────────────────────

export interface ApiError {
  error: string;
  details?: string;
}

export interface ImportResponse {
  jobId: string;
  assetId: string;
}

export interface CreateProjectResponse {
  id: string;
  project: Project;
}

export interface JobStatusResponse {
  job: Job;
}

// ─── Clipboard ──────────────────────────────────────────────────────────────

/** Data stored in the in-memory clipboard when the user copies a clip. */
export interface ClipboardData {
  /** Deep-cloned snapshot of the copied clip (IDs will be regenerated on paste). */
  clip: Clip;
  /** Track type of the source track so we can create the correct track on paste. */
  trackType: Track['type'];
  /** Effect tracks linked to the source video track, with only the clips that overlap the copied clip. */
  effectTracks: ClipboardEffectTrack[];
}

export interface ClipboardEffectTrack {
  /** Snapshot of the effect track metadata (without clips). */
  effectType: EffectType;
  name: string;
  muted?: boolean;
  /** Effect clips that overlapped with the copied clip's time range. */
  clips: Clip[];
}

// ─── Editor UI state (not persisted) ────────────────────────────────────────

export interface PlaybackState {
  isPlaying: boolean;
  currentTime: number;  // seconds
  duration: number;
}

export interface SelectionState {
  clipIds: string[];
  trackId?: string;
}

export interface TimelineViewState {
  zoom: number;        // pixels per second
  scrollLeft: number;  // pixels
}
