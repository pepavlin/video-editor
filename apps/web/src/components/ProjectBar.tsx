'use client';

import { useState, useEffect, useRef } from 'react';
import type { Asset, BeatsData } from '@video-editor/shared';

interface Props {
  masterAsset: Asset | null;
  beatsData: Map<string, BeatsData>;
  onAnalyzeBeats: () => Promise<void>;
  onExport: () => Promise<void>;
}

export default function ProjectBar({ masterAsset, beatsData, onAnalyzeBeats, onExport }: Props) {
  const [analyzingBeats, setAnalyzingBeats] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Detect when master changes so we can flag beats as stale
  const prevMasterIdRef = useRef<string | undefined>(masterAsset?.id);
  const [beatsStale, setBeatsStale] = useState(false);

  useEffect(() => {
    if (masterAsset?.id !== prevMasterIdRef.current) {
      prevMasterIdRef.current = masterAsset?.id;
      // If new master already has beats data (previously analyzed), not stale
      if (masterAsset?.beatsPath) {
        setBeatsStale(false);
      } else {
        setBeatsStale(true);
      }
    }
  }, [masterAsset?.id, masterAsset?.beatsPath]);

  // Reset stale flag if beats are freshly present
  useEffect(() => {
    if (masterAsset?.beatsPath) setBeatsStale(false);
  }, [masterAsset?.beatsPath]);

  const beats = masterAsset ? beatsData.get(masterAsset.id) : null;
  const isAnalyzed = !!masterAsset?.beatsPath;
  const needsAnalysis = !isAnalyzed || beatsStale;

  const handleAnalyze = async () => {
    setAnalyzingBeats(true);
    setBeatsStale(false);
    try {
      await onAnalyzeBeats();
    } finally {
      setAnalyzingBeats(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      await onExport();
    } finally {
      setExporting(false);
    }
  };

  return (
    <div
      className="flex items-center gap-3 px-4 py-1.5 flex-shrink-0 border-b select-none overflow-x-auto"
      style={{
        background: 'rgba(6,11,9,0.65)',
        backdropFilter: 'blur(12px)',
        borderColor: 'rgba(0,212,160,0.08)',
        minHeight: 38,
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

      <div className="w-px h-4 flex-shrink-0" style={{ background: 'rgba(0,212,160,0.12)' }} />

      {/* Beat status + analyze */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {/* Status badge */}
        <BeatStatusBadge
          masterAsset={masterAsset}
          isAnalyzed={isAnalyzed}
          beatsStale={beatsStale}
          beats={beats}
          analyzing={analyzingBeats}
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
            disabled={analyzingBeats || !masterAsset}
          >
            {analyzingBeats ? (
              <span className="flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-full bg-current animate-pulse" />
                Analyzing…
              </span>
            ) : (
              needsAnalysis ? '⚡ Analyze Beats' : '↺ Re-analyze'
            )}
          </button>
        )}
      </div>

      <div className="flex-1" />

      {/* Export */}
      <button
        className="btn text-xs py-0.5 px-3 flex-shrink-0"
        style={{
          background: exporting ? 'rgba(240,177,0,0.15)' : 'linear-gradient(135deg, rgba(240,177,0,0.8), rgba(255,160,30,0.8))',
          border: '1px solid rgba(240,177,0,0.35)',
          color: exporting ? 'rgba(240,177,0,0.6)' : '#0a0800',
          fontWeight: 600,
          boxShadow: exporting ? 'none' : '0 0 10px rgba(240,177,0,0.2)',
        }}
        onClick={handleExport}
        disabled={exporting}
      >
        {exporting ? 'Exporting…' : '⬇ Export MP4'}
      </button>
    </div>
  );
}

function BeatStatusBadge({
  masterAsset,
  isAnalyzed,
  beatsStale,
  beats,
  analyzing,
}: {
  masterAsset: Asset | null;
  isAnalyzed: boolean;
  beatsStale: boolean;
  beats: BeatsData | null | undefined;
  analyzing: boolean;
}) {
  if (!masterAsset) return null;

  if (analyzing) {
    return (
      <span
        className="text-xs px-2 py-0.5 rounded-full flex items-center gap-1"
        style={{ background: 'rgba(56,189,248,0.12)', color: '#38bdf8', border: '1px solid rgba(56,189,248,0.2)' }}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse inline-block" />
        Analyzing
      </span>
    );
  }

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
