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
  isMobile?: boolean;
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
  isMobile = false,
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
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: isMobile ? 8 : 12,
        padding: isMobile ? '0 12px' : '0 20px',
        flexShrink: 0,
        borderBottom: '1px solid rgba(0,212,160,0.14)',
        userSelect: 'none',
        overflowX: 'auto',
        minHeight: isMobile ? 44 : 48,
        background: 'rgba(7,16,30,0.90)',
        backdropFilter: 'blur(16px)',
        // Hide scrollbar but allow scroll on mobile
        scrollbarWidth: 'none',
      }}
    >
      {/* Master audio */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(0,212,160,0.65)" strokeWidth="2">
          <path d="M9 18V5l12-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="16" r="3" />
        </svg>
        {!isMobile && <span style={{ fontSize: 12, color: 'rgba(0,212,160,0.55)', fontWeight: 500 }}>Master</span>}
        {masterAsset ? (
          <span style={{ fontSize: 12, fontWeight: 500, color: '#9ac8c0', maxWidth: isMobile ? 90 : 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {masterAsset.name}
          </span>
        ) : (
          <span style={{ fontSize: 12, fontStyle: 'italic', color: 'rgba(0,212,160,0.28)' }}>
            {isMobile ? 'no audio' : 'no audio track'}
          </span>
        )}
      </div>

      <div style={{ width: 1, height: 16, background: 'rgba(0,212,160,0.18)', flexShrink: 0 }} />

      {/* Beat status / progress / analyze button */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        {isAnalyzing ? (
          <JobProgressBlock
            label={isMobile ? 'Beats' : 'Analyzing beats'}
            progress={beatsProgress!}
            logLine={isMobile ? null : beatsLogLine}
            color="teal"
            compact={isMobile}
          />
        ) : (
          <>
            {!isMobile && (
              <BeatStatusBadge
                masterAsset={masterAsset}
                isAnalyzed={isAnalyzed}
                beatsStale={beatsStale}
                beats={beats}
              />
            )}
            {masterAsset && (
              <button
                style={{
                  fontSize: isMobile ? 11 : 12,
                  padding: isMobile ? '4px 8px' : '5px 12px',
                  borderRadius: 8,
                  flexShrink: 0,
                  cursor: 'pointer',
                  fontWeight: needsAnalysis ? 600 : 400,
                  background: needsAnalysis
                    ? 'linear-gradient(135deg, #00d4a0, #38bdf8)'
                    : 'rgba(0,212,160,0.10)',
                  border: needsAnalysis
                    ? '1px solid rgba(0,212,160,0.40)'
                    : '1px solid rgba(0,212,160,0.15)',
                  color: needsAnalysis ? '#040a08' : 'rgba(0,212,160,0.70)',
                  boxShadow: needsAnalysis ? '0 0 12px rgba(0,212,160,0.28)' : 'none',
                  transition: 'all 0.15s ease',
                  whiteSpace: 'nowrap',
                }}
                onClick={handleAnalyze}
                disabled={!masterAsset}
              >
                {isMobile
                  ? (needsAnalysis ? '⚡ Beats' : '↺')
                  : (needsAnalysis ? '⚡ Analyze Beats' : '↺ Re-analyze')}
              </button>
            )}
          </>
        )}
      </div>

      <div style={{ flex: 1 }} />

      {/* Export area: progress → download → button */}
      {isExporting ? (
        <JobProgressBlock
          label={isMobile ? 'Export' : 'Exporting MP4'}
          progress={exportProgress!}
          logLine={isMobile ? null : exportLogLine}
          color="amber"
          compact={isMobile}
        />
      ) : exportDone ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {!isMobile && <span style={{ fontSize: 13, color: 'rgba(0,212,160,0.60)' }}>Export done</span>}
          <button
            style={{
              fontSize: isMobile ? 12 : 13,
              padding: isMobile ? '5px 10px' : '6px 14px',
              borderRadius: 8,
              flexShrink: 0,
              cursor: 'pointer',
              background: 'linear-gradient(135deg, #00d4a0, #22c55e)',
              border: '1px solid rgba(0,212,160,0.45)',
              color: '#03180e',
              fontWeight: 700,
              boxShadow: '0 0 16px rgba(0,212,160,0.45)',
              whiteSpace: 'nowrap',
            }}
            onClick={onDownload}
          >
            ⬇ {isMobile ? 'Download' : 'Download MP4'}
          </button>
        </div>
      ) : (
        <button
          style={{
            fontSize: isMobile ? 12 : 13,
            padding: isMobile ? '5px 10px' : '6px 14px',
            borderRadius: 8,
            flexShrink: 0,
            cursor: 'pointer',
            background: 'linear-gradient(135deg, rgba(240,177,0,0.88), rgba(255,160,30,0.88))',
            border: '1px solid rgba(240,177,0,0.35)',
            color: '#0a0800',
            fontWeight: 600,
            boxShadow: '0 0 12px rgba(240,177,0,0.22)',
            whiteSpace: 'nowrap',
          }}
          onClick={onExport}
        >
          ⬇ {isMobile ? 'Export' : 'Export MP4'}
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
  compact = false,
}: {
  label: string;
  progress: number;
  logLine: string | null;
  color: 'teal' | 'amber';
  compact?: boolean;
}) {
  const isTeal = color === 'teal';
  const gradient = isTeal
    ? 'linear-gradient(90deg, #00d4a0, #38bdf8)'
    : 'linear-gradient(90deg, rgba(240,177,0,0.95), rgba(255,160,30,0.95))';
  const glow = isTeal ? 'rgba(0,212,160,0.45)' : 'rgba(240,177,0,0.45)';
  const primary = isTeal ? '#5ee8c8' : '#f0c040';
  const muted = isTeal ? 'rgba(94,232,200,0.50)' : 'rgba(240,192,64,0.50)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4, minWidth: compact ? 120 : 260 }}>
      {/* Top row: label · bar · % */}
      <div style={{ display: 'flex', alignItems: 'center', gap: compact ? 5 : 8 }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, background: primary, display: 'inline-block', animation: 'pulse 1.5s infinite' }} />
        <span style={{ fontSize: compact ? 11 : 13, flexShrink: 0, fontWeight: 500, color: primary }}>
          {label}
        </span>
        <div style={{ position: 'relative', height: 4, borderRadius: 4, flex: 1, background: 'rgba(255,255,255,0.08)', minWidth: compact ? 40 : 80 }}>
          <div
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: 0,
              width: `${Math.max(2, progress)}%`,
              background: gradient,
              borderRadius: 4,
              boxShadow: `0 0 6px ${glow}`,
              transition: 'width 0.3s ease',
            }}
          />
        </div>
        <span style={{ fontSize: compact ? 11 : 13, fontVariantNumeric: 'tabular-nums', flexShrink: 0, fontWeight: 600, color: primary, minWidth: compact ? 28 : 34 }}>
          {progress}%
        </span>
      </div>
      {/* Log line */}
      {logLine && !compact && (
        <p
          style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingLeft: 16, color: muted, maxWidth: 360 }}
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
      <span style={{
        fontSize: 12,
        padding: '3px 10px',
        borderRadius: 20,
        background: 'rgba(255,69,96,0.12)',
        color: '#ff7090',
        border: '1px solid rgba(255,69,96,0.20)',
      }}>
        {beatsStale ? '⚠ Stale' : 'Not analyzed'}
      </span>
    );
  }

  return (
    <span style={{
      fontSize: 12,
      padding: '3px 10px',
      borderRadius: 20,
      display: 'flex',
      alignItems: 'center',
      gap: 5,
      background: 'rgba(0,212,160,0.10)',
      color: '#00d4a0',
      border: '1px solid rgba(0,212,160,0.20)',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', display: 'inline-block' }} />
      {beats ? `${Math.round(beats.tempo)} BPM · ${beats.beats.length} beats` : 'Analyzed'}
    </span>
  );
}
