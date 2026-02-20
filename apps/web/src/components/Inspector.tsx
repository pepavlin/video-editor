'use client';

import { useState } from 'react';
import type {
  Project,
  Clip,
  Asset,
  BeatZoomEffect,
  CutoutEffect,
  LyricsStyle,
} from '@video-editor/shared';
import * as api from '@/lib/api';
import { formatTime } from '@/lib/utils';

interface Props {
  project: Project | null;
  selectedClipId: string | null;
  assets: Asset[];
  onClipUpdate: (clipId: string, updates: Partial<Clip>) => void;
  onAddEffect: (clipId: string, effect: any) => void;
  onRemoveEffect: (clipId: string, type: string) => void;
  onUpdateEffect: (clipId: string, type: string, updates: any) => void;
  onUpdateProject: (updater: (p: Project) => Project) => void;
  masterAssetId?: string;
  onAnalyzeBeats: (assetId: string) => Promise<void>;
  onAlignLyrics: (text: string) => Promise<void>;
  onStartCutout: (clipId: string) => Promise<void>;
  onExport: () => Promise<void>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border-b border-surface-border">
      <button
        className="flex items-center justify-between w-full px-3 py-2 text-left hover:bg-surface-hover"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{title}</span>
        <span className="text-gray-600">{open ? '▾' : '▸'}</span>
      </button>
      {open && <div className="px-3 pb-3 space-y-2">{children}</div>}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-500 w-16 flex-shrink-0">{label}</span>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function NumInput({
  value,
  onChange,
  min,
  max,
  step = 0.01,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className="text-xs"
    />
  );
}

export default function Inspector({
  project,
  selectedClipId,
  assets,
  onClipUpdate,
  onAddEffect,
  onRemoveEffect,
  onUpdateEffect,
  onUpdateProject,
  masterAssetId,
  onAnalyzeBeats,
  onAlignLyrics,
  onStartCutout,
  onExport,
}: Props) {
  const [lyricsText, setLyricsText] = useState('');
  const [aligningLyrics, setAligningLyrics] = useState(false);
  const [analyzingBeats, setAnalyzingBeats] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportDone, setExportDone] = useState(false);

  // Find selected clip
  let selectedClip: Clip | undefined;
  if (selectedClipId && project) {
    for (const t of project.tracks) {
      selectedClip = t.clips.find((c) => c.id === selectedClipId);
      if (selectedClip) break;
    }
  }

  const selectedAsset = selectedClip
    ? assets.find((a) => a.id === selectedClip!.assetId)
    : undefined;

  const beatZoom = selectedClip?.effects.find((e) => e.type === 'beatZoom') as BeatZoomEffect | undefined;
  const cutout = selectedClip?.effects.find((e) => e.type === 'cutout') as CutoutEffect | undefined;

  const handleAlignLyrics = async () => {
    if (!lyricsText.trim()) return;
    setAligningLyrics(true);
    try {
      await onAlignLyrics(lyricsText);
    } finally {
      setAligningLyrics(false);
    }
  };

  const handleAnalyzeBeats = async () => {
    if (!masterAssetId) return;
    setAnalyzingBeats(true);
    try {
      await onAnalyzeBeats(masterAssetId);
    } finally {
      setAnalyzingBeats(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    setExportDone(false);
    try {
      await onExport();
      setExportDone(true);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto text-sm">
      {/* Clip properties */}
      {selectedClip ? (
        <>
          <Section title="Clip">
            <Row label="Asset">
              <span className="text-xs text-gray-400 truncate block">{selectedAsset?.name ?? selectedClip.assetId}</span>
            </Row>
            <Row label="Start">
              <span className="text-xs text-gray-300">{formatTime(selectedClip.timelineStart)}</span>
            </Row>
            <Row label="End">
              <span className="text-xs text-gray-300">{formatTime(selectedClip.timelineEnd)}</span>
            </Row>
            <Row label="Duration">
              <span className="text-xs text-gray-300">
                {formatTime(selectedClip.timelineEnd - selectedClip.timelineStart)}
              </span>
            </Row>
          </Section>

          <Section title="Transform">
            <Row label="Scale">
              <NumInput
                value={selectedClip.transform.scale}
                min={0.1}
                max={5}
                onChange={(v) =>
                  onClipUpdate(selectedClip!.id, {
                    transform: { ...selectedClip!.transform, scale: v },
                  })
                }
              />
            </Row>
            <Row label="X">
              <NumInput
                value={selectedClip.transform.x}
                step={1}
                onChange={(v) =>
                  onClipUpdate(selectedClip!.id, {
                    transform: { ...selectedClip!.transform, x: v },
                  })
                }
              />
            </Row>
            <Row label="Y">
              <NumInput
                value={selectedClip.transform.y}
                step={1}
                onChange={(v) =>
                  onClipUpdate(selectedClip!.id, {
                    transform: { ...selectedClip!.transform, y: v },
                  })
                }
              />
            </Row>
            <Row label="Opacity">
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={selectedClip.transform.opacity}
                className="w-full"
                onChange={(e) =>
                  onClipUpdate(selectedClip!.id, {
                    transform: { ...selectedClip!.transform, opacity: parseFloat(e.target.value) },
                  })
                }
              />
            </Row>
          </Section>

          <Section title="Audio">
            <Row label="Use audio">
              <input
                type="checkbox"
                checked={selectedClip.useClipAudio}
                onChange={(e) =>
                  onClipUpdate(selectedClip!.id, { useClipAudio: e.target.checked })
                }
              />
            </Row>
            {selectedClip.useClipAudio && (
              <Row label="Volume">
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.05}
                  value={selectedClip.clipAudioVolume}
                  className="w-full"
                  onChange={(e) =>
                    onClipUpdate(selectedClip!.id, {
                      clipAudioVolume: parseFloat(e.target.value),
                    })
                  }
                />
              </Row>
            )}
          </Section>

          <Section title="Effects">
            {/* Beat Zoom */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-300">Beat Zoom</span>
                {beatZoom ? (
                  <button
                    className="text-xs text-red-400 hover:text-red-300"
                    onClick={() => onRemoveEffect(selectedClip!.id, 'beatZoom')}
                  >
                    Remove
                  </button>
                ) : (
                  <button
                    className="text-xs btn btn-ghost border border-surface-border"
                    onClick={() =>
                      onAddEffect(selectedClip!.id, {
                        type: 'beatZoom',
                        enabled: true,
                        intensity: 0.08,
                        durationMs: 120,
                        easing: 'easeOut',
                      } satisfies BeatZoomEffect)
                    }
                  >
                    + Add
                  </button>
                )}
              </div>
              {beatZoom && (
                <div className="space-y-1 pl-2 border-l border-surface-border">
                  <label className="flex items-center gap-2 text-xs text-gray-400">
                    <input
                      type="checkbox"
                      checked={beatZoom.enabled}
                      onChange={(e) => onUpdateEffect(selectedClip!.id, 'beatZoom', { enabled: e.target.checked })}
                    />
                    Enabled
                  </label>
                  <Row label="Intensity">
                    <input
                      type="range"
                      min={0.01}
                      max={0.5}
                      step={0.01}
                      value={beatZoom.intensity}
                      className="w-full"
                      onChange={(e) =>
                        onUpdateEffect(selectedClip!.id, 'beatZoom', {
                          intensity: parseFloat(e.target.value),
                        })
                      }
                    />
                    <span className="text-xs text-gray-500">{(beatZoom.intensity * 100).toFixed(0)}%</span>
                  </Row>
                  <Row label="Duration">
                    <NumInput
                      value={beatZoom.durationMs}
                      min={50}
                      max={500}
                      step={10}
                      onChange={(v) =>
                        onUpdateEffect(selectedClip!.id, 'beatZoom', { durationMs: v })
                      }
                    />
                    <span className="text-xs text-gray-500">ms</span>
                  </Row>
                  <Row label="Easing">
                    <select
                      value={beatZoom.easing}
                      className="text-xs"
                      onChange={(e) =>
                        onUpdateEffect(selectedClip!.id, 'beatZoom', { easing: e.target.value })
                      }
                    >
                      <option value="linear">Linear</option>
                      <option value="easeOut">Ease Out</option>
                      <option value="easeIn">Ease In</option>
                      <option value="easeInOut">Ease In/Out</option>
                    </select>
                  </Row>
                </div>
              )}
            </div>

            {/* Cutout */}
            {selectedAsset?.type === 'video' && (
              <div className="space-y-2 mt-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-300">Cutout Person</span>
                  {cutout ? (
                    <button
                      className="text-xs text-red-400 hover:text-red-300"
                      onClick={() => onRemoveEffect(selectedClip!.id, 'cutout')}
                    >
                      Remove
                    </button>
                  ) : (
                    <button
                      className="text-xs btn btn-ghost border border-surface-border"
                      onClick={async () => {
                        onAddEffect(selectedClip!.id, {
                          type: 'cutout',
                          enabled: true,
                          background: { type: 'solid', color: '#000000' },
                          maskStatus: 'pending',
                        } satisfies CutoutEffect);
                        await onStartCutout(selectedClip!.id);
                      }}
                    >
                      + Add
                    </button>
                  )}
                </div>
                {cutout && (
                  <div className="space-y-1 pl-2 border-l border-surface-border">
                    <div className="text-xs text-gray-500">
                      Mask: {cutout.maskStatus ?? 'unknown'}
                    </div>
                    <Row label="BG Type">
                      <select
                        value={cutout.background.type}
                        className="text-xs"
                        onChange={(e) =>
                          onUpdateEffect(selectedClip!.id, 'cutout', {
                            background: {
                              ...cutout.background,
                              type: e.target.value as 'solid' | 'video',
                            },
                          })
                        }
                      >
                        <option value="solid">Solid Color</option>
                        <option value="video">Video</option>
                      </select>
                    </Row>
                    {cutout.background.type === 'solid' && (
                      <Row label="Color">
                        <input
                          type="color"
                          value={cutout.background.color ?? '#000000'}
                          onChange={(e) =>
                            onUpdateEffect(selectedClip!.id, 'cutout', {
                              background: { ...cutout.background, color: e.target.value },
                            })
                          }
                          className="w-full h-6"
                        />
                      </Row>
                    )}
                  </div>
                )}
              </div>
            )}
          </Section>
        </>
      ) : (
        <div className="p-3 text-xs text-gray-600">Select a clip to inspect</div>
      )}

      {/* Beat Analysis */}
      <Section title="Beat Analysis">
        {masterAssetId ? (
          <button
            className="btn btn-ghost border border-surface-border w-full text-xs"
            onClick={handleAnalyzeBeats}
            disabled={analyzingBeats}
          >
            {analyzingBeats ? 'Analyzing...' : 'Analyze Beats'}
          </button>
        ) : (
          <p className="text-xs text-gray-600">Add a master audio clip first</p>
        )}
      </Section>

      {/* Lyrics */}
      <Section title="Lyrics / Text">
        <textarea
          placeholder="Paste lyrics here..."
          value={lyricsText || project?.lyrics?.text || ''}
          onChange={(e) => setLyricsText(e.target.value)}
          className="w-full h-24 resize-none text-xs"
        />
        <button
          className="btn btn-ghost border border-surface-border w-full text-xs mt-1"
          onClick={handleAlignLyrics}
          disabled={aligningLyrics || !lyricsText.trim()}
        >
          {aligningLyrics ? 'Aligning...' : 'Align Lyrics'}
        </button>
        {project?.lyrics?.words && (
          <div className="mt-2">
            <label className="flex items-center gap-2 text-xs text-gray-400">
              <input
                type="checkbox"
                checked={project.lyrics.enabled ?? false}
                onChange={(e) =>
                  onUpdateProject((p) => ({
                    ...p,
                    lyrics: { ...p.lyrics!, enabled: e.target.checked },
                  }))
                }
              />
              Show lyrics overlay
            </label>
            <p className="text-xs text-gray-600 mt-1">
              {project.lyrics.words.length} words aligned
            </p>
          </div>
        )}
        {project?.lyrics?.words && (
          <div className="space-y-1 mt-2">
            <Row label="Font size">
              <NumInput
                value={project.lyrics.style?.fontSize ?? 48}
                min={12}
                max={120}
                step={2}
                onChange={(v) =>
                  onUpdateProject((p) => ({
                    ...p,
                    lyrics: { ...p.lyrics!, style: { ...(p.lyrics?.style as LyricsStyle), fontSize: v } },
                  }))
                }
              />
            </Row>
            <Row label="Position">
              <select
                value={project.lyrics?.style?.position ?? 'bottom'}
                className="text-xs"
                onChange={(e) =>
                  onUpdateProject((p) => ({
                    ...p,
                    lyrics: {
                      ...p.lyrics!,
                      style: {
                        ...(p.lyrics?.style as LyricsStyle),
                        position: e.target.value as 'top' | 'center' | 'bottom',
                      },
                    },
                  }))
                }
              >
                <option value="top">Top</option>
                <option value="center">Center</option>
                <option value="bottom">Bottom</option>
              </select>
            </Row>
            <Row label="Words/chunk">
              <NumInput
                value={project.lyrics?.style?.wordsPerChunk ?? 3}
                min={1}
                max={8}
                step={1}
                onChange={(v) =>
                  onUpdateProject((p) => ({
                    ...p,
                    lyrics: {
                      ...p.lyrics!,
                      style: { ...(p.lyrics?.style as LyricsStyle), wordsPerChunk: v },
                    },
                  }))
                }
              />
            </Row>
          </div>
        )}
      </Section>

      {/* Export */}
      <Section title="Export">
        <button
          className="btn btn-primary w-full"
          onClick={handleExport}
          disabled={exporting}
        >
          {exporting ? 'Exporting...' : 'Export MP4'}
        </button>
        {exportDone && (
          <p className="text-xs text-green-400 mt-1">Export started! Check jobs panel.</p>
        )}
        <p className="text-xs text-gray-600 mt-1">Output: 1080×1920, H.264</p>
      </Section>
    </div>
  );
}
