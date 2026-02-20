'use client';

import { useRef, useState, useEffect } from 'react';
import type { Asset } from '@video-editor/shared';
import * as api from '@/lib/api';
import { formatTime } from '@/lib/utils';

interface Props {
  assets: Asset[];
  onAssetsChange: () => void;
  onDragAsset?: (assetId: string) => void;
}

export default function MediaBin({ assets, onAssetsChange, onDragAsset }: Props) {
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
    e.dataTransfer.effectAllowed = 'copy';
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
      className="flex flex-col h-full"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-surface-border gap-1">
        <span className="text-xs font-semibold uppercase tracking-wider flex-1" style={{ color: 'rgba(0,212,160,0.75)' }}>Media</span>
        {mediaFiles !== null && (
          <button
            className="btn text-xs py-1 px-2 bg-surface-hover hover:bg-surface-border text-gray-300"
            onClick={() => setShowBrowser((v) => !v)}
            title="Browse files from the mounted local media directory"
          >
            Local
          </button>
        )}
        <button
          className="btn btn-primary text-xs py-1"
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
          className="hidden"
          onChange={(e) => handleImport(e.target.files)}
        />
      </div>

      {/* Local media browser panel */}
      {showBrowser && mediaFiles !== null && (
        <div className="border-b border-surface-border bg-surface-hover">
          <div className="px-3 py-1.5 flex items-center justify-between">
            <span className="text-xs text-gray-400">Local files</span>
            <button className="text-xs text-gray-600 hover:text-gray-400" onClick={() => setShowBrowser(false)}>✕</button>
          </div>
          {mediaFiles.length === 0 ? (
            <p className="px-3 pb-2 text-xs text-gray-600">
              No files found. Put media files in the mounted directory or set <code>LOCAL_MEDIA_DIR</code> in your <code>.env</code>.
            </p>
          ) : (
            <div className="max-h-48 overflow-y-auto">
              {mediaFiles.map((f) => (
                <button
                  key={f.name}
                  className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-surface-border truncate block"
                  onClick={() => handleLinkFile(f.name)}
                  title={f.name}
                >
                  {f.name}
                  <span className="text-gray-600 ml-1">({(f.size / 1024 / 1024).toFixed(1)} MB)</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Drop zone hint + assets list */}
      <div className="flex-1 overflow-y-auto">
        {assets.length === 0 && Object.keys(importProgress).length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-600 text-xs gap-2 p-4">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <p className="text-center">Drop videos/audio here<br />or click Import</p>
          </div>
        ) : (
          <div className="p-2 space-y-1">
            {/* Importing items */}
            {Object.entries(importProgress).map(([assetId, progress]) => (
              <div key={assetId} className="rounded p-2 bg-surface-hover text-xs text-gray-400">
                <div className="flex justify-between mb-1">
                  <span>Importing...</span>
                  <span>{progress}%</span>
                </div>
                <div className="h-1 bg-surface-border rounded">
                  <div
                    className="h-full bg-accent rounded transition-all"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            ))}

            {/* Assets */}
            {assets.map((asset) => (
              <AssetItem
                key={asset.id}
                asset={asset}
                onDragStart={handleAssetDragStart}
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
  onDragStart,
}: {
  asset: Asset;
  onDragStart: (e: React.DragEvent, asset: Asset) => void;
}) {
  const isVideo = asset.type === 'video';
  const isReady = !!asset.waveformPath;

  return (
    <div
      draggable={isReady}
      onDragStart={(e) => onDragStart(e, asset)}
      className={`
        flex items-center gap-2 rounded p-2 cursor-grab active:cursor-grabbing
        transition-colors group
        ${isReady ? 'hover:bg-surface-hover' : 'opacity-60 cursor-wait'}
      `}
      title={asset.name}
    >
      {/* Thumbnail icon */}
      <div className="w-10 h-8 rounded bg-surface-border flex items-center justify-center flex-shrink-0 overflow-hidden">
        {isVideo ? (
          asset.proxyPath ? (
            <video
              src={`/files/${asset.proxyPath}#t=0.5`}
              className="w-full h-full object-cover"
              muted
              preload="metadata"
            />
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2">
              <polygon points="23 7 16 12 23 17 23 7" />
              <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
            </svg>
          )
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2">
            <path d="M9 18V5l12-2v13" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="16" r="3" />
          </svg>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="text-xs text-gray-300 truncate">{asset.name}</div>
        <div className="text-xs text-gray-600">
          {formatTime(asset.duration)}
          {!isReady && ' · processing...'}
        </div>
      </div>

      {/* Resolution */}
      {isVideo && asset.width && (
        <span className="text-xs text-gray-600 flex-shrink-0">
          {asset.width}×{asset.height}
        </span>
      )}
    </div>
  );
}
