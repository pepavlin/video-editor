'use client';

/**
 * DockLayout – VS-Code-style dockable panel system.
 *
 * Features:
 *  - All panels are draggable by their title bar
 *  - Drop any panel onto top/bottom/left/right of another to split it
 *  - Live preview (highlight overlay) shows the drop zone WHILE dragging
 *  - Resize handles between siblings in a split
 *  - Layout persisted to localStorage
 */

import React, { useState, useRef, useCallback } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

export type PanelId = string;
export type DropZone = 'top' | 'bottom' | 'left' | 'right';

export interface LeafNode {
  type: 'leaf';
  id: string;
  panelId: PanelId;
}

export interface SplitNode {
  type: 'split';
  id: string;
  /** h = side by side (horizontal flex row), v = stacked (vertical flex column) */
  direction: 'h' | 'v';
  children: DockNode[];
  /** fractions, must sum to 1 */
  sizes: number[];
}

export type DockNode = LeafNode | SplitNode;

interface DropTarget {
  nodeId: string;
  panelId: PanelId;
  zone: DropZone;
}

interface DragState {
  panel: PanelId | null;
  target: DropTarget | null;
}

// ─── Tree utilities ───────────────────────────────────────────────────────────

let _idCounter = 0;
function genId() { return `dk${++_idCounter}`; }

/** Remove a panel by panelId; collapses single-child splits. Returns null if tree becomes empty. */
function removePanel(root: DockNode, panelId: PanelId): DockNode | null {
  if (root.type === 'leaf') return root.panelId === panelId ? null : root;

  const kept: DockNode[] = [];
  const keptSizes: number[] = [];

  for (let i = 0; i < root.children.length; i++) {
    const result = removePanel(root.children[i], panelId);
    if (result !== null) {
      kept.push(result);
      keptSizes.push(root.sizes[i]);
    }
  }

  if (kept.length === 0) return null;
  if (kept.length === 1) return kept[0]; // unwrap single-child split

  const total = keptSizes.reduce((a, b) => a + b, 0);
  return { ...root, children: kept, sizes: keptSizes.map(s => s / total) };
}

/** Insert panelId at a given zone of a target leaf node, creating a split if needed. */
function insertAtNode(
  root: DockNode,
  targetId: string,
  panelId: PanelId,
  zone: DropZone,
): DockNode {
  if (root.type === 'leaf' && root.id === targetId) {
    const newLeaf: LeafNode = { type: 'leaf', id: genId(), panelId };
    const dir: 'h' | 'v' = (zone === 'left' || zone === 'right') ? 'h' : 'v';
    const first = (zone === 'left' || zone === 'top') ? newLeaf : root;
    const second = (zone === 'left' || zone === 'top') ? root : newLeaf;
    return { type: 'split', id: genId(), direction: dir, children: [first, second], sizes: [0.5, 0.5] };
  }

  if (root.type === 'split') {
    // Optimization: if target is a direct child and the zone direction matches the split direction,
    // insert into this split instead of nesting deeper.
    const targetChildIdx = root.children.findIndex(c => c.type === 'leaf' && c.id === targetId);
    if (targetChildIdx !== -1) {
      const zoneDir: 'h' | 'v' = (zone === 'left' || zone === 'right') ? 'h' : 'v';
      if (zoneDir === root.direction) {
        const newLeaf: LeafNode = { type: 'leaf', id: genId(), panelId };
        const insertBefore = zone === 'left' || zone === 'top';
        const insertAt = insertBefore ? targetChildIdx : targetChildIdx + 1;

        const newChildren = [...root.children];
        newChildren.splice(insertAt, 0, newLeaf);

        const newSizes = [...root.sizes];
        const half = newSizes[targetChildIdx] * 0.5;
        newSizes[targetChildIdx] = half;
        newSizes.splice(insertAt, 0, half);

        const total = newSizes.reduce((a, b) => a + b, 0);
        return { ...root, children: newChildren, sizes: newSizes.map(s => s / total) };
      }
    }

    return {
      ...root,
      children: root.children.map(c => insertAtNode(c, targetId, panelId, zone)),
    };
  }

  return root;
}

/** Move sourcePanelId to zone of targetNodeId. */
function movePanel(root: DockNode, sourcePanelId: PanelId, targetNodeId: string, zone: DropZone): DockNode {
  const afterRemove = removePanel(root, sourcePanelId);
  if (!afterRemove) return root;
  return insertAtNode(afterRemove, targetNodeId, sourcePanelId, zone);
}

/**
 * Dock a panel at the left or right edge of the entire layout.
 * If root is already a horizontal split, the panel is prepended/appended directly.
 * Otherwise root is wrapped in a new horizontal split.
 * The new panel receives ~22 % of the total width.
 */
function insertAtRootEdge(root: DockNode, panelId: PanelId, edge: 'left' | 'right'): DockNode {
  const afterRemove = removePanel(root, panelId);
  if (!afterRemove) return { type: 'leaf', id: genId(), panelId };

  const newLeaf: LeafNode = { type: 'leaf', id: genId(), panelId };
  const NEW_SIZE = 0.22;

  if (afterRemove.type === 'split' && afterRemove.direction === 'h') {
    const scale = 1 - NEW_SIZE;
    const scaledSizes = afterRemove.sizes.map(s => s * scale);
    if (edge === 'left') {
      return { ...afterRemove, children: [newLeaf, ...afterRemove.children], sizes: [NEW_SIZE, ...scaledSizes] };
    } else {
      return { ...afterRemove, children: [...afterRemove.children, newLeaf], sizes: [...scaledSizes, NEW_SIZE] };
    }
  }

  const first  = edge === 'left' ? newLeaf       : afterRemove;
  const second = edge === 'left' ? afterRemove   : newLeaf;
  const sizes: [number, number] = edge === 'left' ? [NEW_SIZE, 1 - NEW_SIZE] : [1 - NEW_SIZE, NEW_SIZE];
  return { type: 'split', id: genId(), direction: 'h', children: [first, second], sizes };
}

/** Update sizes for a specific split node. */
function updateSizes(root: DockNode, splitId: string, sizes: number[]): DockNode {
  if (root.type === 'leaf') return root;
  if (root.id === splitId) return { ...root, sizes };
  return { ...root, children: root.children.map(c => updateSizes(c, splitId, sizes)) };
}

/** Find sizes for a split node by id. */
function findSizes(root: DockNode, splitId: string): number[] | null {
  if (root.type === 'split') {
    if (root.id === splitId) return root.sizes;
    for (const c of root.children) {
      const found = findSizes(c, splitId);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Calculate which drop zone (top/bottom/left/right) the cursor is in relative to a panel rect.
 * Uses 30% edge threshold; corners resolve to the nearest single axis.
 */
function calcDropZone(rect: DOMRect, x: number, y: number): DropZone {
  const xRel = (x - rect.left) / rect.width;
  const yRel = (y - rect.top) / rect.height;
  const E = 0.30; // 30% edge threshold

  const nearLeft = xRel < E;
  const nearRight = xRel > 1 - E;
  const nearTop = yRel < E;
  const nearBottom = yRel > 1 - E;

  if (nearTop && !nearLeft && !nearRight) return 'top';
  if (nearBottom && !nearLeft && !nearRight) return 'bottom';
  if (nearLeft && !nearTop && !nearBottom) return 'left';
  if (nearRight && !nearTop && !nearBottom) return 'right';

  // Corner / center: pick the axis with the smallest distance to an edge
  const dL = xRel, dR = 1 - xRel, dT = yRel, dB = 1 - yRel;
  const min = Math.min(dL, dR, dT, dB);
  if (min === dT) return 'top';
  if (min === dB) return 'bottom';
  if (min === dL) return 'left';
  return 'right';
}

// Visual overlay style per drop zone (relative to panel)
const ZONE_STYLE: Record<DropZone, React.CSSProperties> = {
  top:    { top: 0,    left: 0, right: 0,    height: '45%' },
  bottom: { bottom: 0, left: 0, right: 0,    height: '45%' },
  left:   { top: 0,   left: 0, bottom: 0,    width:  '45%' },
  right:  { top: 0,  right: 0, bottom: 0,    width:  '45%' },
};

// ─── Panel metadata ───────────────────────────────────────────────────────────

const PANEL_LABELS: Record<string, string> = {
  media:          'Media',
  preview:        'Preview',
  inspector:      'Inspector',
  timeline:       'Timeline',
  transport:      'Transport',
  'project-bar':  'Project',
};

// ─── Default layout (mirrors original layout) ─────────────────────────────────

export const DEFAULT_LAYOUT: DockNode = {
  type: 'split',
  id: 'root',
  direction: 'h',
  children: [
    { type: 'leaf', id: 'leaf_media',      panelId: 'media' },
    {
      type: 'split',
      id: 'center',
      direction: 'v',
      children: [
        { type: 'leaf', id: 'leaf_projectbar', panelId: 'project-bar' },
        { type: 'leaf', id: 'leaf_preview',    panelId: 'preview' },
        { type: 'leaf', id: 'leaf_transport',  panelId: 'transport' },
        { type: 'leaf', id: 'leaf_timeline',   panelId: 'timeline' },
      ],
      sizes: [0.08, 0.55, 0.09, 0.28],
    },
    { type: 'leaf', id: 'leaf_inspector',  panelId: 'inspector' },
  ],
  sizes: [0.20, 0.56, 0.24],
};

const STORAGE_KEY = 've-dock-layout';

function loadLayout(): DockNode {
  try {
    const s = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (s) {
      const parsed = JSON.parse(s) as DockNode;
      // Basic validation
      if (parsed && typeof parsed === 'object' && 'type' in parsed) return parsed;
    }
  } catch { /* ignore */ }
  return DEFAULT_LAYOUT;
}

function saveLayout(layout: DockNode) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(layout)); } catch { /* ignore */ }
}

// ─── Public types ─────────────────────────────────────────────────────────────

export type PanelRenderers = Record<string, () => React.ReactNode>;

// ─── DockLayout (root component) ─────────────────────────────────────────────

export function DockLayout({ panelRenderers }: { panelRenderers: PanelRenderers }) {
  const [layout, setLayout] = useState<DockNode>(loadLayout);
  const [dragState, setDragState] = useState<DragState>({ panel: null, target: null });

  // DOM refs for all rendered leaf panels (node id → {element, panelId})
  const leafRefs = useRef(new Map<string, { el: HTMLElement; panelId: PanelId }>());
  // Ghost label element
  const ghostRef = useRef<HTMLDivElement | null>(null);
  // Refs to avoid stale closures in event handlers
  const draggingPanelRef = useRef<PanelId | null>(null);
  const currentTargetRef = useRef<DropTarget | null>(null);
  const lastTargetKey = useRef('');
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  // ── Page-edge docking state ──────────────────────────────────────────────────
  const [pageEdge, setPageEdge] = useState<'left' | 'right' | null>(null);
  const pageEdgeRef = useRef<'left' | 'right' | null>(null);
  const rootContainerRef = useRef<HTMLDivElement | null>(null);
  /** Distance (px) from the layout edge that activates page-edge docking. */
  const PAGE_EDGE_THRESHOLD = 60;

  const registerLeaf = useCallback((nodeId: string, panelId: PanelId, el: HTMLElement | null) => {
    if (el) {
      leafRefs.current.set(nodeId, { el, panelId });
    } else {
      leafRefs.current.delete(nodeId);
    }
  }, []);

  // ── Drag start ──────────────────────────────────────────────────────────────
  const startPanelDrag = useCallback((panelId: PanelId, initX: number, initY: number) => {
    draggingPanelRef.current = panelId;
    currentTargetRef.current = null;
    lastTargetKey.current = '';

    setDragState({ panel: panelId, target: null });
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'grabbing';

    // Show ghost
    if (ghostRef.current) {
      ghostRef.current.style.left = `${initX + 14}px`;
      ghostRef.current.style.top  = `${initY + 14}px`;
      ghostRef.current.style.display = 'flex';
      ghostRef.current.textContent = PANEL_LABELS[panelId] ?? panelId;
    }

    const onMove = (e: MouseEvent) => {
      const { clientX: x, clientY: y } = e;

      // Move ghost directly (no React state = no re-render)
      if (ghostRef.current) {
        ghostRef.current.style.left = `${x + 14}px`;
        ghostRef.current.style.top  = `${y + 14}px`;
      }

      // ── Page-edge detection (takes priority over panel drop zones) ────────────
      let newPageEdge: 'left' | 'right' | null = null;
      if (rootContainerRef.current) {
        const rootRect = rootContainerRef.current.getBoundingClientRect();
        if (x >= rootRect.left && x <= rootRect.right && y >= rootRect.top && y <= rootRect.bottom) {
          if (x - rootRect.left < PAGE_EDGE_THRESHOLD) newPageEdge = 'left';
          else if (rootRect.right - x < PAGE_EDGE_THRESHOLD) newPageEdge = 'right';
        }
      }
      if (newPageEdge !== pageEdgeRef.current) {
        pageEdgeRef.current = newPageEdge;
        setPageEdge(newPageEdge);
      }

      // When hovering near the page edge, clear any panel drop-zone target and bail early
      if (newPageEdge) {
        if (lastTargetKey.current !== '') {
          lastTargetKey.current = '';
          currentTargetRef.current = null;
          setDragState(s => ({ ...s, target: null }));
        }
        return;
      }

      // Find which leaf panel the cursor is over
      let newTarget: DropTarget | null = null;
      leafRefs.current.forEach(({ el, panelId: pId }, nodeId) => {
        if (newTarget) return;
        if (pId === draggingPanelRef.current) return;
        const rect = el.getBoundingClientRect();
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
          newTarget = { nodeId, panelId: pId, zone: calcDropZone(rect, x, y) } as DropTarget;
        }
      });

      // Only trigger React re-render when the target actually changes
      const nt = newTarget as DropTarget | null;
      const key = nt ? `${nt.nodeId}:${nt.zone}` : '';
      if (key !== lastTargetKey.current) {
        lastTargetKey.current = key;
        currentTargetRef.current = nt;
        setDragState(s => ({ ...s, target: nt }));
      }
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';

      if (ghostRef.current) ghostRef.current.style.display = 'none';

      const dragging = draggingPanelRef.current;
      const target   = currentTargetRef.current;
      const edgeDrop = pageEdgeRef.current;

      if (dragging && edgeDrop) {
        // Page-edge dock: insert panel at the left/right border of the layout
        setLayout(prev => {
          const next = insertAtRootEdge(prev, dragging, edgeDrop);
          saveLayout(next);
          return next;
        });
      } else if (dragging && target) {
        setLayout(prev => {
          const next = movePanel(prev, dragging, target.nodeId, target.zone);
          saveLayout(next);
          return next;
        });
      }

      draggingPanelRef.current = null;
      currentTargetRef.current = null;
      lastTargetKey.current = '';
      pageEdgeRef.current = null;
      setPageEdge(null);
      setDragState({ panel: null, target: null });
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  // ── Resize handle ───────────────────────────────────────────────────────────
  const startSplitResize = useCallback((
    splitId: string,
    idx: number,
    direction: 'h' | 'v',
    containerEl: HTMLElement,
    e: React.MouseEvent,
  ) => {
    e.preventDefault();
    e.stopPropagation();

    const initialSizes = findSizes(layoutRef.current, splitId);
    if (!initialSizes) return;

    const startPos = direction === 'h' ? e.clientX : e.clientY;
    const containerRect = containerEl.getBoundingClientRect();
    const containerSize = direction === 'h' ? containerRect.width : containerRect.height;
    const sizes = [...initialSizes];

    document.body.style.cursor = direction === 'h' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: MouseEvent) => {
      const delta = ((direction === 'h' ? ev.clientX : ev.clientY) - startPos) / containerSize;
      const total = sizes[idx] + sizes[idx + 1];
      const newA = Math.max(0.05, Math.min(total - 0.05, sizes[idx] + delta));
      const newSizes = [...sizes];
      newSizes[idx] = newA;
      newSizes[idx + 1] = total - newA;
      setLayout(prev => updateSizes(prev, splitId, newSizes));
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setLayout(prev => { saveLayout(prev); return prev; });
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  return (
    <div ref={rootContainerRef} style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden', display: 'flex' }}>
      {/* Page-edge docking indicator – shown when dragging near left/right edge */}
      {dragState.panel && pageEdge && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            ...(pageEdge === 'left'
              ? { left: 0, width: '22%', borderRight: '2px solid rgba(13,148,136,0.75)', boxShadow: 'inset -4px 0 16px rgba(13,148,136,0.08), 2px 0 12px rgba(13,148,136,0.10)' }
              : { right: 0, width: '22%', borderLeft: '2px solid rgba(13,148,136,0.75)', boxShadow: 'inset 4px 0 16px rgba(13,148,136,0.08), -2px 0 12px rgba(13,148,136,0.10)' }
            ),
            background: 'rgba(13,148,136,0.07)',
            backdropFilter: 'blur(2px)',
            zIndex: 300,
            pointerEvents: 'none',
            transition: 'opacity 0.08s ease',
          }}
        >
          {/* Arrow indicating dock direction */}
          <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            color: '#0d9488',
            fontSize: 28,
            fontWeight: 700,
            pointerEvents: 'none',
            textShadow: 'none',
          }}>
            {pageEdge === 'left' ? '◀' : '▶'}
          </div>
        </div>
      )}
      <RenderNode
        node={layout}
        dragState={dragState}
        panelRenderers={panelRenderers}
        registerLeaf={registerLeaf}
        onStartDrag={startPanelDrag}
        onSplitResize={startSplitResize}
      />

      {/* Cursor-following ghost label shown while dragging */}
      <div
        ref={ghostRef}
        style={{
          display: 'none',
          position: 'fixed',
          alignItems: 'center',
          gap: 6,
          background: 'rgba(255,255,255,0.96)',
          border: '1px solid rgba(13,148,136,0.35)',
          borderRadius: 8,
          padding: '5px 14px',
          color: '#0f172a',
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: '0.04em',
          pointerEvents: 'none',
          zIndex: 9999,
          backdropFilter: 'blur(10px)',
          boxShadow: '0 4px 16px rgba(15,23,42,0.12), 0 1px 4px rgba(15,23,42,0.06)',
        }}
      />
    </div>
  );
}

// ─── RenderNode (recursive dispatcher) ───────────────────────────────────────

interface NodeProps {
  node: DockNode;
  dragState: DragState;
  panelRenderers: PanelRenderers;
  registerLeaf: (nodeId: string, panelId: PanelId, el: HTMLElement | null) => void;
  onStartDrag: (panelId: PanelId, x: number, y: number) => void;
  onSplitResize: (splitId: string, idx: number, direction: 'h' | 'v', container: HTMLElement, e: React.MouseEvent) => void;
}

function RenderNode(props: NodeProps) {
  if (props.node.type === 'leaf') return <RenderLeaf {...props} node={props.node} />;
  return <RenderSplit {...props} node={props.node} />;
}

// ─── RenderLeaf ───────────────────────────────────────────────────────────────

function RenderLeaf({ node, dragState, panelRenderers, registerLeaf, onStartDrag }: NodeProps & { node: LeafNode }) {
  const setRef = useCallback((el: HTMLDivElement | null) => {
    registerLeaf(node.id, node.panelId, el);
  }, [node.id, node.panelId, registerLeaf]);

  const [showHeader, setShowHeader] = useState(false);
  const showHeaderRef = useRef(false);
  // Track if mouse is inside the panel
  const insideRef = useRef(false);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const relY = e.clientY - rect.top;
    const shouldShow = relY <= 34;
    if (shouldShow !== showHeaderRef.current) {
      showHeaderRef.current = shouldShow;
      setShowHeader(shouldShow);
    }
  }, []);

  const handleMouseEnter = useCallback(() => {
    insideRef.current = true;
  }, []);

  const handleMouseLeave = useCallback(() => {
    insideRef.current = false;
    showHeaderRef.current = false;
    setShowHeader(false);
  }, []);

  const isBeingDragged = dragState.panel === node.panelId;
  const isDropTarget   = dragState.target?.nodeId === node.id;
  const dropZone       = isDropTarget ? dragState.target!.zone : null;
  const renderer       = panelRenderers[node.panelId];

  return (
    <div
      ref={setRef}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        minHeight: 0,
        position: 'relative',
        overflow: 'hidden',
        opacity: isBeingDragged ? 0.30 : 1,
        transition: 'opacity 0.18s ease, transform 0.18s ease',
        transform: isBeingDragged ? 'scale(0.99)' : 'scale(1)',
      }}
    >
      {/* Hover-reveal drag handle – small centered pill at top, does not block content */}
      <div
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          onStartDrag(node.panelId, e.clientX, e.clientY);
        }}
        title={PANEL_LABELS[node.panelId] ?? node.panelId}
        style={{
          position: 'absolute',
          top: 4,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 20,
          height: 18,
          display: 'flex',
          alignItems: 'center',
          paddingLeft: 8,
          paddingRight: 8,
          gap: 4,
          cursor: 'grab',
          background: 'rgba(255,255,255,0.92)',
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(15,23,42,0.10)',
          borderRadius: 999,
          userSelect: 'none',
          whiteSpace: 'nowrap',
          boxShadow: '0 2px 8px rgba(15,23,42,0.10)',
          opacity: showHeader ? 1 : 0,
          pointerEvents: showHeader ? 'auto' : 'none',
          transition: 'opacity 0.18s ease',
        }}
      >
        <GripDots />
      </div>

      {/* Panel content – takes full height since header is absolute */}
      <div style={{ flex: 1, minHeight: 0, minWidth: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {renderer
          ? renderer()
          : (
            <div style={{ padding: 16, color: 'rgba(15,23,42,0.35)', fontSize: 12 }}>
              Unknown panel: {node.panelId}
            </div>
          )}
      </div>

      {/* Live drop-zone overlay – visible only when this panel is the current drop target */}
      {isDropTarget && dropZone && (
        <div
          className="drop-zone-overlay"
          style={{
            position: 'absolute',
            pointerEvents: 'none',
            zIndex: 200,
            background: 'rgba(13,148,136,0.10)',
            border: '2px solid rgba(13,148,136,0.70)',
            borderRadius: 6,
            boxShadow: '0 0 12px rgba(13,148,136,0.18)',
            backdropFilter: 'blur(2px)',
            ...ZONE_STYLE[dropZone],
          }}
        />
      )}

      {/* Edge indicator arrows while dragging over this panel */}
      {isDropTarget && dropZone && (
        <DropArrow zone={dropZone} />
      )}
    </div>
  );
}

// ─── DropArrow – small directional arrow shown in drop zone ──────────────────

function DropArrow({ zone }: { zone: DropZone }) {
  const style: React.CSSProperties = {
    position: 'absolute',
    pointerEvents: 'none',
    zIndex: 201,
    color: 'rgba(13,148,136,1)',
    fontSize: 20,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  };

  const arrowMap: Record<DropZone, { s: React.CSSProperties; char: string }> = {
    top:    { s: { top: '10%',   left: '50%', transform: 'translateX(-50%)' }, char: '▲' },
    bottom: { s: { bottom: '10%', left: '50%', transform: 'translateX(-50%)' }, char: '▼' },
    left:   { s: { left: '10%',  top: '50%',  transform: 'translateY(-50%)' }, char: '◀' },
    right:  { s: { right: '10%', top: '50%',  transform: 'translateY(-50%)' }, char: '▶' },
  };

  const { s, char } = arrowMap[zone];
  return <div style={{ ...style, ...s, color: '#0d9488' }}>{char}</div>;
}

// ─── RenderSplit ──────────────────────────────────────────────────────────────

function RenderSplit({ node, dragState, panelRenderers, registerLeaf, onStartDrag, onSplitResize }: NodeProps & { node: SplitNode }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isH = node.direction === 'h';

  return (
    <div
      ref={containerRef}
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: isH ? 'row' : 'column',
        minWidth: 0,
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      {node.children.map((child, idx) => (
        <React.Fragment key={child.id}>
          {/* Child wrapper – flex value acts as the size ratio */}
          <div
            style={{
              flex: node.sizes[idx],
              display: 'flex',
              flexDirection: isH ? 'column' : 'row',
              minWidth: 0,
              minHeight: 0,
              overflow: 'hidden',
            }}
          >
            <RenderNode
              node={child}
              dragState={dragState}
              panelRenderers={panelRenderers}
              registerLeaf={registerLeaf}
              onStartDrag={onStartDrag}
              onSplitResize={onSplitResize}
            />
          </div>

          {/* Resize handle between siblings */}
          {idx < node.children.length - 1 && (
            <ResizeHandle
              direction={node.direction}
              splitId={node.id}
              idx={idx}
              containerRef={containerRef}
              onSplitResize={onSplitResize}
            />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

// ─── ResizeHandle ─────────────────────────────────────────────────────────────

function ResizeHandle({
  direction,
  splitId,
  idx,
  containerRef,
  onSplitResize,
}: {
  direction: 'h' | 'v';
  splitId: string;
  idx: number;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onSplitResize: (splitId: string, idx: number, direction: 'h' | 'v', container: HTMLElement, e: React.MouseEvent) => void;
}) {
  const isH = direction === 'h';
  return (
    <div
      onMouseDown={(e) => {
        if (containerRef.current) onSplitResize(splitId, idx, direction, containerRef.current, e);
      }}
      style={{
        flexShrink: 0,
        width:  isH ? 5 : '100%',
        height: isH ? '100%' : 5,
        background: 'rgba(15,23,42,0.06)',
        cursor: isH ? 'col-resize' : 'row-resize',
        transition: 'background 0.12s',
        zIndex: 10,
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLElement;
        el.style.background = 'rgba(13,148,136,0.35)';
        el.style.boxShadow = isH ? '0 0 6px rgba(13,148,136,0.25)' : '0 0 6px rgba(13,148,136,0.25)';
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLElement;
        el.style.background = 'rgba(15,23,42,0.06)';
        el.style.boxShadow = '';
      }}
    />
  );
}

// ─── Grip icon ────────────────────────────────────────────────────────────────

function GripDots() {
  return (
    <svg width="14" height="8" viewBox="0 0 14 8" fill="rgba(15,23,42,0.35)" style={{ flexShrink: 0 }}>
      <circle cx="2"  cy="2" r="1.3" />
      <circle cx="7"  cy="2" r="1.3" />
      <circle cx="12" cy="2" r="1.3" />
      <circle cx="2"  cy="6" r="1.3" />
      <circle cx="7"  cy="6" r="1.3" />
      <circle cx="12" cy="6" r="1.3" />
    </svg>
  );
}
