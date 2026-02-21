'use client';

import { useState } from 'react';
import type {
  Project,
  Clip,
  Asset,
  BeatZoomEffect,
  CutoutEffect,
  LyricsStyle,
  TextStyle,
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
  onAlignLyrics: (text: string) => Promise<void>;
  onStartCutout: (clipId: string) => Promise<void>;
  onExport: () => Promise<void>;
  onSyncAudio?: (clipId: string) => Promise<void>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
      <button
        className="flex items-center justify-between w-full text-left"
        style={{
          padding: '14px 16px',
          transition: 'background 0.15s ease',
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = ''; }}
        onClick={() => setOpen((o) => !o)}
      >
        <span style={{
          fontSize: 11,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.10em',
          color: 'rgba(0,212,160,0.80)',
        }}>
          {title}
        </span>
        <span style={{
          color: 'rgba(0,212,160,0.40)',
          display: 'inline-block',
          fontSize: 14,
          transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
          transition: 'transform 0.2s cubic-bezier(0.4,0,0.2,1)',
        }}>▾</span>
      </button>
      {/* CSS grid trick for smooth height animation */}
      <div className={`section-body ${open ? 'open' : 'closed'}`}>
        <div className="section-inner">
          <div style={{ padding: '4px 16px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      className="flex items-center gap-3 rounded-lg"
      style={{
        padding: '4px 8px',
        margin: '0 -8px',
        transition: 'background 0.12s ease',
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = ''; }}
    >
      <span style={{
        fontSize: 13,
        color: 'rgba(255,255,255,0.35)',
        width: 80,
        flexShrink: 0,
      }}>{label}</span>
      <div style={{ flex: 1 }}>{children}</div>
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
      style={{ fontSize: 13 }}
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
  onAlignLyrics,
  onStartCutout,
  onExport,
  onSyncAudio,
}: Props) {
  const [lyricsText, setLyricsText] = useState('');
  const [aligningLyrics, setAligningLyrics] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportDone, setExportDone] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // Find selected clip and its track
  let selectedClip: Clip | undefined;
  let selectedTrackType: 'video' | 'audio' | 'text' | undefined;
  if (selectedClipId && project) {
    for (const t of project.tracks) {
      const found = t.clips.find((c) => c.id === selectedClipId);
      if (found) {
        selectedClip = found;
        selectedTrackType = t.type;
        break;
      }
    }
  }

  const selectedAsset = selectedClip
    ? assets.find((a) => a.id === selectedClip!.assetId)
    : undefined;

  const assetHasAudio = !!(selectedAsset?.audioPath);

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

  const valueText = (v: number | string) => (
    <span style={{ fontSize: 13, color: '#b8ddd6', fontVariantNumeric: 'tabular-nums' }}>{v}</span>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto' }}>
      {/* Clip properties */}
      {selectedClip ? (
        <>
          <Section title="Clip Info">
            <Row label="Asset">
              <span style={{ fontSize: 13, color: '#8ab8b0', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {selectedAsset?.name ?? selectedClip.assetId}
              </span>
            </Row>
            <Row label="Start">{valueText(formatTime(selectedClip.timelineStart))}</Row>
            <Row label="End">{valueText(formatTime(selectedClip.timelineEnd))}</Row>
            <Row label="Duration">{valueText(formatTime(selectedClip.timelineEnd - selectedClip.timelineStart))}</Row>
          </Section>

          {(selectedTrackType === 'video' || selectedTrackType === 'text') && selectedClip.transform && (
          <Section title="Transform">
            <Row label="Scale">
              <NumInput
                value={selectedClip.transform.scale}
                min={0.05}
                max={10}
                step={0.01}
                onChange={(v) =>
                  onClipUpdate(selectedClip!.id, {
                    transform: { ...selectedClip!.transform!, scale: v },
                  })
                }
              />
            </Row>
            <Row label="X">
              <NumInput
                value={Math.round(selectedClip.transform.x)}
                step={1}
                onChange={(v) =>
                  onClipUpdate(selectedClip!.id, {
                    transform: { ...selectedClip!.transform!, x: v },
                  })
                }
              />
            </Row>
            <Row label="Y">
              <NumInput
                value={Math.round(selectedClip.transform.y)}
                step={1}
                onChange={(v) =>
                  onClipUpdate(selectedClip!.id, {
                    transform: { ...selectedClip!.transform!, y: v },
                  })
                }
              />
            </Row>
            <Row label="Rotation">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <NumInput
                  value={Math.round(selectedClip.transform.rotation)}
                  min={-180}
                  max={180}
                  step={1}
                  onChange={(v) =>
                    onClipUpdate(selectedClip!.id, {
                      transform: { ...selectedClip!.transform!, rotation: v },
                    })
                  }
                />
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', flexShrink: 0 }}>°</span>
              </div>
            </Row>
            <Row label="Opacity">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={selectedClip.transform.opacity}
                  style={{ width: '100%' }}
                  onChange={(e) =>
                    onClipUpdate(selectedClip!.id, {
                      transform: { ...selectedClip!.transform!, opacity: parseFloat(e.target.value) },
                    })
                  }
                />
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', width: 32, flexShrink: 0 }}>
                  {Math.round(selectedClip.transform.opacity * 100)}%
                </span>
              </div>
            </Row>
            <Row label="">
              <button
                className="btn btn-ghost"
                style={{ fontSize: 11, border: '1px solid rgba(255,255,255,0.10)', padding: '4px 10px', color: 'rgba(255,255,255,0.40)' }}
                onClick={() =>
                  onClipUpdate(selectedClip!.id, {
                    transform: { scale: 1, x: 0, y: 0, rotation: 0, opacity: 1 },
                  })
                }
              >
                Reset
              </button>
            </Row>
          </Section>
          )}

          {selectedTrackType === 'text' && selectedClip && (
          <Section title="Text">
            <Row label="Content">
              <textarea
                value={selectedClip.textContent ?? 'Text'}
                rows={2}
                style={{ width: '100%', fontSize: 13, resize: 'none' }}
                onChange={(e) =>
                  onClipUpdate(selectedClip!.id, { textContent: e.target.value })
                }
              />
            </Row>
            <Row label="Font">
              <select
                value={selectedClip.textStyle?.fontFamily ?? 'Arial'}
                style={{ fontSize: 13 }}
                onChange={(e) =>
                  onClipUpdate(selectedClip!.id, {
                    textStyle: { ...(selectedClip!.textStyle as TextStyle), fontFamily: e.target.value },
                  })
                }
              >
                <option value="Arial">Arial</option>
                <option value="Georgia">Georgia</option>
                <option value="Impact">Impact</option>
                <option value="Verdana">Verdana</option>
                <option value="Courier New">Courier New</option>
                <option value="Times New Roman">Times New Roman</option>
              </select>
            </Row>
            <Row label="Size">
              <NumInput
                value={selectedClip.textStyle?.fontSize ?? 96}
                min={8}
                max={500}
                step={4}
                onChange={(v) =>
                  onClipUpdate(selectedClip!.id, {
                    textStyle: { ...(selectedClip!.textStyle as TextStyle), fontSize: v },
                  })
                }
              />
            </Row>
            <Row label="Color">
              <input
                type="color"
                value={selectedClip.textStyle?.color ?? '#ffffff'}
                style={{ width: '100%', height: 32, cursor: 'pointer' }}
                onChange={(e) =>
                  onClipUpdate(selectedClip!.id, {
                    textStyle: { ...(selectedClip!.textStyle as TextStyle), color: e.target.value },
                  })
                }
              />
            </Row>
            <Row label="Align">
              <select
                value={selectedClip.textStyle?.align ?? 'center'}
                style={{ fontSize: 13 }}
                onChange={(e) =>
                  onClipUpdate(selectedClip!.id, {
                    textStyle: {
                      ...(selectedClip!.textStyle as TextStyle),
                      align: e.target.value as 'left' | 'center' | 'right',
                    },
                  })
                }
              >
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
              </select>
            </Row>
            <Row label="">
              <div style={{ display: 'flex', gap: 8 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'rgba(255,255,255,0.50)', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={selectedClip.textStyle?.bold ?? true}
                    onChange={(e) =>
                      onClipUpdate(selectedClip!.id, {
                        textStyle: { ...(selectedClip!.textStyle as TextStyle), bold: e.target.checked },
                      })
                    }
                  />
                  Bold
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'rgba(255,255,255,0.50)', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={selectedClip.textStyle?.italic ?? false}
                    onChange={(e) =>
                      onClipUpdate(selectedClip!.id, {
                        textStyle: { ...(selectedClip!.textStyle as TextStyle), italic: e.target.checked },
                      })
                    }
                  />
                  Italic
                </label>
              </div>
            </Row>
            <Row label="BG Color">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="color"
                  value={selectedClip.textStyle?.background ?? '#000000'}
                  style={{ width: 56, height: 32, cursor: 'pointer', flexShrink: 0 }}
                  onChange={(e) =>
                    onClipUpdate(selectedClip!.id, {
                      textStyle: { ...(selectedClip!.textStyle as TextStyle), background: e.target.value },
                    })
                  }
                />
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: 11, padding: '4px 8px', border: '1px solid rgba(255,255,255,0.10)', color: 'rgba(255,255,255,0.35)' }}
                  onClick={() =>
                    onClipUpdate(selectedClip!.id, {
                      textStyle: { ...(selectedClip!.textStyle as TextStyle), background: undefined },
                    })
                  }
                >
                  Clear
                </button>
              </div>
            </Row>
            {selectedClip.textStyle?.background && (
              <Row label="BG Alpha">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={selectedClip.textStyle?.backgroundOpacity ?? 0.65}
                    style={{ width: '100%' }}
                    onChange={(e) =>
                      onClipUpdate(selectedClip!.id, {
                        textStyle: {
                          ...(selectedClip!.textStyle as TextStyle),
                          backgroundOpacity: parseFloat(e.target.value),
                        },
                      })
                    }
                  />
                  <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', width: 32, flexShrink: 0 }}>
                    {Math.round((selectedClip.textStyle?.backgroundOpacity ?? 0.65) * 100)}%
                  </span>
                </div>
              </Row>
            )}
          </Section>
          )}

          {selectedTrackType === 'video' && (
          <Section title="Audio">
            <Row label="Use audio">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: assetHasAudio ? 'pointer' : 'not-allowed' }}>
                <input
                  type="checkbox"
                  checked={!!selectedClip.useClipAudio}
                  disabled={!assetHasAudio}
                  onChange={(e) =>
                    onClipUpdate(selectedClip!.id, { useClipAudio: e.target.checked })
                  }
                />
                {!assetHasAudio && (
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)' }}>no audio</span>
                )}
              </label>
            </Row>
            {!!selectedClip.useClipAudio && (
              <Row label="Volume">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="range"
                    min={0}
                    max={2}
                    step={0.05}
                    value={selectedClip.clipAudioVolume ?? 1}
                    style={{ width: '100%' }}
                    onChange={(e) =>
                      onClipUpdate(selectedClip!.id, {
                        clipAudioVolume: parseFloat(e.target.value),
                      })
                    }
                  />
                  <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', width: 32, flexShrink: 0 }}>
                    {Math.round((selectedClip.clipAudioVolume ?? 1) * 100)}%
                  </span>
                </div>
              </Row>
            )}
            {onSyncAudio && masterAssetId && assetHasAudio && (
              <Row label="">
                <button
                  className="btn btn-ghost"
                  style={{
                    fontSize: 12,
                    border: '1px solid rgba(0,212,160,0.30)',
                    padding: '6px 12px',
                    width: '100%',
                    color: syncing ? 'rgba(255,255,255,0.40)' : '#00d4a0',
                    opacity: syncing ? 0.6 : 1,
                  }}
                  disabled={syncing}
                  onClick={async () => {
                    setSyncing(true);
                    try {
                      await onSyncAudio(selectedClip!.id);
                    } finally {
                      setSyncing(false);
                    }
                  }}
                >
                  {syncing ? 'Syncing...' : 'Auto Sync to Master'}
                </button>
              </Row>
            )}
          </Section>
          )}

          <Section title="Effects">
            {/* Beat Zoom */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13, color: '#c0ddd8' }}>Beat Zoom</span>
                {beatZoom ? (
                  <button
                    style={{ fontSize: 12, color: '#ff7090', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px' }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = '#ff9090'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = '#ff7090'; }}
                    onClick={() => onRemoveEffect(selectedClip!.id, 'beatZoom')}
                  >
                    Remove
                  </button>
                ) : (
                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: 12, border: '1px solid rgba(255,255,255,0.12)', padding: '4px 10px' }}
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
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: 12, borderLeft: '2px solid rgba(0,212,160,0.20)' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'rgba(255,255,255,0.50)', cursor: 'pointer' }}>
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
                      style={{ width: '100%' }}
                      onChange={(e) =>
                        onUpdateEffect(selectedClip!.id, 'beatZoom', {
                          intensity: parseFloat(e.target.value),
                        })
                      }
                    />
                    <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>{(beatZoom.intensity * 100).toFixed(0)}%</span>
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
                    <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>ms</span>
                  </Row>
                  <Row label="Easing">
                    <select
                      value={beatZoom.easing}
                      style={{ fontSize: 13 }}
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
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 13, color: '#c0ddd8' }}>Cutout Person</span>
                  {cutout ? (
                    <button
                      style={{ fontSize: 12, color: '#ff7090', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px' }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = '#ff9090'; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = '#ff7090'; }}
                      onClick={() => onRemoveEffect(selectedClip!.id, 'cutout')}
                    >
                      Remove
                    </button>
                  ) : (
                    <button
                      className="btn btn-ghost"
                      style={{ fontSize: 12, border: '1px solid rgba(255,255,255,0.12)', padding: '4px 10px' }}
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
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: 12, borderLeft: '2px solid rgba(0,212,160,0.20)' }}>
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.38)' }}>
                      Mask: {cutout.maskStatus ?? 'unknown'}
                    </div>
                    <Row label="BG Type">
                      <select
                        value={cutout.background.type}
                        style={{ fontSize: 13 }}
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
                          style={{ width: '100%', height: 36 }}
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
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 120, gap: 10, color: 'rgba(255,255,255,0.18)' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 12h8M12 8v8"/></svg>
          <span style={{ fontSize: 13 }}>Select a clip to inspect</span>
        </div>
      )}

      {/* Lyrics */}
      <Section title="Lyrics / Text">
        <textarea
          placeholder="Paste lyrics here..."
          value={lyricsText || project?.lyrics?.text || ''}
          onChange={(e) => setLyricsText(e.target.value)}
          style={{ width: '100%', height: 100, resize: 'none', fontSize: 13 }}
        />
        <button
          className="btn btn-ghost"
          style={{ border: '1px solid rgba(255,255,255,0.12)', width: '100%', fontSize: 13 }}
          onClick={handleAlignLyrics}
          disabled={aligningLyrics || !lyricsText.trim()}
        >
          {aligningLyrics ? 'Aligning...' : 'Align Lyrics'}
        </button>
        {project?.lyrics?.words && (
          <div style={{ marginTop: 4 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'rgba(255,255,255,0.50)', cursor: 'pointer' }}>
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
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.28)', marginTop: 6 }}>
              {project.lyrics.words.length} words aligned
            </p>
          </div>
        )}
        {project?.lyrics?.words && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
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
                style={{ fontSize: 13 }}
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
          className="btn btn-primary"
          style={{ width: '100%', fontSize: 14, padding: '12px 16px' }}
          onClick={handleExport}
          disabled={exporting}
        >
          {exporting ? 'Exporting...' : 'Export MP4'}
        </button>
        {exportDone && (
          <p style={{ fontSize: 13, color: '#4ade80', marginTop: 6 }}>Export started! Check jobs panel.</p>
        )}
        <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.28)', marginTop: 4 }}>Output: 1080×1920, H.264</p>
      </Section>
    </div>
  );
}
