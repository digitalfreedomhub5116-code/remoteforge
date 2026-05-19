import { useState, useEffect, useRef } from 'react';
import type { Device, Command } from '../App';

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

/* ---- Quick Actions ---- */
const QUICK_ACTIONS = [
  { icon: '📸', label: 'Screenshot', cmd: 'Take a screenshot' },
  { icon: '💻', label: 'System Info', cmd: 'Show system info' },
  { icon: '🚀', label: 'Open App', cmd: 'Open an app' },
  { icon: '📂', label: 'Files', cmd: 'Organize files' },
];

interface Props {
  device: Device;
  devices: Device[];
  commands: Command[];
  streamedIds: Set<string>;
  chatEnd: React.RefObject<HTMLDivElement | null>;
  onSend: (input: string, mode: 'execute' | 'plan') => void;
  onConfirm: (id: string, yes: boolean) => void;
  onMarkStreamed: (id: string) => void;
  onSelectDevice: (id: string) => void;
}

export default function ChatScreen({
  device, devices, commands, streamedIds, chatEnd,
  onSend, onConfirm, onMarkStreamed, onSelectDevice
}: Props) {
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<'execute' | 'plan'>('execute');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 120) + 'px';
    }
  }, [input]);

  function handleSend() {
    if (!input.trim()) return;
    onSend(input, mode);
    setInput('');
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
            <div className="device-status">
              <span className={`status-dot ${device.is_online ? 'success' : 'error'}`} />
              <span>{device.is_online ? 'Online' : 'Offline'}</span>
            </div>
          </div>
        </div>
        <div className="chat-header-right">
          <div className="mode-toggle">
            <button className={mode === 'execute' ? 'active' : ''} onClick={() => setMode('execute')}>Execute</button>
            <button className={mode === 'plan' ? 'active' : ''} onClick={() => setMode('plan')}>Plan</button>
          </div>
        </div>
      </header>

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
            const isDone = cmd.status === 'completed' || cmd.status === 'failed';
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
                {cmd.status !== 'pending' && (
                  <div className="msg msg-ai">
                    <div className="ai-avatar">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8ab4f8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" />
                      </svg>
                    </div>
                    <div className="msg-bubble ai-bubble">
                      {isActive && (
                        <div className="thinking-dots">
                          <span /><span /><span />
                        </div>
                      )}
                      {cmd.result_stdout && !isActive && (
                        <StreamingText text={cmd.result_stdout} shouldAnimate={shouldStream} />
                      )}
                      {cmd.result_screenshot && (
                        <div className="msg-screenshot">
                          <img src={`data:image/png;base64,${cmd.result_screenshot}`} alt="Screenshot" />
                        </div>
                      )}
                      {cmd.result_stderr && !cmd.result_stdout && (
                        <p className="msg-error">{cmd.result_stderr}</p>
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

      {/* Input */}
      <div className="chat-input-bar">
        <div className="input-container">
          <textarea
            ref={inputRef}
            rows={1}
            placeholder="Ask JARVIS..."
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={!device.is_online}
          />
          {input.trim() && (
            <button className="send-btn" onClick={handleSend}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
