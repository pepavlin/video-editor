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

export interface Track {
  id: string;
  type: 'video' | 'audio';
  isMaster?: boolean; // master audio track
  name: string;
  muted?: boolean;
  clips: Clip[];
}

export interface Clip {
  id: string;
  assetId: string;
  trackId: string;
  timelineStart: number; // seconds on timeline
  timelineEnd: number;   // seconds on timeline
  sourceStart: number;   // trim: start in asset (seconds)
  sourceEnd: number;     // trim: end in asset (seconds)
  useClipAudio: boolean;
  clipAudioVolume: number; // 0..2
  transform: Transform;
  effects: Effect[];
}

export interface Transform {
  scale: number;   // 1 = 100%
  x: number;       // offset px (at output res)
  y: number;
  rotation: number; // degrees
  opacity: number;  // 0..1
}

// ─── Effects ────────────────────────────────────────────────────────────────

export type Effect = BeatZoomEffect | CutoutEffect;

export interface BeatZoomEffect {
  type: 'beatZoom';
  enabled: boolean;
  intensity: number;     // fraction, e.g. 0.08 = +8%
  durationMs: number;    // pulse duration
  easing: 'linear' | 'easeOut' | 'easeIn' | 'easeInOut';
}

export interface CutoutEffect {
  type: 'cutout';
  enabled: boolean;
  background: BackgroundConfig;
  maskStatus?: 'pending' | 'processing' | 'done' | 'error';
}

export interface BackgroundConfig {
  type: 'solid' | 'video';
  color?: string;    // hex, for solid
  assetId?: string;  // for video background
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
export type JobType = 'import' | 'beats' | 'lyrics' | 'export' | 'cutout';

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
