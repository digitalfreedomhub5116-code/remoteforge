import { useState, useEffect, useRef, useCallback } from 'react';
import type { Device, Command, ConnectionStatus } from '../App';

/* ---- Screenshot Viewer (fullscreen zoom) ---- */
function ScreenshotViewer({ src, onClose }: { src: string; onClose: () => void }) {
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const lastPinchDist = useRef<number | null>(null);
  const lastTap = useRef(0);
  const panStart = useRef<{ x: number; y: number } | null>(null);
  const translateStart = useRef({ x: 0, y: 0 });
  const imgRef = useRef<HTMLDivElement>(null);

  // Reset on open
  useEffect(() => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  }, [src]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      lastPinchDist.current = Math.hypot(dx, dy);
    } else if (e.touches.length === 1) {
      // Double-tap detection
      const now = Date.now();
      if (now - lastTap.current < 300) {
        // Toggle zoom
        setScale(prev => {
          const next = prev > 1 ? 1 : 2.5;
          if (next === 1) setTranslate({ x: 0, y: 0 });
          return next;
        });
        lastTap.current = 0;
      } else {
        lastTap.current = now;
      }
      // Pan start
      panStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      translateStart.current = { ...translate };
    }
  }, [translate]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2 && lastPinchDist.current !== null) {
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const delta = dist / lastPinchDist.current;
      lastPinchDist.current = dist;
      setScale(prev => Math.min(Math.max(prev * delta, 1), 5));
    } else if (e.touches.length === 1 && panStart.current && scale > 1) {
      const dx = e.touches[0].clientX - panStart.current.x;
      const dy = e.touches[0].clientY - panStart.current.y;
      setTranslate({
        x: translateStart.current.x + dx,
        y: translateStart.current.y + dy,
      });
    }
  }, [scale]);

  const handleTouchEnd = useCallback(() => {
    lastPinchDist.current = null;
    panStart.current = null;
    // Snap back if scale is ~1
    setScale(prev => {
      if (prev < 1.05) {
        setTranslate({ x: 0, y: 0 });
        return 1;
      }
      return prev;
    });
  }, []);

  return (
    <div className="screenshot-viewer-overlay" onClick={onClose}>
      <button className="screenshot-viewer-close" onClick={onClose} aria-label="Close">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
      <div
        ref={imgRef}
        className="screenshot-viewer-content"
        onClick={e => e.stopPropagation()}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <img
          src={src}
          alt="Screenshot full"
          draggable={false}
          style={{
            transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
            transition: lastPinchDist.current !== null ? 'none' : 'transform 0.2s ease',
          }}
        />
      </div>
    </div>
  );
}

/* ---- Streaming Text ---- */
function StreamingText({ text, shouldAnimate }: { text: string; shouldAnimate: boolean }) {
  const words = text.split(' ');
  const [count, setCount] = useState(shouldAnimate ? 0 : words.length);

  useEffect(() => {
    if (!shouldAnimate) { setCount(words.length); return; }
    let i = 0;
    const t = setInterval(() => {
      i += 3;
      if (i >= words.length) { setCount(words.length); clearInterval(t); }
      else setCount(i);
    }, 25);
    return () => clearInterval(t);
  }, [shouldAnimate, words.length]);

  return (
    <p className="msg-text">
      {words.map((w, i) => (
        <span key={i} className={i >= count ? 'stream-word' : ''} style={i >= count ? { animationDelay: `${(i - count) * 25}ms` } : undefined}>
          {w}{i < words.length - 1 ? ' ' : ''}
        </span>
      ))}
    </p>
  );
}

/* ---- Connection Status Label ---- */
function ConnectionLabel({ status, device, onRefresh }: { status: ConnectionStatus; device: Device; onRefresh?: () => void }) {
  if (status === 'connected') {
    return (
      <div className="device-status">
        <span className="status-dot success pulse-dot" />
        <span>Connected</span>
      </div>
    );
  }
  if (status === 'checking') {
    return (
      <div className="device-status checking">
        <span className="status-dot warning" />
        <span>Checking...</span>
      </div>
    );
  }

  // Offline — show how long ago
  const lastSeen = device.last_seen_at ? new Date(device.last_seen_at) : null;
  let ago = '';
  if (lastSeen) {
    const diff = Math.floor((Date.now() - lastSeen.getTime()) / 1000);
    if (diff < 60) ago = `${diff}s ago`;
    else if (diff < 3600) ago = `${Math.floor(diff / 60)}m ago`;
    else ago = `${Math.floor(diff / 3600)}h ago`;
  }

  return (
    <div className="device-status offline">
      <span className="status-dot error" />
      <span>Offline{ago ? ` · ${ago}` : ''}</span>
      {onRefresh && (
        <button className="reconnect-inline-btn" onClick={onRefresh}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
        </button>
      )}
    </div>
  );
}

/* ---- Quick Actions ---- */
const QUICK_ACTIONS = [
  { icon: '📸', label: 'Screenshot', cmd: 'Take a screenshot' },
  { icon: '💻', label: 'System Info', cmd: 'Show system info' },
  { icon: '🚀', label: 'Open App', cmd: 'Open an app' },
  { icon: '📂', label: 'Files', cmd: 'Organize files' },
];

/* ---- Command Timeout Tracker ---- */
const COMMAND_TIMEOUT_MS = 30000;

function useCommandTimeouts(commands: Command[]) {
  const [timedOutIds, setTimedOutIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const pending = commands.filter(c => c.status === 'pending');
    const timers: ReturnType<typeof setTimeout>[] = [];

    for (const cmd of pending) {
      const elapsed = Date.now() - new Date(cmd.created_at).getTime();
      const remaining = COMMAND_TIMEOUT_MS - elapsed;

      if (remaining <= 0) {
        setTimedOutIds(prev => new Set(prev).add(cmd.id));
      } else {
        const timer = setTimeout(() => {
          setTimedOutIds(prev => new Set(prev).add(cmd.id));
        }, remaining);
        timers.push(timer);
      }
    }

    // Clear timed-out status for commands that are no longer pending
    setTimedOutIds(prev => {
      const next = new Set(prev);
      for (const id of prev) {
        const cmd = commands.find(c => c.id === id);
        if (cmd && cmd.status !== 'pending') next.delete(id);
      }
      return next;
    });

    return () => timers.forEach(clearTimeout);
  }, [commands]);

  return timedOutIds;
}

interface Props {
  device: Device;
  devices: Device[];
  commands: Command[];
  streamedIds: Set<string>;
  chatEnd: React.RefObject<HTMLDivElement | null>;
  connectionStatus: ConnectionStatus;
  onSend: (input: string, mode: 'execute' | 'plan') => void;
  onConfirm: (id: string, yes: boolean) => void;
  onMarkStreamed: (id: string) => void;
  onSelectDevice: (id: string) => void;
  onRetry: (cmd: Command) => void;
  onCancel: (id: string) => void;
  onRefresh: () => void;
}

export default function ChatScreen({
  device, devices, commands, streamedIds, chatEnd, connectionStatus,
  onSend, onConfirm, onMarkStreamed, onSelectDevice, onRetry, onCancel, onRefresh
}: Props) {
  const [input, setInput] = useState('');
  const [viewingScreenshot, setViewingScreenshot] = useState<string | null>(null);
  const [mode, setMode] = useState<'execute' | 'plan'>('execute');
  const [showOfflineWarning, setShowOfflineWarning] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const timedOutIds = useCommandTimeouts(commands);

  // Single-command lock: find if any command is currently active
  const activeCommand = commands.find(c => 
    c.status === 'pending' || c.status === 'processing' || c.status === 'executing' || c.status === 'planning'
  );
  const isLocked = !!activeCommand;

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 120) + 'px';
    }
  }, [input]);

  function handleSend() {
    if (!input.trim() || isLocked) return;

    // Show offline warning if PC is offline
    if (connectionStatus === 'offline' && !showOfflineWarning) {
      setShowOfflineWarning(true);
      return;
    }

    setShowOfflineWarning(false);
    onSend(input, mode);
    setInput('');
  }

  function sendAnyway() {
    if (isLocked) return;
    setShowOfflineWarning(false);
    onSend(input, mode);
    setInput('');
  }

  function handleAbort() {
    if (activeCommand) {
      onCancel(activeCommand.id);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }

  return (
    <div className="chat-screen">
      {/* Header */}
      <header className="chat-header">
        <div className="chat-header-left">
          <div className="device-avatar">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="3" width="20" height="14" rx="2" /><line x1="2" y1="20" x2="22" y2="20" />
            </svg>
          </div>
          <div className="device-info">
            {devices.length > 1 ? (
              <select className="device-select" value={device.id} onChange={e => onSelectDevice(e.target.value)}>
                {devices.map(d => <option key={d.id} value={d.id}>{d.device_name}</option>)}
              </select>
            ) : (
              <span className="device-name">{device.device_name}</span>
            )}
            <ConnectionLabel status={connectionStatus} device={device} onRefresh={onRefresh} />
          </div>
        </div>
        <div className="chat-header-right">
          <div className="mode-toggle">
            <button className={mode === 'execute' ? 'active' : ''} onClick={() => setMode('execute')}>Execute</button>
            <button className={mode === 'plan' ? 'active' : ''} onClick={() => setMode('plan')}>Plan</button>
          </div>
        </div>
      </header>

      {/* Offline Banner with Reconnect */}
      {connectionStatus === 'offline' && (
        <div className="offline-banner">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>PC is offline</span>
          <button 
            className={`reconnect-btn ${reconnecting ? 'spinning' : ''}`}
            onClick={async () => {
              setReconnecting(true);
              await onRefresh();
              setTimeout(() => setReconnecting(false), 2000);
            }}
            disabled={reconnecting}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
            {reconnecting ? 'Checking...' : 'Reconnect'}
          </button>
        </div>
      )}

      {/* Messages */}
      <main className="chat-messages">
        <div className="chat-scroll">
          {/* Empty state */}
          {commands.length === 0 && (
            <div className="chat-empty">
              <div className="jarvis-avatar-lg">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#8ab4f8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
                </svg>
              </div>
              <h2>What can I do for you?</h2>
              <p>I can control your PC, run commands, take screenshots, and more.</p>
              <div className="quick-actions">
                {QUICK_ACTIONS.map(a => (
                  <button key={a.label} className="quick-action" onClick={() => { setInput(a.cmd); }}>
                    <span className="qa-icon">{a.icon}</span>
                    <span className="qa-label">{a.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Messages */}
          {commands.map((cmd) => {
            const isActive = cmd.status === 'processing' || cmd.status === 'executing' || cmd.status === 'planning';
            const isDone = cmd.status === 'completed' || cmd.status === 'failed' || cmd.status === 'cancelled';
            const isPending = cmd.status === 'pending';
            const isTimedOut = timedOutIds.has(cmd.id);
            const shouldStream = isDone && !streamedIds.has(cmd.id);

            if (shouldStream && cmd.result_stdout) {
              const wordCount = cmd.result_stdout.split(' ').length;
              const delay = Math.min(wordCount * 10, 2000);
              setTimeout(() => onMarkStreamed(cmd.id), delay);
            }

            return (
              <div key={cmd.id} className="msg-group anim-fade-up">
                {/* User message */}
                <div className="msg msg-user">
                  <div className="msg-bubble user-bubble">
                    <p>{cmd.raw_input}</p>
                  </div>
                </div>

                {/* AI response */}
                {isPending && !isTimedOut && (
                  <div className="msg msg-ai">
                    <div className="ai-avatar">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8ab4f8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" />
                      </svg>
                    </div>
                    <div className="msg-bubble ai-bubble">
                      <div className="thinking-dots">
                        <span /><span /><span />
                      </div>
                    </div>
                  </div>
                )}

                {/* Timed out - no response */}
                {isPending && isTimedOut && (
                  <div className="msg msg-ai">
                    <div className="ai-avatar warn">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                      </svg>
                    </div>
                    <div className="msg-bubble ai-bubble timeout-bubble">
                      <p className="msg-timeout-text">
                        {connectionStatus === 'offline'
                          ? '⚠️ Your PC is offline. This message will be delivered when it comes back online.'
                          : "⚠️ JARVIS didn't respond. The agent may be busy or restarting."
                        }
                      </p>
                      <div className="timeout-actions">
                        <button className="timeout-btn retry" onClick={() => onRetry(cmd)}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
                          Retry
                        </button>
                        <button className="timeout-btn cancel" onClick={() => onCancel(cmd.id)}>Cancel</button>
                      </div>
                    </div>
                  </div>
                )}

                {isActive && (
                  <div className="msg msg-ai">
                    <div className="ai-avatar">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8ab4f8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" />
                      </svg>
                    </div>
                    <div className="msg-bubble ai-bubble">
                      <div className="thinking-dots">
                        <span /><span /><span />
                      </div>
                    </div>
                  </div>
                )}

                {isDone && (
                  <div className="msg msg-ai">
                    <div className="ai-avatar">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8ab4f8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" />
                      </svg>
                    </div>
                    <div className="msg-bubble ai-bubble">
                      {cmd.result_stdout && (
                        <StreamingText text={cmd.result_stdout} shouldAnimate={shouldStream} />
                      )}
                      {cmd.result_screenshot && (
                        <div className="msg-screenshot" onClick={() => setViewingScreenshot(`data:image/png;base64,${cmd.result_screenshot}`)}>
                          <img src={`data:image/png;base64,${cmd.result_screenshot}`} alt="Screenshot" />
                          <div className="screenshot-tap-hint">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="11" y1="8" x2="11" y2="14" /><line x1="8" y1="11" x2="14" y2="11" /></svg>
                          </div>
                        </div>
                      )}
                      {cmd.result_stderr && !cmd.result_stdout && (
                        <p className="msg-error">{cmd.result_stderr}</p>
                      )}
                      {!cmd.result_stdout && !cmd.result_stderr && cmd.status === 'cancelled' && (
                        <p className="msg-cancelled">Cancelled</p>
                      )}
                      {cmd.requires_confirmation && cmd.status === 'awaiting_confirmation' && (
                        <div className="confirm-btns">
                          <button className="btn-cancel" onClick={() => onConfirm(cmd.id, false)}>Cancel</button>
                          <button className="btn-confirm" onClick={() => onConfirm(cmd.id, true)}>Execute</button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          <div ref={chatEnd} />
        </div>
      </main>

      {/* Offline Send Warning */}
      {showOfflineWarning && (
        <div className="offline-send-warning">
          <p>⚠️ Your PC is offline. Send anyway? It'll be delivered when the PC comes online.</p>
          <div className="offline-warning-actions">
            <button className="ow-btn send" onClick={sendAnyway}>Send Anyway</button>
            <button className="ow-btn cancel" onClick={() => setShowOfflineWarning(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Input */}
      <div className="chat-input-bar">
        {isLocked ? (
          <div className="input-locked">
            <div className="locked-indicator">
              <div className="locked-spinner" />
              <span>JARVIS is working...</span>
            </div>
            <button className="abort-btn" onClick={handleAbort}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
              Abort
            </button>
          </div>
        ) : (
          <div className="input-container">
            <textarea
              ref={inputRef}
              rows={1}
              placeholder="Ask JARVIS..."
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={onKeyDown}
            />
            {input.trim() && (
              <button className="send-btn" onClick={handleSend}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" />
                </svg>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Screenshot Zoom Viewer */}
      {viewingScreenshot && (
        <ScreenshotViewer src={viewingScreenshot} onClose={() => setViewingScreenshot(null)} />
      )}
    </div>
  );
}
