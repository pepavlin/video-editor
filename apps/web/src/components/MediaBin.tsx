'use client';

import { useRef, useState, useEffect } from 'react';
import type { Asset } from '@video-editor/shared';
import * as api from '@/lib/api';
import { formatTime } from '@/lib/utils';

interface Props {
  assets: Asset[];
  onAssetsChange: () => void;
  onDragAsset?: (assetId: string) => void;
  /** Called on mobile when user taps the "+" button to add an asset to the timeline. */
  onAddToTimeline?: (assetId: string, assetType: string, duration: number) => void;
}

export default function MediaBin({ assets, onAssetsChange, onDragAsset, onAddToTimeline }: Props) {
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<Record<string, number>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mediaFiles, setMediaFiles] = useState<Array<{ name: string; size: number }> | null>(null);
  const [showBrowser, setShowBrowser] = useState(false);

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
        borderBottom: '1px solid rgba(15,23,42,0.08)',
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
        {mediaFiles !== null && (
          <button
            className="btn btn-ghost"
            style={{
              fontSize: 12,
              padding: '5px 10px',
              background: 'rgba(15,23,42,0.04)',
              border: '1px solid rgba(15,23,42,0.10)',
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
        <div className="border-b fade-up" style={{ borderColor: 'rgba(15,23,42,0.08)', background: 'rgba(15,23,42,0.02)', flexShrink: 0 }}>
          <div style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13, color: 'rgba(15,23,42,0.55)', fontWeight: 500 }}>Local files</span>
            <button
              style={{ fontSize: 14, color: 'rgba(15,23,42,0.30)', background: 'none', border: 'none', cursor: 'pointer', lineHeight: 1 }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'rgba(15,23,42,0.65)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'rgba(15,23,42,0.30)'; }}
              onClick={() => setShowBrowser(false)}
            >✕</button>
          </div>
          {mediaFiles.length === 0 ? (
            <p style={{ padding: '0 16px 14px', fontSize: 13, color: 'rgba(15,23,42,0.45)' }}>
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
                    color: '#0f172a',
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
                  <span style={{ marginLeft: 6, color: 'rgba(15,23,42,0.30)', fontSize: 12 }}>
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
            color: 'rgba(15,23,42,0.30)',
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
          <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {/* Importing items */}
            {Object.entries(importProgress).map(([assetId, progress]) => (
              <div key={assetId} className="fade-up" style={{
                borderRadius: 12,
                padding: '10px 12px',
                background: 'rgba(13,148,136,0.05)',
                border: '1px solid rgba(13,148,136,0.12)',
                boxShadow: 'none',
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
                <div style={{ position: 'relative', height: 4, borderRadius: 4, overflow: 'hidden', background: 'rgba(15,23,42,0.08)' }}>
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
                onDragStart={handleAssetDragStart}
                onAddToTimeline={onAddToTimeline}
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
  onDragStart,
  onAddToTimeline,
}: {
  asset: Asset;
  index?: number;
  onDragStart: (e: React.DragEvent, asset: Asset) => void;
  onAddToTimeline?: (assetId: string, assetType: string, duration: number) => void;
}) {
  const isVideo = asset.type === 'video';
  const isReady = !!asset.waveformPath;
  const [added, setAdded] = useState(false);

  const handleAddToTimeline = () => {
    if (!isReady || !onAddToTimeline) return;
    onAddToTimeline(asset.id, asset.type, asset.duration);
    setAdded(true);
    setTimeout(() => setAdded(false), 1500);
  };

  return (
    <div
      draggable={isReady && !onAddToTimeline}
      onDragStart={(e) => onDragStart(e, asset)}
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
        el.style.background = 'rgba(15,23,42,0.03)';
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
        background: 'rgba(15,23,42,0.05)',
        border: '1px solid rgba(15,23,42,0.08)',
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
          color: '#0f172a',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          marginBottom: 3,
        }}>{asset.name}</div>
        <div style={{ fontSize: 12, color: 'rgba(15,23,42,0.40)' }}>
          {formatTime(asset.duration)}
          {!isReady && ' · processing...'}
        </div>
      </div>

      {/* Resolution (hidden on mobile to save space) */}
      {isVideo && asset.width && !onAddToTimeline && (
        <span style={{ fontSize: 11, flexShrink: 0, color: 'rgba(15,23,42,0.30)' }}>
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
