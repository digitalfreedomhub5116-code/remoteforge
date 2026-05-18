import { useEffect, useState, useRef, useCallback } from 'react';
import { supabase } from './lib/supabase';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
type Device = { id: string; device_name: string; is_online: boolean };
type Command = {
  id: string; raw_input: string; command_type: string; status: string;
  result_stdout?: string; result_stderr?: string; result_screenshot?: string;
  requires_confirmation?: boolean; parsed_command?: string; created_at: string;
};

/* ------------------------------------------------------------------ */
/*  SVG Icons (minimal, line-style)                                    */
/* ------------------------------------------------------------------ */
const ChevronDown = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="6 9 12 15 18 9" /></svg>
);
const ArrowUp = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" /></svg>
);

/* ------------------------------------------------------------------ */
/*  Streaming Text — words appear one by one                           */
/* ------------------------------------------------------------------ */
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
    <p className="text-[15px] text-text-2 leading-[1.7] whitespace-pre-wrap">
      {words.map((w, i) => (
        <span key={i} className={i >= count ? 'stream-word' : ''} style={i >= count ? { animationDelay: `${(i - count) * 25}ms` } : undefined}>
          {w}{i < words.length - 1 ? ' ' : ''}
        </span>
      ))}
    </p>
  );
}

/* ------------------------------------------------------------------ */
/*  Main App                                                           */
/* ------------------------------------------------------------------ */
export default function App() {
  // Auth
  const [session, setSession] = useState<any>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');

  // Data
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
  const [commands, setCommands] = useState<Command[]>([]);
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<'execute' | 'plan'>('execute');
  const [modelOpen, setModelOpen] = useState(false);
  const [model, setModel] = useState('Gemini 2.5 Flash');

  // Streaming tracker
  const [streamedIds, setStreamedIds] = useState<Set<string>>(new Set());

  const chatEnd = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const models = ['Gemini 2.5 Flash', 'Gemini 2.5 Pro', 'GPT-4o', 'Claude Sonnet'];

  /* ---- Auth ---- */
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  /* ---- Devices ---- */
  useEffect(() => { if (session) loadDevices(); }, [session]);
  async function loadDevices() {
    const { data } = await supabase.from('devices').select('id, device_name, is_online').eq('device_type', 'pc').order('is_online', { ascending: false });
    if (data) { setDevices(data); if (data.length > 0 && !selectedDevice) setSelectedDevice(data[0].id); }
  }

  /* ---- Commands ---- */
  useEffect(() => {
    if (!selectedDevice) return;
    loadCommands();
    const ch = supabase
      .channel(`cmds-${selectedDevice}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'commands', filter: `pc_device_id=eq.${selectedDevice}` }, (p) => {
        if (p.eventType === 'INSERT') setCommands(prev => [...prev, p.new as Command]);
        else if (p.eventType === 'UPDATE') setCommands(prev => prev.map(c => c.id === p.new.id ? p.new as Command : c));
      }).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [selectedDevice]);

  async function loadCommands() {
    const { data } = await supabase.from('commands').select('*').eq('pc_device_id', selectedDevice).order('created_at', { ascending: true }).limit(50);
    if (data) {
      setCommands(data);
      // Mark all existing commands as already streamed
      setStreamedIds(new Set(data.filter(c => c.status === 'completed' || c.status === 'failed').map(c => c.id)));
    }
  }

  /* ---- Scroll ---- */
  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: 'smooth' }); }, [commands]);

  /* ---- Auto-resize textarea ---- */
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 120) + 'px';
    }
  }, [input]);

  /* ---- Mark as streamed when animation would be done ---- */
  const markStreamed = useCallback((id: string) => {
    setStreamedIds(prev => new Set(prev).add(id));
  }, []);

  /* ---- Handlers ---- */
  async function handleAuth(e: React.FormEvent) {
    e.preventDefault(); setAuthLoading(true); setAuthError('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setAuthError(error.message);
    setAuthLoading(false);
  }

  async function send() {
    if (!input.trim() || !selectedDevice) return;
    const raw = input.trim();
    setInput('');
    await supabase.from('commands').insert({
      user_id: session.user.id, pc_device_id: selectedDevice,
      raw_input: raw, command_type: mode === 'plan' ? 'plan' : 'execute',
      parsed_command: null, status: 'pending',
    });
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }

  async function confirmCommand(id: string, yes: boolean) {
    if (yes) await supabase.from('commands').update({ status: 'pending', requires_confirmation: false, confirmed_at: new Date().toISOString() }).eq('id', id);
    else await supabase.from('commands').update({ status: 'cancelled' }).eq('id', id);
  }

  /* ================================================================ */
  /*  LOGIN                                                            */
  /* ================================================================ */
  if (!session) {
    return (
      <div className="flex items-center justify-center h-full px-8" style={{ background: '#131314' }}>
        <div className="w-full max-w-[340px]">
          <div className="text-center mb-12">
            <h1 className="text-[28px] font-medium tracking-tight text-text">RemoteForge</h1>
            <p className="text-text-muted text-[14px] mt-2">Sign in to control your PC</p>
          </div>
          <form onSubmit={handleAuth} className="space-y-4">
            <input type="email" placeholder="Email" autoComplete="email"
              className="w-full bg-surface border border-border rounded-xl px-4 py-3.5 text-[15px] text-text placeholder:text-text-dim focus:border-accent transition-colors"
              value={email} onChange={e => setEmail(e.target.value)} />
            <input type="password" placeholder="Password" autoComplete="current-password"
              className="w-full bg-surface border border-border rounded-xl px-4 py-3.5 text-[15px] text-text placeholder:text-text-dim focus:border-accent transition-colors"
              value={password} onChange={e => setPassword(e.target.value)} />
            {authError && <p className="text-red text-[13px] pl-1">{authError}</p>}
            <button disabled={authLoading}
              className="w-full bg-accent text-bg font-medium rounded-xl py-3.5 text-[15px] active:scale-[0.98] transition-all disabled:opacity-40 cursor-pointer">
              {authLoading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  /* ================================================================ */
  /*  MAIN CHAT                                                        */
  /* ================================================================ */
  const dev = devices.find(d => d.id === selectedDevice);

  return (
    <div className="flex flex-col h-full safe-t safe-b" style={{ background: '#131314' }}>

      {/* ---- HEADER ---- */}
      <header className="flex items-center justify-between px-5 h-[48px] shrink-0 border-b border-border">
        <div className="relative">
          <button onClick={() => setModelOpen(!modelOpen)}
            className="flex items-center gap-1.5 text-[14px] font-medium text-text-2 cursor-pointer hover:text-text transition-colors">
            {model}
            <ChevronDown />
          </button>
          {modelOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setModelOpen(false)} />
              <div className="absolute top-9 left-0 bg-surface border border-border rounded-xl py-1.5 shadow-2xl z-50 min-w-[170px]">
                {models.map(m => (
                  <button key={m} onClick={() => { setModel(m); setModelOpen(false); }}
                    className={`w-full text-left px-4 py-2.5 text-[13px] cursor-pointer transition-colors ${m === model ? 'text-accent font-medium' : 'text-text-2 hover:text-text hover:bg-surface-2'}`}>
                    {m}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="flex items-center gap-2 text-[12px] text-text-muted min-w-0 shrink overflow-hidden">
          <span className={`w-[6px] h-[6px] rounded-full shrink-0 ${dev?.is_online ? 'bg-green' : 'bg-red'}`} />
          {devices.length > 1 ? (
            <select className="bg-transparent text-text-muted text-[12px] outline-none cursor-pointer"
              value={selectedDevice || ''} onChange={e => setSelectedDevice(e.target.value)}>
              {devices.map(d => <option key={d.id} value={d.id} style={{ background: '#1e1f20' }}>{d.device_name}</option>)}
            </select>
          ) : (
            <span>{dev?.device_name || 'No device'}</span>
          )}
        </div>
      </header>

      {/* ---- CHAT AREA ---- */}
      <main className="flex-1 overflow-y-auto overflow-x-hidden">
        <div className="mx-auto px-4 py-6 overflow-hidden" style={{ maxWidth: '640px', wordBreak: 'break-word', overflowWrap: 'anywhere' }}>

          {/* Empty state */}
          {commands.length === 0 && (
            <div className="flex flex-col items-center justify-center" style={{ minHeight: 'calc(100vh - 200px)' }}>
              <h2 className="text-[22px] font-medium text-text mb-2">RemoteForge</h2>
              <p className="text-text-muted text-[14px] mb-8">What can I help you with?</p>
              <div className="flex flex-wrap justify-center gap-2">
                {['Take a screenshot', 'Show system info', 'Open an app', 'Organize files'].map(s => (
                  <button key={s} onClick={() => setInput(s)}
                    className="px-4 py-2 rounded-full border border-border text-[13px] text-text-muted hover:text-text hover:border-text-dim transition-colors cursor-pointer">
                    {s}
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

            // After streaming starts, mark it as streamed after a delay
            if (shouldStream && cmd.result_stdout) {
              const wordCount = cmd.result_stdout.split(' ').length;
              const delay = Math.min(wordCount * 10, 2000);
              setTimeout(() => markStreamed(cmd.id), delay);
            }

            return (
              <div key={cmd.id} className="mb-7 anim-fade-up">

                {/* ---- User message ---- */}
                <div className="flex justify-end mb-5">
                  <div style={{ maxWidth: '80%' }}>
                    <p className="text-[12px] text-text-muted mb-1.5 text-right font-medium">You</p>
                    <div className="bg-user-bg px-4 py-3 rounded-2xl rounded-br-md">
                      <p className="text-[15px] text-text leading-[1.55]">{cmd.raw_input}</p>
                    </div>
                  </div>
                </div>

                {/* ---- AI response ---- */}
                {cmd.status !== 'pending' && (
                  <div className="mb-1">
                    <p className="text-[12px] text-text-muted mb-2 font-medium">JARVIS</p>

                    {/* Thinking dots */}
                    {isActive && (
                      <div className="flex gap-1.5 py-1">
                        <span className="thinking-dot" />
                        <span className="thinking-dot" />
                        <span className="thinking-dot" />
                      </div>
                    )}

                    {/* Response text */}
                    {cmd.result_stdout && !isActive && (
                      <StreamingText
                        text={cmd.result_stdout}
                        shouldAnimate={shouldStream}
                      />
                    )}

                    {/* Screenshot */}
                    {cmd.result_screenshot && (
                      <div className="mt-3 rounded-xl overflow-hidden" style={{ boxShadow: '0 2px 12px rgba(0,0,0,0.3)' }}>
                        <img src={`data:image/png;base64,${cmd.result_screenshot}`} alt="Screenshot"
                          className="w-full block" style={{ maxHeight: '300px', objectFit: 'cover' }} />
                      </div>
                    )}

                    {/* Error (rare with JARVIS, but fallback) */}
                    {cmd.result_stderr && !cmd.result_stdout && (
                      <p className="text-[14px] text-red/70 leading-[1.6]">{cmd.result_stderr}</p>
                    )}

                    {/* Confirmation buttons */}
                    {cmd.requires_confirmation && cmd.status === 'awaiting_confirmation' && (
                      <div className="flex gap-3 mt-4">
                        <button onClick={() => confirmCommand(cmd.id, false)}
                          className="px-4 py-2 rounded-lg text-[13px] text-text-muted border border-border hover:border-text-dim transition-colors cursor-pointer">
                          Cancel
                        </button>
                        <button onClick={() => confirmCommand(cmd.id, true)}
                          className="px-4 py-2 rounded-lg text-[13px] text-red border border-red/20 hover:bg-red/10 transition-colors cursor-pointer">
                          Execute anyway
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          <div ref={chatEnd} />
        </div>
      </main>

      {/* ---- INPUT BAR ---- */}
      <div className="px-4 pb-3 pt-2 shrink-0 safe-b">
        <div className="max-w-[640px] mx-auto">
          {/* Input pill */}
          <div className="relative bg-surface border border-border rounded-3xl focus-within:border-accent/30 transition-colors">
            <textarea
              ref={inputRef}
              rows={1}
              placeholder="Ask JARVIS..."
              className="w-full bg-transparent text-[16px] text-text placeholder:text-text-dim resize-none leading-[1.5] pr-12 pl-4 py-3.5 rounded-3xl overflow-hidden"
              style={{ maxHeight: '120px' }}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={!selectedDevice}
            />
            {/* Send button */}
            {input.trim() && (
              <button onClick={send}
                className="absolute right-2 bottom-2 w-9 h-9 rounded-full bg-accent flex items-center justify-center text-bg cursor-pointer active:scale-90 transition-transform">
                <ArrowUp />
              </button>
            )}
          </div>

          {/* Mode toggle */}
          <div className="flex items-center justify-center gap-1 mt-2.5">
            <button onClick={() => setMode('execute')}
              className={`px-3 py-1 text-[12px] font-medium rounded-full transition-colors cursor-pointer ${mode === 'execute' ? 'text-accent bg-accent-soft' : 'text-text-dim hover:text-text-muted'}`}>
              Execute
            </button>
            <span className="text-text-dim text-[12px] select-none">|</span>
            <button onClick={() => setMode('plan')}
              className={`px-3 py-1 text-[12px] font-medium rounded-full transition-colors cursor-pointer ${mode === 'plan' ? 'text-accent bg-accent-soft' : 'text-text-dim hover:text-text-muted'}`}>
              Plan
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
