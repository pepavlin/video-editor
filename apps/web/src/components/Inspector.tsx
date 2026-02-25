'use client';

import { useState } from 'react';
import type {
  Project,
  Clip,
  Asset,
  LyricsStyle,
  TextStyle,
  RectangleStyle,
  EffectClipConfig,
  WordTimestamp,
} from '@video-editor/shared';
import { formatTime } from '@/lib/utils';
import { SnapSlider } from './effects/SnapSlider';

type AssetJobEntry = { jobId: string; status: string; progress: number; logLines: string[] };
type AssetJobs = Record<string, { cutout?: AssetJobEntry; headStab?: AssetJobEntry }>;

interface Props {
  project: Project | null;
  selectedClipId: string | null;
  assets: Asset[];
  onClipUpdate: (clipId: string, updates: Partial<Clip>) => void;
  onUpdateEffectClipConfig: (clipId: string, updates: Partial<EffectClipConfig>) => void;
  onUpdateProject: (updater: (p: Project) => Project) => void;
  masterAssetId?: string;
  onAlignLyricsClip: (clipId: string, text: string, onProgress: (logLines: string[]) => void) => Promise<void>;
  onTranscribeLyricsClip: (clipId: string, onProgress: (logLines: string[]) => void) => Promise<void>;
  onStartCutout: (assetId: string, mode?: 'removeBg' | 'removePerson') => Promise<void>;
  onCancelCutout: (assetId: string) => Promise<void>;
  onStartHeadStabilization: (assetId: string, params: { smoothingX: number; smoothingY: number; smoothingZ: number }) => Promise<void>;
  onCancelHeadStabilization: (assetId: string) => Promise<void>;
  onSyncAudio?: (clipId: string) => Promise<void>;
  assetJobs?: AssetJobs;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div style={{ borderBottom: '1px solid var(--border-subtle)' }}>
      <button
        className="flex items-center justify-between w-full text-left"
        style={{
          padding: '14px 16px',
          transition: 'background 0.15s ease',
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-overlay)'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = ''; }}
        onClick={() => setOpen((o) => !o)}
      >
        <span style={{
          fontSize: 11,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.10em',
          color: 'rgba(13,148,136,0.80)',
        }}>
          {title}
        </span>
        <span style={{
          color: 'rgba(13,148,136,0.45)',
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
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-overlay)'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = ''; }}
    >
      <span style={{
        fontSize: 13,
        color: 'var(--text-muted)',
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
  onUpdateEffectClipConfig,
  onUpdateProject,
  masterAssetId,
  onAlignLyricsClip,
  onTranscribeLyricsClip,
  onStartCutout,
  onCancelCutout,
  onStartHeadStabilization,
  onCancelHeadStabilization,
  onSyncAudio,
  assetJobs,
}: Props) {
  const [syncing, setSyncing] = useState(false);

  // Find selected clip and its track
  let selectedClip: Clip | undefined;
  let selectedTrackType: 'video' | 'audio' | 'text' | 'lyrics' | 'effect' | undefined;
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

  // For regular clips, the assetId directly points to the media asset.
  // For effect track clips, assetId is '' (empty) – resolve the actual video asset
  // by finding the parent video track and picking the clip that overlaps in time.
  let selectedAsset = selectedClip
    ? assets.find((a) => a.id === selectedClip!.assetId)
    : undefined;

  if (!selectedAsset && selectedTrackType === 'effect' && selectedClip && project) {
    const effectTrack = project.tracks.find((t) => t.clips.some((c) => c.id === selectedClip!.id));

    // Primary: resolve via explicit parentTrackId relationship
    if (effectTrack?.parentTrackId) {
      const parentVideoTrack = project.tracks.find((t) => t.id === effectTrack.parentTrackId);
      if (parentVideoTrack) {
        const overlapping = parentVideoTrack.clips.find(
          (c) => c.timelineEnd > selectedClip!.timelineStart && c.timelineStart < selectedClip!.timelineEnd
        );
        const fallback = parentVideoTrack.clips[0];
        const sourceClip = overlapping ?? fallback;
        if (sourceClip) selectedAsset = assets.find((a) => a.id === sourceClip.assetId);
      }
    }

    // Fallback: parentTrackId missing or points to deleted track — scan all video tracks
    // for a clip overlapping the effect clip, falling back to clips[0] of each track.
    if (!selectedAsset) {
      const videoTracks = project.tracks.filter((t) => t.type === 'video');
      for (const vt of videoTracks) {
        const overlapping = vt.clips.find(
          (c) => c.timelineEnd > selectedClip!.timelineStart && c.timelineStart < selectedClip!.timelineEnd
        );
        const sourceClip = overlapping ?? vt.clips[0];
        if (sourceClip) {
          selectedAsset = assets.find((a) => a.id === sourceClip.assetId);
          if (selectedAsset) break;
        }
      }
    }
  }

  // Derive cutout + headStab status from asset-level job map
  const cutoutJob = assetJobs?.[selectedAsset?.id ?? '']?.cutout;
  const isCutoutDone = !!selectedAsset?.maskPath;
  const isCutoutProcessing = cutoutJob?.status === 'RUNNING' || cutoutJob?.status === 'QUEUED';
  const cutoutProgress = cutoutJob?.progress ?? 0;
  const cutoutLogLines = cutoutJob?.logLines ?? [];

  const headStabJob = assetJobs?.[selectedAsset?.id ?? '']?.headStab;
  const isHeadStabDone = !!selectedAsset?.headStabilizedPath;
  const isHeadStabProcessing = headStabJob?.status === 'RUNNING' || headStabJob?.status === 'QUEUED';
  const headStabProgress = headStabJob?.progress ?? 0;
  const headStabLogLines = headStabJob?.logLines ?? [];

  const assetHasAudio = !!(selectedAsset?.audioPath);

  const valueText = (v: number | string) => (
    <span style={{ fontSize: 13, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{v}</span>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto' }}>
      {/* Clip properties */}
      {selectedClip ? (
        <>
          <Section title={selectedTrackType === 'effect' ? 'Effect Info' : 'Clip Info'}>
            {selectedTrackType !== 'effect' && selectedClip.assetId && (
              <Row label="Asset">
                <span style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {selectedAsset?.name ?? selectedClip.assetId}
                </span>
              </Row>
            )}
            {selectedTrackType === 'effect' && selectedClip.effectConfig && (
              <Row label="Type">
                <span style={{ fontSize: 13, color: 'rgba(251,146,60,0.90)', fontWeight: 600 }}>
                  {selectedClip.effectConfig.effectType === 'beatZoom' && '⚡ Beat Zoom'}
                  {selectedClip.effectConfig.effectType === 'cutout' && '✂ Cutout'}
                  {selectedClip.effectConfig.effectType === 'headStabilization' && '⦿ Head Stabilize'}
                  {selectedClip.effectConfig.effectType === 'cartoon' && '◈ Cartoon'}
                  {selectedClip.effectConfig.effectType === 'colorGrade' && '◑ Color Grade'}
                </span>
              </Row>
            )}
            {selectedTrackType === 'effect' && (
              <Row label="Video">
                {selectedAsset ? (
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {selectedAsset.name}
                  </span>
                ) : (
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                    No video found
                  </span>
                )}
              </Row>
            )}
            <Row label="Start">{valueText(formatTime(selectedClip.timelineStart))}</Row>
            <Row label="End">{valueText(formatTime(selectedClip.timelineEnd))}</Row>
            <Row label="Duration">{valueText(formatTime(selectedClip.timelineEnd - selectedClip.timelineStart))}</Row>
          </Section>

          {/* ─── Effect Clip Config ─────────────────────────────────────── */}
          {selectedTrackType === 'effect' && selectedClip.effectConfig && (() => {
            const cfg = selectedClip.effectConfig;
            const update = (u: Partial<EffectClipConfig>) => onUpdateEffectClipConfig(selectedClip!.id, u);
            return (
              <Section title="Effect Settings">
                <Row label="Enabled">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={cfg.enabled}
                      onChange={(e) => update({ enabled: e.target.checked })}
                    />
                    <span style={{ fontSize: 13, color: cfg.enabled ? 'rgba(251,146,60,0.90)' : 'var(--text-muted)' }}>
                      {cfg.enabled ? 'Active' : 'Disabled'}
                    </span>
                  </label>
                </Row>

                {cfg.effectType === 'beatZoom' && (
                  <>
                    <Row label="Intensity">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <input
                          type="range"
                          min={0.01}
                          max={0.5}
                          step={0.01}
                          value={cfg.intensity ?? 0.08}
                          style={{ width: '100%' }}
                          onChange={(e) => update({ intensity: parseFloat(e.target.value) })}
                        />
                        <span style={{ fontSize: 12, color: 'var(--text-muted)', width: 38, flexShrink: 0 }}>
                          {Math.round((cfg.intensity ?? 0.08) * 100)}%
                        </span>
                      </div>
                    </Row>
                    <Row label="Duration">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <input
                          type="range"
                          min={50}
                          max={500}
                          step={10}
                          value={cfg.durationMs ?? 150}
                          style={{ width: '100%' }}
                          onChange={(e) => update({ durationMs: parseInt(e.target.value) })}
                        />
                        <span style={{ fontSize: 12, color: 'var(--text-muted)', width: 38, flexShrink: 0 }}>
                          {cfg.durationMs ?? 150}ms
                        </span>
                      </div>
                    </Row>
                    <Row label="Easing">
                      <select
                        value={cfg.easing ?? 'easeOut'}
                        style={{ fontSize: 13 }}
                        onChange={(e) => update({ easing: e.target.value as EffectClipConfig['easing'] })}
                      >
                        <option value="linear">Linear</option>
                        <option value="easeOut">Ease Out</option>
                        <option value="easeIn">Ease In</option>
                        <option value="easeInOut">Ease In/Out</option>
                      </select>
                    </Row>
                    <Row label="Division">
                      <select
                        value={String(cfg.beatDivision ?? 1)}
                        style={{ fontSize: 13 }}
                        onChange={(e) => update({ beatDivision: parseFloat(e.target.value) })}
                      >
                        <option value="0.25">4/1 — 4× per beat</option>
                        <option value="0.5">2/1 — 2× per beat</option>
                        <option value="1">1/1 — every beat</option>
                        <option value="2">1/2 — every 2nd</option>
                        <option value="4">1/4 — every 4th</option>
                        <option value="8">1/8 — every 8th</option>
                      </select>
                    </Row>
                  </>
                )}

                {cfg.effectType === 'cutout' && (
                  <>
                    <Row label="Mode">
                      <div style={{ display: 'flex', gap: 4, flex: 1 }}>
                        {(['removeBg', 'removePerson'] as const).map((modeVal) => {
                          const active = (cfg.cutoutMode ?? 'removeBg') === modeVal;
                          const label = modeVal === 'removeBg' ? '👤 Keep person' : '🖼 Keep background';
                          return (
                            <button
                              key={modeVal}
                              onClick={() => update({ cutoutMode: modeVal })}
                              style={{
                                flex: 1,
                                fontSize: 11,
                                padding: '5px 6px',
                                borderRadius: 5,
                                border: active
                                  ? '1.5px solid rgba(52,211,153,0.8)'
                                  : '1.5px solid rgba(255,255,255,0.12)',
                                background: active
                                  ? 'rgba(52,211,153,0.15)'
                                  : 'rgba(255,255,255,0.04)',
                                color: active ? '#34d399' : 'var(--text-subtle)',
                                cursor: 'pointer',
                                fontWeight: active ? 600 : 400,
                                transition: 'all 0.15s',
                              }}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </Row>
                    <Row label="Status">
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          {isCutoutProcessing ? (
                            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ fontSize: 11, color: '#fbbf24', flexShrink: 0 }}>Processing</span>
                              {/* Progress bar: indeterminate when at 0, deterministic otherwise */}
                              <div style={{
                                flex: 1,
                                height: 5,
                                borderRadius: 3,
                                background: 'rgba(251,191,36,0.18)',
                                overflow: 'hidden',
                                position: 'relative',
                              }}>
                                {cutoutProgress === 0 ? (
                                  /* Indeterminate bounce — model loading phase */
                                  <div style={{
                                    position: 'absolute',
                                    height: '100%',
                                    width: '40%',
                                    borderRadius: 3,
                                    background: 'linear-gradient(90deg, #fbbf24, #f59e0b)',
                                    animation: 'progressIndeterminate 1.4s ease-in-out infinite',
                                  }} />
                                ) : (
                                  /* Deterministic fill with shimmer overlay */
                                  <div style={{
                                    height: '100%',
                                    borderRadius: 3,
                                    background: 'linear-gradient(90deg, #fbbf24, #f59e0b)',
                                    width: `${cutoutProgress}%`,
                                    transition: 'width 0.4s ease',
                                    position: 'relative',
                                    overflow: 'hidden',
                                  }}>
                                    <div style={{
                                      position: 'absolute',
                                      inset: 0,
                                      background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.35) 50%, transparent 100%)',
                                      backgroundSize: '200% 100%',
                                      animation: 'progressShimmer 1.8s linear infinite',
                                    }} />
                                  </div>
                                )}
                              </div>
                              <span style={{ fontSize: 10, color: '#fbbf24', flexShrink: 0, minWidth: 28, textAlign: 'right' }}>
                                {cutoutProgress === 0 ? '…' : `${cutoutProgress}%`}
                              </span>
                            </div>
                          ) : (
                            <span style={{
                              fontSize: 11,
                              color: isCutoutDone ? '#4ade80' : cutoutJob?.status === 'ERROR' ? '#f87171' : cutoutJob?.status === 'CANCELLED' ? '#94a3b8' : 'var(--text-subtle)',
                              flex: 1,
                            }}>
                              {isCutoutDone && '✓ Cutout ready'}
                              {!isCutoutDone && cutoutJob?.status === 'ERROR' && 'Error – retry'}
                              {!isCutoutDone && cutoutJob?.status === 'CANCELLED' && 'Cancelled'}
                              {!isCutoutDone && (!cutoutJob || (cutoutJob.status !== 'ERROR' && cutoutJob.status !== 'CANCELLED')) && 'Not processed'}
                            </span>
                          )}
                          {isCutoutProcessing ? (
                            <button
                              className="btn btn-ghost"
                              style={{ fontSize: 11, border: '1px solid rgba(220,38,38,0.40)', padding: '4px 10px', color: '#ef4444' }}
                              onClick={() => selectedAsset && onCancelCutout(selectedAsset.id)}
                            >
                              Cancel
                            </button>
                          ) : (
                            <button
                              className="btn btn-ghost"
                              style={{ fontSize: 11, border: '1px solid rgba(13,148,136,0.28)', padding: '4px 10px', color: '#0d9488' }}
                              onClick={() => selectedAsset && onStartCutout(selectedAsset.id, cfg.cutoutMode as 'removeBg' | 'removePerson' | undefined)}
                            >
                              {isCutoutDone || cutoutJob?.status === 'CANCELLED' ? 'Re-process' : 'Process'}
                            </button>
                          )}
                        </div>
                        {/* Log message line — shown only during processing */}
                        {isCutoutProcessing && cutoutLogLines.length > 0 && (
                          <div style={{
                            fontSize: 10,
                            color: 'rgba(251,191,36,0.65)',
                            fontFamily: 'monospace',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            maxWidth: '100%',
                          }}>
                            {cutoutLogLines[cutoutLogLines.length - 1]}
                          </div>
                        )}
                      </div>
                    </Row>
                    <Row label="BG Type">
                      <select
                        value={cfg.background?.type ?? 'solid'}
                        style={{ fontSize: 13 }}
                        onChange={(e) =>
                          update({
                            background: {
                              ...(cfg.background ?? { type: 'solid' }),
                              type: e.target.value as 'solid' | 'video',
                            },
                          })
                        }
                      >
                        <option value="solid">Solid Color</option>
                        <option value="video">Video</option>
                      </select>
                    </Row>
                    {cfg.background?.type === 'solid' && (
                      <Row label="Color">
                        <input
                          type="color"
                          value={cfg.background?.color ?? '#000000'}
                          style={{ width: '100%', height: 32, cursor: 'pointer' }}
                          onChange={(e) =>
                            update({
                              background: { ...(cfg.background ?? { type: 'solid' }), color: e.target.value },
                            })
                          }
                        />
                      </Row>
                    )}
                  </>
                )}

                {cfg.effectType === 'headStabilization' && (
                  <>
                    <Row label="X Axis">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <SnapSlider min={0} max={1} step={0.05} value={cfg.smoothingX ?? 0.7} defaultValue={0.7}
                          onChange={(v) => update({ smoothingX: v })}
                        />
                        <span style={{ fontSize: 12, color: 'var(--text-muted)', width: 32, flexShrink: 0 }}>{Math.round((cfg.smoothingX ?? 0.7) * 100)}%</span>
                      </div>
                    </Row>
                    <Row label="Y Axis">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <SnapSlider min={0} max={1} step={0.05} value={cfg.smoothingY ?? 0.7} defaultValue={0.7}
                          onChange={(v) => update({ smoothingY: v })}
                        />
                        <span style={{ fontSize: 12, color: 'var(--text-muted)', width: 32, flexShrink: 0 }}>{Math.round((cfg.smoothingY ?? 0.7) * 100)}%</span>
                      </div>
                    </Row>
                    <Row label="Z Zoom">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <SnapSlider min={0} max={1} step={0.05} value={cfg.smoothingZ ?? 0.0} defaultValue={0.0}
                          onChange={(v) => update({ smoothingZ: v })}
                        />
                        <span style={{ fontSize: 12, color: 'var(--text-muted)', width: 32, flexShrink: 0 }}>{Math.round((cfg.smoothingZ ?? 0) * 100)}%</span>
                      </div>
                    </Row>
                    <Row label="">
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          {isHeadStabProcessing ? (
                            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ fontSize: 11, color: '#fbbf24', flexShrink: 0 }}>Processing</span>
                              <div style={{
                                flex: 1,
                                height: 5,
                                borderRadius: 3,
                                background: 'rgba(251,191,36,0.18)',
                                overflow: 'hidden',
                                position: 'relative',
                              }}>
                                {headStabProgress === 0 ? (
                                  <div style={{
                                    position: 'absolute',
                                    height: '100%',
                                    width: '40%',
                                    borderRadius: 3,
                                    background: 'linear-gradient(90deg, #fbbf24, #f59e0b)',
                                    animation: 'progressIndeterminate 1.4s ease-in-out infinite',
                                  }} />
                                ) : (
                                  <div style={{
                                    height: '100%',
                                    borderRadius: 3,
                                    background: 'linear-gradient(90deg, #fbbf24, #f59e0b)',
                                    width: `${headStabProgress}%`,
                                    transition: 'width 0.4s ease',
                                    position: 'relative',
                                    overflow: 'hidden',
                                  }}>
                                    <div style={{
                                      position: 'absolute',
                                      inset: 0,
                                      background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.35) 50%, transparent 100%)',
                                      backgroundSize: '200% 100%',
                                      animation: 'progressShimmer 1.8s linear infinite',
                                    }} />
                                  </div>
                                )}
                              </div>
                              <span style={{ fontSize: 10, color: '#fbbf24', flexShrink: 0, minWidth: 28, textAlign: 'right' }}>
                                {headStabProgress === 0 ? '…' : `${headStabProgress}%`}
                              </span>
                            </div>
                          ) : (
                            <span style={{
                              fontSize: 11,
                              color: isHeadStabDone ? '#4ade80' : headStabJob?.status === 'ERROR' ? '#f87171' : headStabJob?.status === 'CANCELLED' ? '#94a3b8' : 'var(--text-subtle)',
                              flex: 1,
                            }}>
                              {isHeadStabDone && 'Stabilized'}
                              {!isHeadStabDone && headStabJob?.status === 'ERROR' && 'Error – retry'}
                              {!isHeadStabDone && headStabJob?.status === 'CANCELLED' && 'Cancelled'}
                              {!isHeadStabDone && (!headStabJob || (headStabJob.status !== 'ERROR' && headStabJob.status !== 'CANCELLED')) && 'Not processed'}
                            </span>
                          )}
                          {isHeadStabProcessing ? (
                            <button
                              className="btn btn-ghost"
                              style={{ fontSize: 11, border: '1px solid rgba(220,38,38,0.40)', padding: '4px 10px', color: '#ef4444' }}
                              onClick={() => selectedAsset && onCancelHeadStabilization(selectedAsset.id)}
                            >
                              Cancel
                            </button>
                          ) : (
                            <button
                              className="btn btn-ghost"
                              style={{ fontSize: 11, border: '1px solid rgba(13,148,136,0.28)', padding: '4px 10px', color: '#0d9488' }}
                              onClick={() => selectedAsset && onStartHeadStabilization(selectedAsset.id, {
                                smoothingX: cfg.smoothingX ?? 0.7,
                                smoothingY: cfg.smoothingY ?? 0.7,
                                smoothingZ: cfg.smoothingZ ?? 0.0,
                              })}
                            >
                              {isHeadStabDone || headStabJob?.status === 'CANCELLED' ? 'Re-process' : 'Process'}
                            </button>
                          )}
                        </div>
                        {isHeadStabProcessing && headStabLogLines.length > 0 && (
                          <div style={{
                            fontSize: 10,
                            color: 'rgba(251,191,36,0.65)',
                            fontFamily: 'monospace',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            maxWidth: '100%',
                          }}>
                            {headStabLogLines[headStabLogLines.length - 1]}
                          </div>
                        )}
                      </div>
                    </Row>
                  </>
                )}

                {cfg.effectType === 'cartoon' && (
                  <>
                    <Row label="Edges">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <SnapSlider min={0} max={1} step={0.05} value={cfg.edgeStrength ?? 0.6} defaultValue={0.6}
                          onChange={(v) => update({ edgeStrength: v })}
                        />
                        <span style={{ fontSize: 12, color: 'var(--text-muted)', width: 32, flexShrink: 0 }}>{Math.round((cfg.edgeStrength ?? 0.6) * 100)}%</span>
                      </div>
                    </Row>
                    <Row label="Flatten">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <SnapSlider min={0} max={1} step={0.05} value={cfg.colorSimplification ?? 0.5} defaultValue={0.5}
                          onChange={(v) => update({ colorSimplification: v })}
                        />
                        <span style={{ fontSize: 12, color: 'var(--text-muted)', width: 32, flexShrink: 0 }}>{Math.round((cfg.colorSimplification ?? 0.5) * 100)}%</span>
                      </div>
                    </Row>
                    <Row label="Saturation">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <SnapSlider min={0} max={2} step={0.05} value={cfg.saturation ?? 1.5} defaultValue={1.5}
                          onChange={(v) => update({ saturation: v })}
                        />
                        <span style={{ fontSize: 12, color: 'var(--text-muted)', width: 36, flexShrink: 0 }}>{(cfg.saturation ?? 1.5).toFixed(1)}×</span>
                      </div>
                    </Row>
                  </>
                )}

                {cfg.effectType === 'colorGrade' && (
                  <>
                    <Row label="Contrast">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <SnapSlider min={0} max={2} step={0.05} value={cfg.contrast ?? 1} defaultValue={1}
                          onChange={(v) => update({ contrast: v })}
                        />
                        <span style={{ fontSize: 12, color: 'var(--text-muted)', width: 36, flexShrink: 0 }}>{(cfg.contrast ?? 1).toFixed(2)}</span>
                      </div>
                    </Row>
                    <Row label="Brightness">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <SnapSlider min={0} max={2} step={0.05} value={cfg.brightness ?? 1} defaultValue={1}
                          onChange={(v) => update({ brightness: v })}
                        />
                        <span style={{ fontSize: 12, color: 'var(--text-muted)', width: 36, flexShrink: 0 }}>{(cfg.brightness ?? 1).toFixed(2)}</span>
                      </div>
                    </Row>
                    <Row label="Saturation">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <SnapSlider min={0} max={2} step={0.05} value={cfg.colorSaturation ?? 1} defaultValue={1}
                          onChange={(v) => update({ colorSaturation: v })}
                        />
                        <span style={{ fontSize: 12, color: 'var(--text-muted)', width: 36, flexShrink: 0 }}>{(cfg.colorSaturation ?? 1).toFixed(2)}</span>
                      </div>
                    </Row>
                    <Row label="Hue">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <SnapSlider min={-180} max={180} step={1} value={cfg.hue ?? 0} defaultValue={0}
                          onChange={(v) => update({ hue: v })}
                        />
                        <span style={{ fontSize: 12, color: 'var(--text-muted)', width: 36, flexShrink: 0 }}>{(cfg.hue ?? 0).toFixed(0)}°</span>
                      </div>
                    </Row>
                    <Row label="Shadows">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <SnapSlider min={-1} max={1} step={0.05} value={cfg.shadows ?? 0} defaultValue={0}
                          onChange={(v) => update({ shadows: v })}
                        />
                        <span style={{ fontSize: 12, color: 'var(--text-muted)', width: 36, flexShrink: 0 }}>{(cfg.shadows ?? 0) >= 0 ? '+' : ''}{(cfg.shadows ?? 0).toFixed(2)}</span>
                      </div>
                    </Row>
                    <Row label="Highlights">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <SnapSlider min={-1} max={1} step={0.05} value={cfg.highlights ?? 0} defaultValue={0}
                          onChange={(v) => update({ highlights: v })}
                        />
                        <span style={{ fontSize: 12, color: 'var(--text-muted)', width: 36, flexShrink: 0 }}>{(cfg.highlights ?? 0) >= 0 ? '+' : ''}{(cfg.highlights ?? 0).toFixed(2)}</span>
                      </div>
                    </Row>
                  </>
                )}
              </Section>
            );
          })()}

          {(selectedTrackType === 'video' || selectedTrackType === 'text' || !!selectedClip?.textStyle) && selectedClip.transform && (
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
                <span style={{ fontSize: 12, color: 'var(--text-muted)', flexShrink: 0 }}>°</span>
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
                <span style={{ fontSize: 12, color: 'var(--text-muted)', width: 32, flexShrink: 0 }}>
                  {Math.round(selectedClip.transform.opacity * 100)}%
                </span>
              </div>
            </Row>
            <Row label="">
              <button
                className="btn btn-ghost"
                style={{ fontSize: 11, border: '1px solid var(--border-default)', padding: '4px 10px', color: 'var(--text-muted)' }}
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

          {(selectedTrackType === 'text' || !!selectedClip?.textContent || !!selectedClip?.textStyle) && selectedClip && (
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
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-secondary)', cursor: 'pointer' }}>
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
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-secondary)', cursor: 'pointer' }}>
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
                  style={{ fontSize: 11, padding: '4px 8px', border: '1px solid var(--border-default)', color: 'var(--text-muted)' }}
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
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', width: 32, flexShrink: 0 }}>
                    {Math.round((selectedClip.textStyle?.backgroundOpacity ?? 0.65) * 100)}%
                  </span>
                </div>
              </Row>
            )}
          </Section>
          )}

          {/* Rectangle clip inspector */}
          {selectedClip?.rectangleStyle && (
          <Section title="Rectangle">
            <Row label="Color">
              <input
                type="color"
                value={selectedClip.rectangleStyle.color ?? '#3b82f6'}
                style={{ width: '100%', height: 32, cursor: 'pointer' }}
                onChange={(e) =>
                  onClipUpdate(selectedClip!.id, {
                    rectangleStyle: { ...(selectedClip!.rectangleStyle as RectangleStyle), color: e.target.value },
                  })
                }
              />
            </Row>
            <Row label="Fill Alpha">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={selectedClip.rectangleStyle.fillOpacity ?? 1}
                  style={{ width: '100%' }}
                  onChange={(e) =>
                    onClipUpdate(selectedClip!.id, {
                      rectangleStyle: {
                        ...(selectedClip!.rectangleStyle as RectangleStyle),
                        fillOpacity: parseFloat(e.target.value),
                      },
                    })
                  }
                />
                <span style={{ fontSize: 12, color: 'var(--text-muted)', width: 32, flexShrink: 0 }}>
                  {Math.round((selectedClip.rectangleStyle.fillOpacity ?? 1) * 100)}%
                </span>
              </div>
            </Row>
            <Row label="Width">
              <NumInput
                value={selectedClip.rectangleStyle.width ?? 400}
                min={4}
                max={3840}
                step={4}
                onChange={(v) =>
                  onClipUpdate(selectedClip!.id, {
                    rectangleStyle: { ...(selectedClip!.rectangleStyle as RectangleStyle), width: v },
                  })
                }
              />
            </Row>
            <Row label="Height">
              <NumInput
                value={selectedClip.rectangleStyle.height ?? 200}
                min={4}
                max={3840}
                step={4}
                onChange={(v) =>
                  onClipUpdate(selectedClip!.id, {
                    rectangleStyle: { ...(selectedClip!.rectangleStyle as RectangleStyle), height: v },
                  })
                }
              />
            </Row>
            <Row label="Radius">
              <NumInput
                value={selectedClip.rectangleStyle.borderRadius ?? 0}
                min={0}
                max={960}
                step={4}
                onChange={(v) =>
                  onClipUpdate(selectedClip!.id, {
                    rectangleStyle: { ...(selectedClip!.rectangleStyle as RectangleStyle), borderRadius: v },
                  })
                }
              />
            </Row>
            <Row label="Border">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="color"
                  value={selectedClip.rectangleStyle.borderColor ?? '#ffffff'}
                  style={{ width: 56, height: 32, cursor: 'pointer', flexShrink: 0 }}
                  onChange={(e) =>
                    onClipUpdate(selectedClip!.id, {
                      rectangleStyle: {
                        ...(selectedClip!.rectangleStyle as RectangleStyle),
                        borderColor: e.target.value,
                      },
                    })
                  }
                />
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: 11, padding: '4px 8px', border: '1px solid var(--border-default)', color: 'var(--text-muted)' }}
                  onClick={() =>
                    onClipUpdate(selectedClip!.id, {
                      rectangleStyle: {
                        ...(selectedClip!.rectangleStyle as RectangleStyle),
                        borderColor: undefined,
                        borderWidth: undefined,
                      },
                    })
                  }
                >
                  Clear
                </button>
              </div>
            </Row>
            {selectedClip.rectangleStyle.borderColor && (
              <Row label="Border W">
                <NumInput
                  value={selectedClip.rectangleStyle.borderWidth ?? 4}
                  min={1}
                  max={100}
                  step={1}
                  onChange={(v) =>
                    onClipUpdate(selectedClip!.id, {
                      rectangleStyle: { ...(selectedClip!.rectangleStyle as RectangleStyle), borderWidth: v },
                    })
                  }
                />
              </Row>
            )}
          </Section>
          )}

          {selectedTrackType === 'lyrics' && selectedClip && (
            <LyricsClipInspector
              clip={selectedClip}
              onClipUpdate={onClipUpdate}
              onAlignLyricsClip={onAlignLyricsClip}
              onTranscribeLyricsClip={onTranscribeLyricsClip}
            />
          )}

          {selectedTrackType === 'video' && !selectedClip?.textContent && !selectedClip?.textStyle && (
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
                  <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>no audio</span>
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
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', width: 32, flexShrink: 0 }}>
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
                    border: '1px solid rgba(13,148,136,0.28)',
                    padding: '6px 12px',
                    width: '100%',
                    color: syncing ? 'var(--text-muted)' : '#0d9488',
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
        </>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 120, gap: 10, color: 'var(--text-subtle)' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 12h8M12 8v8"/></svg>
          <span style={{ fontSize: 13 }}>Select a clip to inspect</span>
        </div>
      )}

    </div>
  );
}

// ─── LyricsClipInspector ──────────────────────────────────────────────────────

function LyricsClipInspector({
  clip,
  onClipUpdate,
  onAlignLyricsClip,
  onTranscribeLyricsClip,
}: {
  clip: Clip;
  onClipUpdate: (clipId: string, updates: Partial<Clip>) => void;
  onAlignLyricsClip: (clipId: string, text: string, onProgress: (logLines: string[]) => void) => Promise<void>;
  onTranscribeLyricsClip: (clipId: string, onProgress: (logLines: string[]) => void) => Promise<void>;
}) {
  const [aligning, setAligning] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [jobLogs, setJobLogs] = useState<string[]>([]);
  const style = clip.lyricsStyle ?? {
    fontSize: 48,
    color: '#ffffff',
    highlightColor: '#FFE600',
    position: 'bottom' as const,
    wordsPerChunk: 3,
  };

  const updateStyle = (updates: Partial<LyricsStyle>) =>
    onClipUpdate(clip.id, { lyricsStyle: { ...style, ...updates } as LyricsStyle });

  const handleAlign = async () => {
    const text = clip.lyricsContent ?? '';
    if (!text.trim()) return;
    setAligning(true);
    setJobLogs([]);
    onClipUpdate(clip.id, { lyricsAlignStatus: 'aligning' });
    try {
      await onAlignLyricsClip(clip.id, text, (lines) => setJobLogs(lines));
      onClipUpdate(clip.id, { lyricsAlignStatus: 'done' });
    } catch (e: any) {
      setJobLogs((prev) => [...prev, e?.message ?? 'Unknown error']);
      onClipUpdate(clip.id, { lyricsAlignStatus: 'error' });
    } finally {
      setAligning(false);
    }
  };

  const handleTranscribe = async () => {
    setTranscribing(true);
    setJobLogs([]);
    onClipUpdate(clip.id, { lyricsAlignStatus: 'aligning' });
    try {
      await onTranscribeLyricsClip(clip.id, (lines) => setJobLogs(lines));
      onClipUpdate(clip.id, { lyricsAlignStatus: 'done' });
    } catch (e: any) {
      setJobLogs((prev) => [...prev, e?.message ?? 'Unknown error']);
      onClipUpdate(clip.id, { lyricsAlignStatus: 'error' });
    } finally {
      setTranscribing(false);
    }
  };

  const busy = aligning || transcribing;

  return (
    <>
      <Section title="Lyrics">
        <button
          className="btn btn-ghost"
          style={{
            border: '1px solid rgba(99,102,241,0.40)',
            width: '100%',
            fontSize: 13,
            color: busy ? 'var(--text-muted)' : '#818cf8',
            opacity: busy ? 0.6 : 1,
            marginBottom: 6,
          }}
          disabled={busy}
          onClick={handleTranscribe}
        >
          {transcribing ? 'Detecting lyrics...' : 'Auto-detect lyrics'}
        </button>
        <textarea
          placeholder="Paste lyrics here, or use Auto-detect above..."
          value={clip.lyricsContent ?? ''}
          rows={5}
          style={{ width: '100%', resize: 'none', fontSize: 13 }}
          onChange={(e) => onClipUpdate(clip.id, { lyricsContent: e.target.value, lyricsAlignStatus: 'idle' })}
        />
        <button
          className="btn btn-ghost"
          style={{
            border: '1px solid rgba(13,148,136,0.28)',
            width: '100%',
            fontSize: 13,
            color: busy ? 'var(--text-muted)' : '#0d9488',
            opacity: busy || !clip.lyricsContent?.trim() ? 0.6 : 1,
            marginTop: 4,
          }}
          disabled={busy || !clip.lyricsContent?.trim()}
          onClick={handleAlign}
        >
          {aligning ? 'Aligning with Whisper...' : 'Re-align with Whisper'}
        </button>
        {(busy || jobLogs.length > 0) && (
          <div
            style={{
              marginTop: 6,
              padding: '6px 8px',
              background: 'rgba(0,0,0,0.35)',
              borderRadius: 4,
              border: '1px solid rgba(255,255,255,0.08)',
              maxHeight: 120,
              overflowY: 'auto',
              fontFamily: 'monospace',
              fontSize: 11,
              lineHeight: 1.5,
              color: clip.lyricsAlignStatus === 'error' ? '#f87171' : 'var(--text-muted)',
            }}
          >
            {jobLogs.length > 0
              ? jobLogs.map((line, i) => <div key={i}>{line}</div>)
              : <div style={{ opacity: 0.6 }}>Spouštím...</div>}
          </div>
        )}
        {clip.lyricsWords && clip.lyricsWords.length > 0 && !busy && (
          <p style={{ fontSize: 12, color: '#4ade80', marginTop: 4 }}>
            {clip.lyricsWords.length} words aligned
          </p>
        )}
        {clip.lyricsAlignStatus === 'error' && !busy && (
          <p style={{ fontSize: 12, color: '#f87171', marginTop: 4 }}>Operation failed – try again</p>
        )}
      </Section>

      <Section title="Lyrics Style">
        <Row label="Font size">
          <NumInput
            value={style.fontSize}
            min={12}
            max={200}
            step={2}
            onChange={(v) => updateStyle({ fontSize: v })}
          />
        </Row>
        <Row label="Color">
          <input
            type="color"
            value={style.color}
            style={{ width: '100%', height: 32, cursor: 'pointer' }}
            onChange={(e) => updateStyle({ color: e.target.value })}
          />
        </Row>
        <Row label="Highlight">
          <input
            type="color"
            value={style.highlightColor}
            style={{ width: '100%', height: 32, cursor: 'pointer' }}
            onChange={(e) => updateStyle({ highlightColor: e.target.value })}
          />
        </Row>
        <Row label="Position">
          <select
            value={style.position}
            style={{ fontSize: 13 }}
            onChange={(e) => updateStyle({ position: e.target.value as 'top' | 'center' | 'bottom' })}
          >
            <option value="top">Top</option>
            <option value="center">Center</option>
            <option value="bottom">Bottom</option>
          </select>
        </Row>
        <Row label="Words/chunk">
          <NumInput
            value={style.wordsPerChunk}
            min={1}
            max={8}
            step={1}
            onChange={(v) => updateStyle({ wordsPerChunk: v })}
          />
        </Row>
      </Section>
    </>
  );
}
