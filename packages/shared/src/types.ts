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

export type EffectType = 'beatZoom' | 'cutout' | 'headStabilization' | 'cartoon';

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
  maskStatus?: 'pending' | 'processing' | 'done' | 'error';
  cutoutMode?: 'removeBg' | 'removePerson';  // removeBg=keep person, removePerson=keep background
  // headStabilization params
  smoothingX?: number;  // 0-1: stabilization strength on X axis
  smoothingY?: number;  // 0-1: stabilization strength on Y axis
  smoothingZ?: number;  // 0-1: stabilization strength on Z/zoom axis
  stabilizationStatus?: 'pending' | 'processing' | 'done' | 'error';
  // cartoon params
  edgeStrength?: number;        // 0-1: prominence of cartoon edges
  colorSimplification?: number; // 0-1: how much to simplify/flatten colors
  saturation?: number;          // 0-2: color saturation (1=normal)
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
  edgeStrength: number;
  colorSimplification: number;
  saturation: number;
}

export interface CutoutEffect {
  type: 'cutout';
  enabled: boolean;
  background: BackgroundConfig;
  maskStatus?: 'pending' | 'processing' | 'done' | 'error';
}

export interface HeadStabilizationEffect {
  type: 'headStabilization';
  enabled: boolean;
  smoothingX: number;
  smoothingY: number;
  smoothingZ: number;
  status?: 'pending' | 'processing' | 'done' | 'error';
}

// ─── Background config (used by cutout effect in EffectClipConfig) ──────────

export interface BackgroundConfig {
  type: 'solid' | 'video';
  color?: string;    // hex, for solid
  assetId?: string;  // for video background
}

// ─── Standalone effect types (used by effect panels) ─────────────────────────

export interface CartoonEffect {
  type: 'cartoon';
  enabled: boolean;
  edgeStrength: number;        // 0-1
  colorSimplification: number; // 0-1
  saturation: number;          // 0-2
}

export interface CutoutEffect {
  type: 'cutout';
  enabled: boolean;
  background: BackgroundConfig;
  maskStatus?: 'pending' | 'processing' | 'done' | 'error';
}

export interface HeadStabilizationEffect {
  type: 'headStabilization';
  enabled: boolean;
  smoothingX: number;  // 0-1
  smoothingY: number;  // 0-1
  smoothingZ: number;  // 0-1
  status?: 'pending' | 'processing' | 'done' | 'error';
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

export type JobStatus = 'QUEUED' | 'RUNNING' | 'DONE' | 'ERROR';
export type JobType = 'import' | 'beats' | 'lyrics' | 'export' | 'cutout' | 'headStabilization';

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
