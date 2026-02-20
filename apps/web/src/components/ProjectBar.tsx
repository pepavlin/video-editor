'use client';

import { useState, useEffect, useRef } from 'react';
import type { Asset, BeatsData } from '@video-editor/shared';

interface Props {
  masterAsset: Asset | null;
  beatsData: Map<string, BeatsData>;
  onAnalyzeBeats: () => Promise<void>;
  onExport: () => Promise<void>;
  onDownload: () => void;
  beatsProgress: number | null;
  beatsLogLine: string | null;
  exportProgress: number | null;
  exportLogLine: string | null;
  completedExportJobId: string | null;
}

export default function ProjectBar({
  masterAsset,
  beatsData,
  onAnalyzeBeats,
  onExport,
  onDownload,
  beatsProgress,
  beatsLogLine,
  exportProgress,
  exportLogLine,
  completedExportJobId,
}: Props) {
  const isAnalyzing = beatsProgress !== null;
  const isExporting = exportProgress !== null;
  const exportDone = !!completedExportJobId;

  // Detect when master changes so we can flag beats as stale
  const prevMasterIdRef = useRef<string | undefined>(masterAsset?.id);
  const [beatsStale, setBeatsStale] = useState(false);

  useEffect(() => {
    if (masterAsset?.id !== prevMasterIdRef.current) {
      prevMasterIdRef.current = masterAsset?.id;
      if (masterAsset?.beatsPath) {
        setBeatsStale(false);
      } else {
        setBeatsStale(true);
      }
    }
  }, [masterAsset?.id, masterAsset?.beatsPath]);

  useEffect(() => {
    if (masterAsset?.beatsPath) setBeatsStale(false);
  }, [masterAsset?.beatsPath]);

  const beats = masterAsset ? beatsData.get(masterAsset.id) : null;
  const isAnalyzed = !!masterAsset?.beatsPath;
  const needsAnalysis = !isAnalyzed || beatsStale;

  const handleAnalyze = () => {
    setBeatsStale(false);
    onAnalyzeBeats();
  };

  return (
    <div
      className="flex items-center gap-3 px-4 flex-shrink-0 border-b select-none overflow-x-auto"
      style={{
        background: 'rgba(8,18,32,0.82)',
        backdropFilter: 'blur(12px)',
        borderColor: 'rgba(0,212,160,0.18)',
        minHeight: 40,
      }}
    >
      {/* Master audio */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(0,212,160,0.7)" strokeWidth="2">
          <path d="M9 18V5l12-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="16" r="3" />
        </svg>
        <span className="text-xs" style={{ color: 'rgba(0,212,160,0.6)' }}>Master</span>
        {masterAsset ? (
          <span className="text-xs font-medium truncate max-w-[140px]" style={{ color: '#a8d8ce' }}>
            {masterAsset.name}
          </span>
        ) : (
          <span className="text-xs italic" style={{ color: 'rgba(0,212,160,0.3)' }}>
            no audio track
          </span>
        )}
      </div>

      <div className="w-px h-4 flex-shrink-0" style={{ background: 'rgba(0,212,160,0.22)' }} />

      {/* Beat status / progress / analyze button */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {isAnalyzing ? (
          <JobProgressBlock
            label="Analyzing beats"
            progress={beatsProgress!}
            logLine={beatsLogLine}
            color="teal"
          />
        ) : (
          <>
            <BeatStatusBadge
              masterAsset={masterAsset}
              isAnalyzed={isAnalyzed}
              beatsStale={beatsStale}
              beats={beats}
            />
            {masterAsset && (
              <button
                className="btn text-xs py-0.5 px-2.5 flex-shrink-0"
                style={{
                  background: needsAnalysis
                    ? 'linear-gradient(135deg, #00d4a0, #38bdf8)'
                    : 'rgba(0,212,160,0.1)',
                  border: needsAnalysis
                    ? '1px solid rgba(0,212,160,0.4)'
                    : '1px solid rgba(0,212,160,0.15)',
                  color: needsAnalysis ? '#040a08' : 'rgba(0,212,160,0.7)',
                  fontWeight: needsAnalysis ? 600 : 400,
                  boxShadow: needsAnalysis ? '0 0 10px rgba(0,212,160,0.25)' : 'none',
                }}
                onClick={handleAnalyze}
                disabled={!masterAsset}
              >
                {needsAnalysis ? '⚡ Analyze Beats' : '↺ Re-analyze'}
              </button>
            )}
          </>
        )}
      </div>

      <div className="flex-1" />

      {/* Export area: progress → download → button */}
      {isExporting ? (
        <JobProgressBlock
          label="Exporting MP4"
          progress={exportProgress!}
          logLine={exportLogLine}
          color="amber"
        />
      ) : exportDone ? (
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xs" style={{ color: 'rgba(0,212,160,0.6)' }}>Export done</span>
          <button
            className="btn text-xs py-0.5 px-3 flex-shrink-0"
            style={{
              background: 'linear-gradient(135deg, #00d4a0, #22c55e)',
              border: '1px solid rgba(0,212,160,0.45)',
              color: '#03180e',
              fontWeight: 700,
              boxShadow: '0 0 14px rgba(0,212,160,0.4)',
            }}
            onClick={onDownload}
          >
            ⬇ Download MP4
          </button>
        </div>
      ) : (
        <button
          className="btn text-xs py-0.5 px-3 flex-shrink-0"
          style={{
            background: 'linear-gradient(135deg, rgba(240,177,0,0.85), rgba(255,160,30,0.85))',
            border: '1px solid rgba(240,177,0,0.35)',
            color: '#0a0800',
            fontWeight: 600,
            boxShadow: '0 0 10px rgba(240,177,0,0.2)',
          }}
          onClick={onExport}
        >
          ⬇ Export MP4
        </button>
      )}
    </div>
  );
}

// ─── Progress block with log line ─────────────────────────────────────────────

function JobProgressBlock({
  label,
  progress,
  logLine,
  color,
}: {
  label: string;
  progress: number;
  logLine: string | null;
  color: 'teal' | 'amber';
}) {
  const isTeal = color === 'teal';
  const gradient = isTeal
    ? 'linear-gradient(90deg, #00d4a0, #38bdf8)'
    : 'linear-gradient(90deg, rgba(240,177,0,0.95), rgba(255,160,30,0.95))';
  const glow = isTeal ? 'rgba(0,212,160,0.45)' : 'rgba(240,177,0,0.45)';
  const primary = isTeal ? '#5ee8c8' : '#f0c040';
  const muted = isTeal ? 'rgba(94,232,200,0.5)' : 'rgba(240,192,64,0.5)';

  return (
    <div className="flex flex-col justify-center gap-0.5" style={{ minWidth: 240 }}>
      {/* Top row: label · bar · % */}
      <div className="flex items-center gap-2">
        <span
          className="w-1.5 h-1.5 rounded-full flex-shrink-0 animate-pulse"
          style={{ background: primary }}
        />
        <span className="text-xs flex-shrink-0 font-medium" style={{ color: primary }}>
          {label}
        </span>
        <div
          className="relative h-1.5 rounded-full flex-1"
          style={{ background: 'rgba(255,255,255,0.08)', minWidth: 80 }}
        >
          <div
            className="absolute inset-y-0 left-0 rounded-full transition-all duration-300"
            style={{
              width: `${Math.max(2, progress)}%`,
              background: gradient,
              boxShadow: `0 0 6px ${glow}`,
            }}
          />
        </div>
        <span
          className="text-xs tabular-nums flex-shrink-0 font-semibold"
          style={{ color: primary, minWidth: 30 }}
        >
          {progress}%
        </span>
      </div>
      {/* Log line */}
      {logLine && (
        <p
          className="text-xs truncate pl-4"
          style={{ color: muted, maxWidth: 340 }}
          title={logLine}
        >
          {logLine}
        </p>
      )}
    </div>
  );
}

// ─── Beat status badge ────────────────────────────────────────────────────────

function BeatStatusBadge({
  masterAsset,
  isAnalyzed,
  beatsStale,
  beats,
}: {
  masterAsset: Asset | null;
  isAnalyzed: boolean;
  beatsStale: boolean;
  beats: BeatsData | null | undefined;
}) {
  if (!masterAsset) return null;

  if (beatsStale || !isAnalyzed) {
    return (
      <span
        className="text-xs px-2 py-0.5 rounded-full"
        style={{ background: 'rgba(255,69,96,0.12)', color: '#ff7090', border: '1px solid rgba(255,69,96,0.2)' }}
      >
        {beatsStale ? '⚠ Stale' : 'Not analyzed'}
      </span>
    );
  }

  return (
    <span
      className="text-xs px-2 py-0.5 rounded-full flex items-center gap-1"
      style={{ background: 'rgba(0,212,160,0.1)', color: '#00d4a0', border: '1px solid rgba(0,212,160,0.2)' }}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current inline-block" />
      {beats ? `${Math.round(beats.tempo)} BPM · ${beats.beats.length} beats` : 'Analyzed'}
    </span>
  );
}
