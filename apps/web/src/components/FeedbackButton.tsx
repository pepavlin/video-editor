'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

const WEBHOOK_URL = 'https://n8n.pavlin.dev/webhook/c6169b15-e4d2-4515-a059-4f6306819e1c';
const POLL_INTERVAL_MS = 15_000;

type Status = 'idle' | 'sending' | 'sent' | 'error';
type Tab = 'proposal' | 'tasks';
interface TaskStats { running: number; queued: number }
interface Task {
  status: string;
  id?: string;
  name?: string;
  title?: string;
  message?: string;
  description?: string;
  prompt?: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

const STATUS_COLORS: Record<string, { bg: string; border: string; color: string; dot: string }> = {
  running:   { bg: 'rgba(13,148,136,0.10)',  border: 'rgba(13,148,136,0.25)', color: '#0d9488', dot: '#0d9488' },
  queued:    { bg: 'rgba(250,180,50,0.10)',   border: 'rgba(250,180,50,0.30)',  color: '#b45309', dot: '#fab432' },
  waiting:   { bg: 'rgba(250,180,50,0.10)',   border: 'rgba(250,180,50,0.30)',  color: '#b45309', dot: '#fab432' },
  done:      { bg: 'rgba(34,197,94,0.10)',    border: 'rgba(34,197,94,0.25)',   color: '#15803d', dot: '#22c55e' },
  completed: { bg: 'rgba(34,197,94,0.10)',    border: 'rgba(34,197,94,0.25)',   color: '#15803d', dot: '#22c55e' },
  success:   { bg: 'rgba(34,197,94,0.10)',    border: 'rgba(34,197,94,0.25)',   color: '#15803d', dot: '#22c55e' },
  error:     { bg: 'rgba(239,68,68,0.10)',    border: 'rgba(239,68,68,0.25)',   color: '#b91c1c', dot: '#ef4444' },
  failed:    { bg: 'rgba(239,68,68,0.10)',    border: 'rgba(239,68,68,0.25)',   color: '#b91c1c', dot: '#ef4444' },
};

const STATUS_LABELS: Record<string, string> = {
  running:   'Běží',
  queued:    'Čeká',
  waiting:   'Čeká',
  done:      'Hotovo',
  completed: 'Hotovo',
  success:   'Hotovo',
  error:     'Chyba',
  failed:    'Chyba',
};

function getStatusStyle(status: string) {
  return STATUS_COLORS[status.toLowerCase()] ?? {
    bg: 'rgba(100,116,139,0.10)',
    border: 'rgba(100,116,139,0.25)',
    color: '#475569',
    dot: '#94a3b8',
  };
}

function getStatusLabel(status: string) {
  return STATUS_LABELS[status.toLowerCase()] ?? status;
}

function getTaskLabel(task: Task): string {
  return task.name ?? task.title ?? task.description ?? task.message ?? task.prompt ?? 'Bez názvu';
}

function formatTime(dateStr?: string): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export default function FeedbackButton() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('proposal');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [taskStats, setTaskStats] = useState<TaskStats>({ running: 0, queued: 0 });
  const [tasks, setTasks] = useState<Task[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(WEBHOOK_URL, { method: 'GET' });
      if (!res.ok) return;
      const data = await res.json();
      const rawTasks: Task[] = data.tasks ?? [];
      setTasks(rawTasks);
      setTaskStats({
        running: rawTasks.filter((t) => t.status === 'running').length,
        queued: rawTasks.filter((t) => ['queued', 'waiting'].includes(t.status)).length,
      });
    } catch {
      // silently ignore
    }
  }, []);

  useEffect(() => {
    if (open && tab === 'proposal' && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [open, tab]);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  useEffect(() => {
    fetchStats();
    const id = setInterval(fetchStats, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchStats]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!message.trim() || status === 'sending') return;
    setStatus('sending');
    try {
      const res = await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: message.trim() }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus('sent');
      setMessage('');
      fetchStats();
      setTimeout(() => {
        setStatus('idle');
        setOpen(false);
      }, 2500);
    } catch {
      setStatus('error');
      setTimeout(() => setStatus('idle'), 3000);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleSubmit(e as unknown as React.FormEvent);
    }
    if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  const hasActive = taskStats.running > 0 || taskStats.queued > 0;

  return (
    <>
      {/* Task status pill — shown above the button when there are active tasks */}
      {hasActive && (
        <div
          style={{
            position: 'fixed',
            bottom: '88px',
            right: '14px',
            zIndex: 9999,
            display: 'flex',
            gap: '6px',
            pointerEvents: 'none',
          }}
        >
          {taskStats.running > 0 && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                background: 'rgba(255,255,255,0.95)',
                border: '1px solid rgba(13,148,136,0.28)',
                borderRadius: '20px',
                padding: '3px 9px 3px 7px',
                fontSize: '11px',
                fontWeight: 600,
                color: '#0d9488',
                backdropFilter: 'blur(12px)',
                whiteSpace: 'nowrap',
              }}
            >
              <span
                style={{
                  width: '7px',
                  height: '7px',
                  borderRadius: '50%',
                  background: '#0d9488',
                  display: 'inline-block',
                  animation: 'taskPulse 1.4s ease-in-out infinite',
                  flexShrink: 0,
                }}
              />
              {taskStats.running} běží
            </span>
          )}
          {taskStats.queued > 0 && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                background: 'rgba(255,255,255,0.95)',
                border: '1px solid rgba(250,180,50,0.40)',
                borderRadius: '20px',
                padding: '3px 9px 3px 7px',
                fontSize: '11px',
                fontWeight: 600,
                color: '#fab432',
                backdropFilter: 'blur(12px)',
                whiteSpace: 'nowrap',
              }}
            >
              <span
                style={{
                  width: '7px',
                  height: '7px',
                  borderRadius: '50%',
                  background: '#fab432',
                  display: 'inline-block',
                  flexShrink: 0,
                  opacity: 0.85,
                }}
              />
              {taskStats.queued} čeká
            </span>
          )}
        </div>
      )}

      {/* Floating trigger button */}
      <button
        onClick={() => {
          setOpen((v) => !v);
          if (status === 'sent' || status === 'error') setStatus('idle');
        }}
        title="Navrhnout zlepšení"
        aria-label="Napsat návrh"
        style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          zIndex: 9999,
          width: '52px',
          height: '52px',
          borderRadius: '50%',
          background: open
            ? '#0f766e'
            : '#0d9488',
          border: '1px solid rgba(13,148,136,0.25)',
          boxShadow: open
            ? '0 4px 16px rgba(13,148,136,0.40)'
            : '0 2px 8px rgba(13,148,136,0.25), 0 1px 4px rgba(15,23,42,0.08)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'all 0.18s cubic-bezier(0.4,0,0.2,1)',
          transform: open ? 'scale(1.06)' : 'scale(1)',
          color: '#ffffff',
        }}
      >
        {open ? (
          /* Close X */
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/>
          </svg>
        ) : (
          /* Lightbulb / idea icon */
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 2a7 7 0 0 1 5 11.9V16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1v-2.1A7 7 0 0 1 12 2z"
              fill="currentColor"
              opacity="0.9"
            />
            <rect x="8.5" y="18" width="7" height="1.5" rx="0.75" fill="currentColor" opacity="0.7"/>
            <rect x="9.5" y="20.5" width="5" height="1.5" rx="0.75" fill="currentColor" opacity="0.5"/>
          </svg>
        )}
        {/* Notification badge — total active tasks */}
        {hasActive && (
          <span
            style={{
              position: 'absolute',
              top: '-4px',
              right: '-4px',
              minWidth: '18px',
              height: '18px',
              borderRadius: '9px',
              background: taskStats.running > 0 ? '#0d9488' : '#d97706',
              color: '#ffffff',
              fontSize: '10px',
              fontWeight: 800,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 4px',
              border: '2px solid rgba(255,255,255,0.90)',
              lineHeight: 1,
              animation: taskStats.running > 0 ? 'taskPulse 1.4s ease-in-out infinite' : 'none',
            }}
          >
            {taskStats.running + taskStats.queued}
          </span>
        )}
      </button>

      {/* Panel */}
      {open && (
        <div
          ref={panelRef}
          style={{
            position: 'fixed',
            bottom: '88px',
            right: '24px',
            zIndex: 9998,
            width: '340px',
            borderRadius: '16px',
            background: 'rgba(255, 255, 255, 0.97)',
            backdropFilter: 'blur(24px) saturate(1.4)',
            WebkitBackdropFilter: 'blur(24px) saturate(1.4)',
            border: '1px solid rgba(15,23,42,0.08)',
            boxShadow: '0 4px 24px rgba(15,23,42,0.12), 0 1px 4px rgba(15,23,42,0.06)',
            animation: 'feedbackPanelIn 0.22s cubic-bezier(0.4,0,0.2,1) forwards',
            overflow: 'hidden',
          }}
        >
          {/* Tabs */}
          <div
            style={{
              display: 'flex',
              borderBottom: '1px solid rgba(15,23,42,0.07)',
              padding: '0 4px',
            }}
          >
            <button
              onClick={() => setTab('proposal')}
              role="tab"
              aria-selected={tab === 'proposal'}
              style={{
                flex: 1,
                padding: '12px 8px 10px',
                fontSize: '13px',
                fontWeight: tab === 'proposal' ? 700 : 500,
                color: tab === 'proposal' ? '#0d9488' : 'rgba(15,23,42,0.45)',
                background: 'none',
                border: 'none',
                borderBottom: tab === 'proposal' ? '2px solid #0d9488' : '2px solid transparent',
                cursor: 'pointer',
                transition: 'all 0.15s',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                <path
                  d="M12 2a7 7 0 0 1 5 11.9V16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1v-2.1A7 7 0 0 1 12 2z"
                  fill="currentColor" opacity="0.85"
                />
                <rect x="8.5" y="18" width="7" height="1.5" rx="0.75" fill="currentColor" opacity="0.6"/>
                <rect x="9.5" y="20.5" width="5" height="1.5" rx="0.75" fill="currentColor" opacity="0.4"/>
              </svg>
              Návrh
            </button>
            <button
              onClick={() => setTab('tasks')}
              role="tab"
              aria-selected={tab === 'tasks'}
              style={{
                flex: 1,
                padding: '12px 8px 10px',
                fontSize: '13px',
                fontWeight: tab === 'tasks' ? 700 : 500,
                color: tab === 'tasks' ? '#0d9488' : 'rgba(15,23,42,0.45)',
                background: 'none',
                border: 'none',
                borderBottom: tab === 'tasks' ? '2px solid #0d9488' : '2px solid transparent',
                cursor: 'pointer',
                transition: 'all 0.15s',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                position: 'relative',
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                <rect x="3" y="5" width="18" height="2.5" rx="1.25" fill="currentColor" opacity="0.85"/>
                <rect x="3" y="11" width="14" height="2.5" rx="1.25" fill="currentColor" opacity="0.85"/>
                <rect x="3" y="17" width="10" height="2.5" rx="1.25" fill="currentColor" opacity="0.85"/>
              </svg>
              Poslední tasky
              {hasActive && (
                <span
                  style={{
                    minWidth: '16px',
                    height: '16px',
                    borderRadius: '8px',
                    background: taskStats.running > 0 ? '#0d9488' : '#d97706',
                    color: '#fff',
                    fontSize: '9px',
                    fontWeight: 800,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '0 3px',
                    lineHeight: 1,
                    animation: taskStats.running > 0 ? 'taskPulse 1.4s ease-in-out infinite' : 'none',
                  }}
                >
                  {taskStats.running + taskStats.queued}
                </span>
              )}
            </button>
          </div>

          {/* Tab: Návrh */}
          {tab === 'proposal' && (
            <div style={{ padding: '12px 16px 14px' }}>
              {status === 'sent' ? (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '20px 0',
                    color: '#0d9488',
                    textAlign: 'center',
                  }}
                >
                  <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
                    <circle cx="18" cy="18" r="17" stroke="#0d9488" strokeWidth="2" opacity="0.4"/>
                    <path d="M11 18l5 5 9-9" stroke="#0d9488" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  <span style={{ fontWeight: 600, fontSize: '14px' }}>
                    Návrh byl poslán k implementaci
                  </span>
                </div>
              ) : (
                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <textarea
                    ref={textareaRef}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Jak bychom mohli tuto stránku zlepšit?"
                    rows={4}
                    disabled={status === 'sending'}
                    style={{
                      resize: 'none',
                      background: '#ffffff',
                      border: '1px solid rgba(15,23,42,0.12)',
                      borderRadius: '10px',
                      padding: '10px 12px',
                      fontSize: '13px',
                      color: '#0f172a',
                      outline: 'none',
                      width: '100%',
                      transition: 'border-color 0.15s, box-shadow 0.15s',
                      fontFamily: 'inherit',
                    }}
                    onFocus={(e) => {
                      e.target.style.borderColor = 'rgba(13,148,136,0.50)';
                      e.target.style.boxShadow = '0 0 0 3px rgba(13,148,136,0.10)';
                      e.target.style.background = '#ffffff';
                    }}
                    onBlur={(e) => {
                      e.target.style.borderColor = 'rgba(15,23,42,0.12)';
                      e.target.style.boxShadow = 'none';
                      e.target.style.background = '#ffffff';
                    }}
                  />
                  {status === 'error' && (
                    <p style={{ color: '#ff6b6b', fontSize: '12px', margin: 0 }}>
                      Nepodařilo se odeslat návrh. Zkuste to znovu.
                    </p>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                    <span style={{ color: 'rgba(15,23,42,0.38)', fontSize: '11px' }}>Ctrl+Enter pro odeslání</span>
                    <button
                      type="submit"
                      disabled={!message.trim() || status === 'sending'}
                      style={{
                        background:
                          !message.trim() || status === 'sending'
                            ? 'rgba(13,148,136,0.20)'
                            : '#0d9488',
                        border: '1px solid rgba(13,148,136,0.25)',
                        borderRadius: '9px',
                        padding: '9px 16px',
                        fontSize: '13px',
                        fontWeight: 700,
                        color: !message.trim() || status === 'sending' ? 'rgba(13,148,136,0.45)' : '#ffffff',
                        cursor: !message.trim() || status === 'sending' ? 'not-allowed' : 'pointer',
                        transition: 'all 0.15s',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {status === 'sending' ? (
                        <>
                          <svg width="14" height="14" viewBox="0 0 14 14" style={{ animation: 'spin 0.8s linear infinite' }}>
                            <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="20 15" fill="none"/>
                          </svg>
                          Odesílám…
                        </>
                      ) : (
                        <>
                          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                            <path d="M1 7h12M8 2l5 5-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                          Odeslat návrh
                        </>
                      )}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* Tab: Poslední tasky */}
          {tab === 'tasks' && (
            <div style={{ padding: '8px 0 6px' }}>
              {tasks.length === 0 ? (
                <div
                  style={{
                    padding: '28px 16px',
                    textAlign: 'center',
                    color: 'rgba(15,23,42,0.35)',
                    fontSize: '13px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '10px',
                  }}
                >
                  <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                    <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="1.5" opacity="0.3"/>
                    <path d="M10 16h12M16 10v12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.4"/>
                  </svg>
                  Žádné tasky
                </div>
              ) : (
                <ul
                  style={{
                    listStyle: 'none',
                    margin: 0,
                    padding: 0,
                    maxHeight: '260px',
                    overflowY: 'auto',
                  }}
                >
                  {[...tasks].sort((a, b) => {
                    const priority: Record<string, number> = {
                      running: 0,
                      queued: 1,
                      waiting: 1,
                      done: 2,
                      completed: 2,
                      success: 2,
                      error: 3,
                      failed: 3,
                    };
                    const ap = priority[(a.status ?? '').toLowerCase()] ?? 4;
                    const bp = priority[(b.status ?? '').toLowerCase()] ?? 4;
                    if (ap !== bp) return ap - bp;
                    // Within same priority, newer tasks first
                    const aTime = new Date(a.updatedAt ?? a.createdAt ?? 0).getTime();
                    const bTime = new Date(b.updatedAt ?? b.createdAt ?? 0).getTime();
                    return bTime - aTime;
                  }).map((task, idx, arr) => {
                    const st = getStatusStyle(task.status ?? '');
                    const label = getStatusLabel(task.status ?? '');
                    const isRunning = (task.status ?? '').toLowerCase() === 'running';
                    const timeStr = formatTime(task.updatedAt ?? task.createdAt);
                    return (
                      <li
                        key={task.id ?? idx}
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: '10px',
                          padding: '9px 16px',
                          borderBottom: idx < arr.length - 1 ? '1px solid rgba(15,23,42,0.05)' : 'none',
                        }}
                      >
                        {/* Status dot */}
                        <span
                          style={{
                            marginTop: '4px',
                            width: '8px',
                            height: '8px',
                            borderRadius: '50%',
                            background: st.dot,
                            flexShrink: 0,
                            animation: isRunning ? 'taskPulse 1.4s ease-in-out infinite' : 'none',
                          }}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            style={{
                              fontSize: '12.5px',
                              color: '#0f172a',
                              fontWeight: 500,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                            title={getTaskLabel(task)}
                          >
                            {getTaskLabel(task)}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '3px' }}>
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                background: st.bg,
                                border: `1px solid ${st.border}`,
                                borderRadius: '10px',
                                padding: '1px 7px',
                                fontSize: '10.5px',
                                fontWeight: 600,
                                color: st.color,
                              }}
                            >
                              {label}
                            </span>
                            {timeStr && (
                              <span style={{ fontSize: '10.5px', color: 'rgba(15,23,42,0.35)' }}>
                                {timeStr}
                              </span>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
              <div
                style={{
                  padding: '6px 16px 4px',
                  display: 'flex',
                  justifyContent: 'flex-end',
                }}
              >
                <button
                  onClick={() => fetchStats()}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '11px',
                    color: 'rgba(15,23,42,0.35)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '3px 0',
                    transition: 'color 0.15s',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = '#0d9488')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(15,23,42,0.35)')}
                >
                  <svg width="11" height="11" viewBox="0 0 20 20" fill="none">
                    <path d="M4 10a6 6 0 1 0 1-3.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                    <path d="M4 4v3.5H7.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  Obnovit
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <style>{`
        @keyframes feedbackPanelIn {
          from { opacity: 0; transform: translateY(12px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        @keyframes taskPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.6; transform: scale(1.15); }
        }
      `}</style>
    </>
  );
}
