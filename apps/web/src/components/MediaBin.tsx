'use client';

import { useRef, useState, useEffect } from 'react';
import type { Asset } from '@video-editor/shared';
import * as api from '@/lib/api';
import { formatTime } from '@/lib/utils';

type ViewMode = 'list' | 'grid' | 'masonry';

type AssetJobEntry = { jobId: string; status: string; progress: number; logLines: string[] };

interface Props {
  assets: Asset[];
  onAssetsChange: () => void;
  onDragAsset?: (assetId: string) => void;
  assetJobs?: Record<string, { cutout?: AssetJobEntry; headStab?: AssetJobEntry }>;
  /** Called on mobile when user taps the "+" button to add an asset to the timeline. */
  onAddToTimeline?: (assetId: string, assetType: string, duration: number) => void;
}

// Icons for view toggle buttons
function ListIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

function MasonryIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="3" y="3" width="7" height="11" rx="1" />
      <rect x="14" y="3" width="7" height="6" rx="1" />
      <rect x="3" y="17" width="7" height="4" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
    </svg>
  );
}

export default function MediaBin({ assets, onAssetsChange, onDragAsset, assetJobs, onAddToTimeline }: Props) {
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<Record<string, number>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mediaFiles, setMediaFiles] = useState<Array<{ name: string; size: number }> | null>(null);
  const [showBrowser, setShowBrowser] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('list');

  useEffect(() => {
    const stored = localStorage.getItem('media-view-mode') as ViewMode | null;
    if (stored === 'list' || stored === 'grid' || stored === 'masonry') {
      setViewMode(stored);
    }
  }, []);

  const handleSetViewMode = (mode: ViewMode) => {
    setViewMode(mode);
    localStorage.setItem('media-view-mode', mode);
  };

  useEffect(() => {
    api.listMediaFiles()
      .then(({ files }) => setMediaFiles(files))
      .catch(() => setMediaFiles(null)); // null = feature not available
  }, []);

  const handleImport = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setImporting(true);

    for (const file of Array.from(files)) {
      try {
        const { jobId, assetId } = await api.importAsset(file);
        setImportProgress((p) => ({ ...p, [assetId]: 0 }));

        api.pollJob(
          jobId,
          (job) => setImportProgress((p) => ({ ...p, [assetId]: job.progress })),
          800
        ).then(() => {
          setImportProgress((p) => {
            const next = { ...p };
            delete next[assetId];
            return next;
          });
          onAssetsChange();
        }).catch((e) => {
          console.error('Import failed', e);
          setImportProgress((p) => {
            const next = { ...p };
            delete next[assetId];
            return next;
          });
        });
      } catch (e) {
        console.error('Import error', e);
      }
    }
    setImporting(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    handleImport(e.dataTransfer.files);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleAssetDragStart = (e: React.DragEvent, asset: Asset) => {
    e.dataTransfer.setData('assetId', asset.id);
    e.dataTransfer.setData('assetDuration', String(asset.duration));
    e.dataTransfer.setData('assetType', asset.type);
    e.dataTransfer.effectAllowed = 'copy';
    onDragAsset?.(asset.id);
  };

  const handleLinkFile = async (filename: string) => {
    setShowBrowser(false);
    try {
      const { jobId, assetId } = await api.linkAsset(filename);
      setImportProgress((p) => ({ ...p, [assetId]: 0 }));
      api.pollJob(
        jobId,
        (job) => setImportProgress((p) => ({ ...p, [assetId]: job.progress })),
        800
      ).then(() => {
        setImportProgress((p) => { const n = { ...p }; delete n[assetId]; return n; });
        onAssetsChange();
        // Refresh media file list in case file was already there
        api.listMediaFiles().then(({ files }) => setMediaFiles(files)).catch(() => {});
      }).catch((e) => {
        console.error('Link failed', e);
        setImportProgress((p) => { const n = { ...p }; delete n[assetId]; return n; });
      });
    } catch (e) {
      console.error('Link error', e);
    }
  };

  // Container style based on view mode
  const assetsContainerStyle: React.CSSProperties = viewMode === 'list'
    ? { padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6 }
    : viewMode === 'grid'
    ? { padding: '8px 10px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(108px, 1fr))', gap: 8 }
    : {
        padding: '8px 10px',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(108px, 1fr))',
        gridAutoRows: '80px',
        gap: 8,
        gridAutoFlow: 'row dense',
      };

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '14px 16px',
        gap: 8,
        borderBottom: '1px solid var(--border-subtle)',
        flexShrink: 0,
      }}>
        <span style={{
          fontSize: 11,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.10em',
          color: 'rgba(13,148,136,0.80)',
          flex: 1,
        }}>Media</span>

        {/* View mode toggle */}
        <div style={{
          display: 'flex',
          gap: 2,
          background: 'var(--surface-overlay)',
          borderRadius: 8,
          padding: 2,
          border: '1px solid var(--border-subtle)',
        }}>
          {(['list', 'grid', 'masonry'] as ViewMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => handleSetViewMode(mode)}
              title={mode === 'list' ? 'List view' : mode === 'grid' ? 'Grid view' : 'Masonry view'}
              style={{
                width: 26,
                height: 24,
                borderRadius: 6,
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.15s ease',
                background: viewMode === mode ? 'var(--surface-raised)' : 'transparent',
                color: viewMode === mode ? '#0d9488' : 'var(--text-muted)',
                boxShadow: viewMode === mode ? '0 1px 3px rgba(15,23,42,0.10)' : 'none',
              }}
            >
              {mode === 'list' ? <ListIcon /> : mode === 'grid' ? <GridIcon /> : <MasonryIcon />}
            </button>
          ))}
        </div>

        {mediaFiles !== null && (
          <button
            className="btn btn-ghost"
            style={{
              fontSize: 12,
              padding: '5px 10px',
              background: 'var(--surface-hover)',
              border: '1px solid var(--border-default)',
            }}
            onClick={() => setShowBrowser((v) => !v)}
            title="Browse files from the mounted local media directory"
          >
            Local
          </button>
        )}
        <button
          className="btn btn-primary"
          style={{ fontSize: 12, padding: '6px 12px' }}
          onClick={() => fileInputRef.current?.click()}
          disabled={importing}
        >
          + Import
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="video/*,audio/*,.mp4,.mov,.mp3,.wav,.m4a"
          style={{ display: 'none' }}
          onChange={(e) => handleImport(e.target.files)}
        />
      </div>

      {/* Local media browser panel */}
      {showBrowser && mediaFiles !== null && (
        <div className="border-b fade-up" style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-overlay)', flexShrink: 0 }}>
          <div style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500 }}>Local files</span>
            <button
              style={{ fontSize: 14, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', lineHeight: 1 }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'; }}
              onClick={() => setShowBrowser(false)}
            >✕</button>
          </div>
          {mediaFiles.length === 0 ? (
            <p style={{ padding: '0 16px 14px', fontSize: 13, color: 'var(--text-muted)' }}>
              No files found. Put media files in the mounted directory or set{' '}
              <code style={{ fontSize: 12, color: '#0d9488' }}>LOCAL_MEDIA_DIR</code>{' '}
              in your{' '}
              <code style={{ fontSize: 12, color: '#0d9488' }}>.env</code>.
            </p>
          ) : (
            <div style={{ maxHeight: 200, overflowY: 'auto' }}>
              {mediaFiles.map((f) => (
                <button
                  key={f.name}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '8px 16px',
                    fontSize: 13,
                    color: 'var(--text-primary)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    display: 'block',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(13,148,136,0.06)'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = ''; }}
                  onClick={() => handleLinkFile(f.name)}
                  title={f.name}
                >
                  {f.name}
                  <span style={{ marginLeft: 6, color: 'var(--text-muted)', fontSize: 12 }}>
                    ({(f.size / 1024 / 1024).toFixed(1)} MB)
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Drop zone hint + assets list */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {assets.length === 0 && Object.keys(importProgress).length === 0 ? (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            gap: 12,
            padding: 24,
            color: 'var(--text-muted)',
          }}>
            <div className="animate-float" style={{ color: 'rgba(13,148,136,0.40)' }}>
              <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </div>
            <p style={{ fontSize: 13, textAlign: 'center', lineHeight: 1.6 }}>
              Drop videos or audio here<br />or click Import
            </p>
          </div>
        ) : (
          <div style={assetsContainerStyle}>
            {/* Importing items — always rendered as list rows */}
            {Object.entries(importProgress).map(([assetId, progress]) => (
              <div key={assetId} className="fade-up" style={{
                borderRadius: 12,
                padding: '10px 12px',
                background: 'rgba(13,148,136,0.05)',
                border: '1px solid rgba(13,148,136,0.12)',
                boxShadow: 'none',
                ...(viewMode !== 'list' ? { gridColumn: '1 / -1' } : {}),
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'rgba(13,148,136,0.85)', fontSize: 13 }}>
                    <span style={{
                      width: 7, height: 7, borderRadius: '50%', background: '#0d9488',
                      display: 'inline-block',
                      animation: 'dotBlink 1.2s ease-in-out infinite',
                    }} />
                    Importing...
                  </span>
                  <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: '#0d9488', fontSize: 13 }}>{progress}%</span>
                </div>
                <div style={{ position: 'relative', height: 4, borderRadius: 4, overflow: 'hidden', background: 'var(--progress-track)' }}>
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      right: `${100 - Math.max(3, progress)}%`,
                      background: 'linear-gradient(90deg, #0d9488, #0ea5e9)',
                      boxShadow: 'none',
                      borderRadius: 4,
                      transition: 'right 0.35s cubic-bezier(0.4,0,0.2,1)',
                    }}
                  />
                  <div className="progress-shimmer" />
                </div>
              </div>
            ))}

            {/* Assets */}
            {assets.map((asset, idx) => (
              <AssetItem
                key={asset.id}
                asset={asset}
                index={idx}
                viewMode={viewMode}
                onDragStart={handleAssetDragStart}
                onAddToTimeline={onAddToTimeline}
                cutoutJob={assetJobs?.[asset.id]?.cutout}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AssetItem({
  asset,
  index = 0,
  viewMode,
  onDragStart,
  onAddToTimeline,
  cutoutJob,
}: {
  asset: Asset;
  index?: number;
  viewMode: ViewMode;
  onDragStart: (e: React.DragEvent, asset: Asset) => void;
  onAddToTimeline?: (assetId: string, assetType: string, duration: number) => void;
  cutoutJob?: AssetJobEntry;
}) {
  const isVideo = asset.type === 'video';
  const isReady = !!asset.waveformPath;
  const [added, setAdded] = useState(false);

  const isCutoutRunning = cutoutJob?.status === 'RUNNING' || cutoutJob?.status === 'QUEUED';
  const isCutoutDone = !!asset.maskPath;
  const isCutoutError = cutoutJob?.status === 'ERROR';

  const handleAddToTimeline = () => {
    if (!isReady || !onAddToTimeline) return;
    onAddToTimeline(asset.id, asset.type, asset.duration);
    setAdded(true);
    setTimeout(() => setAdded(false), 1500);
  };

  const dragProps = {
    draggable: isReady && !onAddToTimeline,
    onDragStart: (e: React.DragEvent) => onDragStart(e, asset),
  };

  const baseHoverHandlers = {
    onMouseEnter: (e: React.MouseEvent) => {
      if (!isReady || onAddToTimeline) return;
      const el = e.currentTarget as HTMLElement;
      el.style.borderColor = 'rgba(13,148,136,0.25)';
      el.style.boxShadow = '0 2px 8px rgba(15,23,42,0.08)';
    },
    onMouseLeave: (e: React.MouseEvent) => {
      if (onAddToTimeline) return;
      const el = e.currentTarget as HTMLElement;
      el.style.borderColor = 'var(--border-subtle)';
      el.style.boxShadow = 'none';
    },
  };

  // ── LIST VIEW ──────────────────────────────────────────────────────────────
  if (viewMode === 'list') {
    return (
      <div
        {...dragProps}
        className="stagger-item"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          borderRadius: 12,
          padding: '10px 10px',
          border: '1px solid transparent',
          opacity: isReady ? 1 : 0.55,
          cursor: onAddToTimeline ? 'default' : (isReady ? 'grab' : 'wait'),
          transition: 'all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)',
          animationDelay: `${index * 0.05}s`,
        }}
        onMouseEnter={(e) => {
          if (!isReady || onAddToTimeline) return;
          const el = e.currentTarget as HTMLElement;
          el.style.background = 'var(--surface-overlay)';
          el.style.borderColor = 'rgba(13,148,136,0.18)';
          el.style.transform = 'translateX(2px) translateY(-1px)';
          el.style.boxShadow = '0 2px 8px rgba(15,23,42,0.06)';
        }}
        onMouseLeave={(e) => {
          if (onAddToTimeline) return;
          const el = e.currentTarget as HTMLElement;
          el.style.background = '';
          el.style.borderColor = 'transparent';
          el.style.transform = '';
          el.style.boxShadow = '';
        }}
        onMouseDown={(e) => {
          if (!isReady) return;
          (e.currentTarget as HTMLElement).style.transform = 'scale(0.97)';
        }}
        onMouseUp={(e) => {
          if (!isReady) return;
          (e.currentTarget as HTMLElement).style.transform = 'translateX(2px) translateY(-1px)';
        }}
        title={asset.name}
      >
        {/* Thumbnail */}
        <div style={{
          width: 52,
          height: 40,
          borderRadius: 8,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          overflow: 'hidden',
          background: 'var(--surface-overlay)',
          border: '1px solid var(--border-subtle)',
        }}>
          {isVideo ? (
            asset.proxyPath ? (
              <video
                src={`/files/${asset.proxyPath}#t=0.5`}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                muted
                preload="metadata"
              />
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="1.8">
                <polygon points="23 7 16 12 23 17 23 7" />
                <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
              </svg>
            )
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="1.8">
              <path d="M9 18V5l12-2v13" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="18" cy="16" r="3" />
            </svg>
          )}
        </div>

        {/* Info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 13,
            fontWeight: 500,
            color: 'var(--text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            marginBottom: 3,
          }}>{asset.name}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {formatTime(asset.duration)}
            {!isReady && ' · processing...'}
          </div>
          {/* Cutout status badge */}
          {isVideo && (isCutoutRunning || isCutoutDone || isCutoutError) && (
            <div style={{ marginTop: 4 }}>
              {isCutoutRunning && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontSize: 10, color: '#fbbf24' }}>Cutout: {cutoutJob!.progress > 0 ? `${cutoutJob!.progress}%` : '…'}</span>
                  <div style={{ flex: 1, height: 3, borderRadius: 2, background: 'rgba(251,191,36,0.18)', overflow: 'hidden', maxWidth: 60 }}>
                    {cutoutJob!.progress > 0 ? (
                      <div style={{ height: '100%', borderRadius: 2, background: '#fbbf24', width: `${cutoutJob!.progress}%`, transition: 'width 0.35s ease' }} />
                    ) : (
                      <div style={{ height: '100%', width: '40%', borderRadius: 2, background: '#fbbf24', animation: 'progressIndeterminate 1.4s ease-in-out infinite' }} />
                    )}
                  </div>
                </div>
              )}
              {isCutoutDone && !isCutoutRunning && (
                <span style={{ fontSize: 10, color: '#4ade80' }}>✓ Cutout ready</span>
              )}
              {isCutoutError && !isCutoutRunning && (
                <span style={{ fontSize: 10, color: '#f87171' }}>Cutout error</span>
              )}
            </div>
          )}
        </div>

        {/* Resolution (hidden on mobile to save space) */}
        {isVideo && asset.width && !onAddToTimeline && (
          <span style={{ fontSize: 11, flexShrink: 0, color: 'var(--text-subtle)' }}>
            {asset.width}×{asset.height}
          </span>
        )}

        {/* Mobile: Add to timeline button */}
        {onAddToTimeline && isReady && (
          <button
            onClick={handleAddToTimeline}
            style={{
              flexShrink: 0,
              width: 36,
              height: 36,
              borderRadius: 10,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: added
                ? 'rgba(13,148,136,0.12)'
                : 'rgba(13,148,136,0.07)',
              border: `1px solid ${added ? 'rgba(13,148,136,0.40)' : 'rgba(13,148,136,0.20)'}`,
              color: added ? '#0d9488' : 'rgba(13,148,136,0.70)',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              fontSize: 18,
              lineHeight: 1,
            }}
            title="Add to timeline"
          >
            {added ? '✓' : '+'}
          </button>
        )}
      </div>
    );
  }

  // ── GRID VIEW ──────────────────────────────────────────────────────────────
  if (viewMode === 'grid') {
    return (
      <div
        {...dragProps}
        className="stagger-item"
        {...baseHoverHandlers}
        style={{
          display: 'flex',
          flexDirection: 'column',
          borderRadius: 10,
          overflow: 'hidden',
          border: '1px solid var(--border-subtle)',
          background: 'var(--surface-raised)',
          opacity: isReady ? 1 : 0.55,
          cursor: onAddToTimeline ? 'default' : (isReady ? 'grab' : 'wait'),
          transition: 'all 0.15s ease',
          animationDelay: `${index * 0.05}s`,
        }}
        title={asset.name}
      >
        {/* Thumbnail area */}
        <div style={{
          width: '100%',
          aspectRatio: '4/3',
          background: 'var(--surface-overlay)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          position: 'relative',
        }}>
          {isVideo ? (
            asset.proxyPath ? (
              <video
                src={`/files/${asset.proxyPath}#t=0.5`}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                muted
                preload="metadata"
              />
            ) : (
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5">
                <polygon points="23 7 16 12 23 17 23 7" />
                <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
              </svg>
            )
          ) : (
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5">
              <path d="M9 18V5l12-2v13" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="18" cy="16" r="3" />
            </svg>
          )}
          {/* Mobile add button overlay */}
          {onAddToTimeline && isReady && (
            <button
              onClick={handleAddToTimeline}
              style={{
                position: 'absolute',
                top: 4,
                right: 4,
                width: 28,
                height: 28,
                borderRadius: 8,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: added ? 'rgba(13,148,136,0.85)' : 'rgba(0,0,0,0.50)',
                border: 'none',
                color: '#fff',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                fontSize: 16,
                lineHeight: 1,
              }}
              title="Add to timeline"
            >
              {added ? '✓' : '+'}
            </button>
          )}
        </div>

        {/* Info */}
        <div style={{ padding: '6px 8px', minWidth: 0 }}>
          <div style={{
            fontSize: 11,
            fontWeight: 500,
            color: 'var(--text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            marginBottom: 2,
          }}>{asset.name}</div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
            {formatTime(asset.duration)}
            {!isReady && ' · processing...'}
          </div>
        </div>
      </div>
    );
  }

  // ── MASONRY VIEW ───────────────────────────────────────────────────────────
  // Videos span 2 rows (taller), audio spans 1 row
  const rowSpan = isVideo ? 2 : 1;

  return (
    <div
      {...dragProps}
      className="stagger-item"
      {...baseHoverHandlers}
      style={{
        gridRow: `span ${rowSpan}`,
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 10,
        overflow: 'hidden',
        border: '1px solid var(--border-subtle)',
        background: 'var(--surface-raised)',
        opacity: isReady ? 1 : 0.55,
        cursor: onAddToTimeline ? 'default' : (isReady ? 'grab' : 'wait'),
        transition: 'all 0.15s ease',
        animationDelay: `${index * 0.05}s`,
      }}
      title={asset.name}
    >
      {isVideo ? (
        <>
          {/* Tall thumbnail for video */}
          <div style={{
            flex: 1,
            background: 'var(--surface-overlay)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            position: 'relative',
          }}>
            {asset.proxyPath ? (
              <video
                src={`/files/${asset.proxyPath}#t=0.5`}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                muted
                preload="metadata"
              />
            ) : (
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5">
                <polygon points="23 7 16 12 23 17 23 7" />
                <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
              </svg>
            )}
            {onAddToTimeline && isReady && (
              <button
                onClick={handleAddToTimeline}
                style={{
                  position: 'absolute',
                  top: 4,
                  right: 4,
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: added ? 'rgba(13,148,136,0.85)' : 'rgba(0,0,0,0.50)',
                  border: 'none',
                  color: '#fff',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  fontSize: 16,
                  lineHeight: 1,
                }}
                title="Add to timeline"
              >
                {added ? '✓' : '+'}
              </button>
            )}
          </div>
          <div style={{ padding: '6px 8px', flexShrink: 0 }}>
            <div style={{
              fontSize: 11,
              fontWeight: 500,
              color: 'var(--text-primary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              marginBottom: 2,
            }}>{asset.name}</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', display: 'flex', gap: 4 }}>
              <span>{formatTime(asset.duration)}</span>
              {asset.width && <span style={{ color: 'var(--text-subtle)' }}>{asset.width}×{asset.height}</span>}
              {!isReady && <span>· processing...</span>}
            </div>
          </div>
        </>
      ) : (
        /* Compact audio tile */
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 4,
          padding: '8px 6px',
        }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(13,148,136,0.55)" strokeWidth="1.6">
            <path d="M9 18V5l12-2v13" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="16" r="3" />
          </svg>
          <div style={{
            fontSize: 10,
            fontWeight: 500,
            color: 'var(--text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            width: '100%',
            textAlign: 'center',
          }}>{asset.name}</div>
          <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>
            {formatTime(asset.duration)}
            {!isReady && ' · …'}
          </div>
          {onAddToTimeline && isReady && (
            <button
              onClick={handleAddToTimeline}
              style={{
                width: 24,
                height: 24,
                borderRadius: 6,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: added ? 'rgba(13,148,136,0.15)' : 'rgba(13,148,136,0.08)',
                border: `1px solid ${added ? 'rgba(13,148,136,0.40)' : 'rgba(13,148,136,0.20)'}`,
                color: added ? '#0d9488' : 'rgba(13,148,136,0.70)',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                fontSize: 14,
                lineHeight: 1,
              }}
              title="Add to timeline"
            >
              {added ? '✓' : '+'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
