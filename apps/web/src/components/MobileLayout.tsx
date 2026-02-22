'use client';

/**
 * MobileLayout – tabbed interface for phones/small screens.
 *
 * Shows one panel at a time with a bottom tab bar.
 * Tabs: Preview (with transport), Timeline, Media, Inspector.
 *
 * All panels stay mounted (display: none when inactive) so state is
 * preserved and re-renders are avoided when switching tabs.
 */

import React, { useState } from 'react';
import type { PanelRenderers } from './DockLayout';

type MobileTab = 'preview' | 'timeline' | 'media' | 'inspector';

interface TabConfig {
  id: MobileTab;
  label: string;
  icon: React.ReactNode;
}

const TABS: TabConfig[] = [
  {
    id: 'preview',
    label: 'Preview',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="23 7 16 12 23 17 23 7" />
        <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
      </svg>
    ),
  },
  {
    id: 'timeline',
    label: 'Timeline',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="3" y1="12" x2="21" y2="12" />
        <line x1="3" y1="6" x2="21" y2="6" />
        <line x1="3" y1="18" x2="21" y2="18" />
      </svg>
    ),
  },
  {
    id: 'media',
    label: 'Media',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" y1="3" x2="12" y2="15" />
      </svg>
    ),
  },
  {
    id: 'inspector',
    label: 'Inspector',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
    ),
  },
];

export function MobileLayout({ panelRenderers }: { panelRenderers: PanelRenderers }) {
  const [activeTab, setActiveTab] = useState<MobileTab>('preview');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', overflow: 'hidden' }}>

      {/* ── Content area ─────────────────────────────────────────────────── */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>

        {/* Preview tab: project-bar + preview + transport stacked.
            Uses visibility instead of display:none so the container keeps its
            dimensions — ResizeObserver inside Preview fires reliably on tab switch. */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            visibility: activeTab === 'preview' ? 'visible' : 'hidden',
            pointerEvents: activeTab === 'preview' ? 'auto' : 'none',
          }}
        >
          {/* Project bar (compact) */}
          <div style={{ flexShrink: 0 }}>
            {panelRenderers['project-bar']?.()}
          </div>
          {/* Preview canvas */}
          <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
            {panelRenderers['preview']?.()}
          </div>
          {/* Transport controls */}
          <div style={{ flexShrink: 0 }}>
            {panelRenderers['transport']?.()}
          </div>
        </div>

        {/* Timeline tab: timeline + mini transport bar */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: activeTab === 'timeline' ? 'flex' : 'none',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {/* Transport controls at top for quick access while editing timeline */}
          <div style={{ flexShrink: 0 }}>
            {panelRenderers['transport']?.()}
          </div>
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {panelRenderers['timeline']?.()}
          </div>
        </div>

        {/* Media tab: full height, scrollable */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: activeTab === 'media' ? 'block' : 'none',
            overflowY: 'auto',
            overflowX: 'hidden',
          }}
        >
          {panelRenderers['media']?.()}
        </div>

        {/* Inspector tab: full height, scrollable */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: activeTab === 'inspector' ? 'block' : 'none',
            overflowY: 'auto',
            overflowX: 'hidden',
          }}
        >
          {panelRenderers['inspector']?.()}
        </div>
      </div>

      {/* ── Bottom tab bar ─────────────────────────────────────────────── */}
      <div
        style={{
          flexShrink: 0,
          display: 'flex',
          background: 'rgba(6,14,26,0.97)',
          backdropFilter: 'blur(24px)',
          borderTop: '1px solid rgba(255,255,255,0.07)',
          boxShadow: 'inset 0 1px 0 rgba(0,212,160,0.08)',
          // Safe area for iOS home indicator
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 3,
                padding: '10px 4px',
                minHeight: 56,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: isActive ? '#00d4a0' : 'rgba(255,255,255,0.38)',
                transition: 'color 0.15s',
                position: 'relative',
                // Prevent double-tap zoom on mobile
                touchAction: 'manipulation',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              {/* Active indicator line */}
              {isActive && (
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: '20%',
                    right: '20%',
                    height: 2,
                    borderRadius: '0 0 2px 2px',
                    background: 'linear-gradient(90deg, #00d4a0, #38bdf8)',
                    boxShadow: '0 0 8px rgba(0,212,160,0.6)',
                  }}
                />
              )}
              {tab.icon}
              <span style={{ fontSize: 10, fontWeight: isActive ? 600 : 400, letterSpacing: '0.02em' }}>
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
