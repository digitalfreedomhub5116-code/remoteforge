import { useEffect, useState, useRef } from 'react';
import { supabase } from './lib/supabase';

type Device = { id: string; device_name: string; is_online: boolean };
type Command = {
  id: string; raw_input: string; command_type: string; status: string;
  result_stdout?: string; result_stderr?: string; result_screenshot?: string;
  requires_confirmation?: boolean; parsed_command?: string; created_at: string;
};
type Mode = 'execute' | 'plan';
type PlanStep = { type: string; command: string; description: string; is_destructive: boolean; status?: string };
type Plan = { steps: PlanStep[]; summary: string };

// ---- Icons as inline SVGs ----
const SparkleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 2L14.09 8.26L20 9.27L15.55 13.97L16.91 20L12 16.9L7.09 20L8.45 13.97L4 9.27L9.91 8.26L12 2Z" fill="url(#grad)" /><defs><linearGradient id="grad" x1="4" y1="2" x2="20" y2="20"><stop stopColor="#8ab4f8" /><stop offset="1" stopColor="#d7aefb" /></linearGradient></defs></svg>
);
const SendIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
);

// ---- Status Badge ----
function StatusBadge({ status }: { status: string }) {
  const m: Record<string, { icon: string; label: string; cls: string }> = {
    pending:    { icon: '◌', label: 'Queued',    cls: 'text-text-muted' },
    processing: { icon: '✦', label: 'Thinking',  cls: 'text-blue' },
    executing:  { icon: '⚡', label: 'Running',   cls: 'text-cyan' },
    completed:  { icon: '✓', label: 'Done',      cls: 'text-green' },
    failed:     { icon: '✗', label: 'Failed',    cls: 'text-red' },
    cancelled:  { icon: '—', label: 'Cancelled', cls: 'text-text-dim' },
    awaiting_confirmation: { icon: '⚠', label: 'Approve?', cls: 'text-orange' },
    planning:   { icon: '📋', label: 'Planning',  cls: 'text-purple' },
    plan_ready: { icon: '📋', label: 'Plan Ready', cls: 'text-purple' },
  };
  const s = m[status] || m.pending;
  return <span className={`inline-flex items-center gap-1 text-xs font-medium ${s.cls}`}><span>{s.icon}</span> {s.label}</span>;
}

export default function App() {
  const [session, setSession] = useState<any>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');

  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
  const [commands, setCommands] = useState<Command[]>([]);
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<Mode>('execute');
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [selectedModel, setSelectedModel] = useState('Gemini 2.0 Flash');

  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const models = ['Gemini 2.0 Flash', 'Gemini 2.5 Pro', 'GPT-4o', 'Claude Opus'];

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => { if (session) loadDevices(); }, [session]);

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

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [commands]);

  // Auto-resize textarea
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 120) + 'px';
    }
  }, [input]);

  async function loadDevices() {
    const { data } = await supabase.from('devices').select('id, device_name, is_online').eq('device_type', 'pc').order('is_online', { ascending: false });
    if (data) { setDevices(data); if (data.length > 0 && !selectedDevice) setSelectedDevice(data[0].id); }
  }

  async function loadCommands() {
    const { data } = await supabase.from('commands').select('*').eq('pc_device_id', selectedDevice).order('created_at', { ascending: true }).limit(50);
    if (data) setCommands(data);
  }

  async function handleAuth(e: React.FormEvent) {
    e.preventDefault(); setAuthLoading(true); setAuthError('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setAuthError(error.message);
    setAuthLoading(false);
  }

  async function sendCommand(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!input.trim() || !selectedDevice) return;
    const raw = input.trim();
    setInput('');

    await supabase.from('commands').insert({
      user_id: session.user.id,
      pc_device_id: selectedDevice,
      raw_input: raw,
      command_type: mode === 'plan' ? 'plan' : 'execute',
      parsed_command: null,
      status: 'pending',
    });
  }

  async function implementPlan(commandId: string) {
    await supabase.from('commands').update({
      status: 'pending',
      command_type: 'execute_plan',
    }).eq('id', commandId);
  }

  async function confirmCommand(id: string, yes: boolean) {
    if (yes) await supabase.from('commands').update({ status: 'pending', requires_confirmation: false, confirmed_at: new Date().toISOString() }).eq('id', id);
    else await supabase.from('commands').update({ status: 'cancelled' }).eq('id', id);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendCommand(); }
  }

  function tryParsePlan(stdout: string): Plan | null {
    try {
      const parsed = JSON.parse(stdout);
      if (parsed.steps && Array.isArray(parsed.steps)) return parsed;
    } catch { /* not a plan */ }
    return null;
  }

  // ========== LOGIN ==========
  if (!session) {
    return (
      <div className="flex items-center justify-center h-full bg-bg-deep px-6">
        <div className="w-full max-w-[360px]">
          <div className="flex flex-col items-center mb-10">
            <div className="w-14 h-14 bg-surface-2 rounded-full flex items-center justify-center mb-4" style={{ boxShadow: '0 0 30px rgba(138,180,248,0.15)' }}>
              <SparkleIcon />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">RemoteForge</h1>
            <p className="text-text-muted text-sm mt-1">AI-powered PC control</p>
          </div>

          <form onSubmit={handleAuth} className="space-y-3">
            <input type="email" placeholder="Email" autoComplete="email"
              className="w-full bg-surface border border-border rounded-2xl px-4 py-3 text-sm text-text focus:border-blue transition-colors placeholder:text-text-dim"
              value={email} onChange={e => setEmail(e.target.value)} />
            <input type="password" placeholder="Password" autoComplete="current-password"
              className="w-full bg-surface border border-border rounded-2xl px-4 py-3 text-sm text-text focus:border-blue transition-colors placeholder:text-text-dim"
              value={password} onChange={e => setPassword(e.target.value)} />
            {authError && <p className="text-red text-xs px-1">{authError}</p>}
            <button disabled={authLoading}
              className="w-full bg-blue text-bg-deep font-semibold rounded-2xl py-3 text-sm hover:brightness-110 active:scale-[0.98] transition-all disabled:opacity-50 cursor-pointer">
              {authLoading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ========== MAIN CHAT ==========
  const dev = devices.find(d => d.id === selectedDevice);

  return (
    <div className="flex flex-col h-full bg-bg-deep safe-top safe-bottom">
      {/* ---- HEADER ---- */}
      <header className="flex items-center justify-between px-4 py-2.5 shrink-0">
        <div className="flex items-center gap-2 relative">
          {/* Model selector */}
          <button onClick={() => setShowModelMenu(!showModelMenu)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-surface transition-colors cursor-pointer">
            <SparkleIcon />
            <span className="text-sm font-medium text-text-secondary">{selectedModel}</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-dim"><polyline points="6 9 12 15 18 9" /></svg>
          </button>
          {showModelMenu && (
            <div className="absolute top-10 left-0 bg-surface-2 border border-border rounded-xl py-1 shadow-2xl z-50 min-w-[180px]">
              {models.map(m => (
                <button key={m} onClick={() => { setSelectedModel(m); setShowModelMenu(false); }}
                  className={`w-full text-left px-4 py-2.5 text-sm hover:bg-surface-hover transition-colors cursor-pointer ${m === selectedModel ? 'text-blue' : 'text-text-secondary'}`}>
                  {m === selectedModel && '✓ '}{m}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Device status */}
        {devices.length > 0 ? (
          <div className="flex items-center gap-1.5 text-xs text-text-muted">
            <span className={`w-1.5 h-1.5 rounded-full ${dev?.is_online ? 'bg-green' : 'bg-red'}`} />
            <select className="bg-transparent text-text-secondary text-xs outline-none cursor-pointer"
              value={selectedDevice || ''} onChange={e => setSelectedDevice(e.target.value)}>
              {devices.map(d => <option key={d.id} value={d.id} style={{ background: '#1e1f20' }}>{d.device_name}</option>)}
            </select>
          </div>
        ) : <span className="text-[10px] text-red">No PCs</span>}
      </header>

      {/* ---- CHAT ---- */}
      <main className="flex-1 overflow-y-auto px-4 py-2">
        {/* Empty state */}
        {commands.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <div className="w-12 h-12 rounded-full bg-surface flex items-center justify-center">
              <SparkleIcon />
            </div>
            <h2 className="text-lg font-semibold text-text">What can I do for you?</h2>
            <p className="text-text-muted text-sm text-center max-w-[280px]">Control your PC with natural language. Try one of these:</p>
            <div className="grid grid-cols-2 gap-2 w-full max-w-[300px]">
              {[
                { icon: '📸', text: 'Take a screenshot' },
                { icon: '📂', text: 'Organize my desktop' },
                { icon: '💻', text: 'Show system info' },
                { icon: '⌨️', text: 'Type in notepad' },
              ].map(s => (
                <button key={s.text} onClick={() => setInput(s.text)}
                  className="flex items-start gap-2 bg-surface border border-border rounded-xl p-3 text-left hover:bg-surface-2 transition-colors cursor-pointer group">
                  <span className="text-base">{s.icon}</span>
                  <span className="text-xs text-text-muted group-hover:text-text transition-colors leading-snug">{s.text}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Messages */}
        <div className="max-w-[680px] mx-auto space-y-6 py-4">
          {commands.map(cmd => {
            const plan = (cmd.status === 'plan_ready' || cmd.command_type === 'plan') && cmd.result_stdout ? tryParsePlan(cmd.result_stdout) : null;

            return (
              <div key={cmd.id} className="animate-fade-up">
                {/* ---- User message ---- */}
                <div className="flex justify-end mb-3">
                  <div className="bg-surface-2 px-4 py-2.5 rounded-2xl rounded-br-sm max-w-[85%]">
                    <p className="text-sm text-text leading-relaxed">{cmd.raw_input}</p>
                  </div>
                </div>

                {/* ---- AI response ---- */}
                {cmd.status !== 'pending' && (
                  <div className="flex gap-2.5">
                    {/* Avatar */}
                    <div className="w-7 h-7 rounded-full bg-surface-2 flex items-center justify-center shrink-0 mt-0.5">
                      <SparkleIcon />
                    </div>

                    <div className="flex-1 min-w-0">
                      {/* Status */}
                      <div className="mb-1.5">
                        <StatusBadge status={cmd.status} />
                        {cmd.parsed_command && <span className="text-xs text-text-dim ml-2">{cmd.parsed_command}</span>}
                      </div>

                      {/* Thinking animation */}
                      {(cmd.status === 'processing' || cmd.status === 'executing' || cmd.status === 'planning') && (
                        <div className="thinking-dots py-2"><span /><span /><span /></div>
                      )}

                      {/* ---- PLAN VIEW ---- */}
                      {plan && (
                        <div className="bg-surface border border-border rounded-xl overflow-hidden mt-2">
                          <div className="px-4 py-3 border-b border-border bg-surface-2/50">
                            <h3 className="text-sm font-semibold text-text flex items-center gap-2">📋 Execution Plan</h3>
                            <p className="text-xs text-text-muted mt-0.5">{plan.summary}</p>
                          </div>
                          <div className="p-3 space-y-1">
                            {plan.steps.map((step: PlanStep, i: number) => (
                              <div key={i} className={`plan-step pl-3 py-2 ${step.status === 'done' ? 'done' : step.status === 'active' ? 'active' : ''}`}>
                                <div className="flex items-start gap-2">
                                  <span className="text-xs text-text-dim font-mono mt-0.5">{i + 1}.</span>
                                  <div>
                                    <p className="text-sm text-text">{step.description}</p>
                                    <p className="text-[11px] text-text-dim font-mono mt-0.5">{step.type}: {step.command.length > 60 ? step.command.slice(0, 60) + '...' : step.command}</p>
                                    {step.is_destructive && <span className="text-[10px] text-orange mt-0.5 inline-block">⚠ Destructive</span>}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                          {cmd.status === 'plan_ready' && (
                            <div className="px-3 pb-3">
                              <button onClick={() => implementPlan(cmd.id)}
                                className="w-full bg-blue text-bg-deep font-semibold rounded-xl py-2.5 text-sm hover:brightness-110 active:scale-[0.98] transition-all cursor-pointer">
                                ▶ Implement Plan ({plan.steps.length} steps)
                              </button>
                            </div>
                          )}
                        </div>
                      )}

                      {/* ---- STDOUT (non-plan) ---- */}
                      {cmd.result_stdout && !plan && (
                        <pre className="font-mono text-[12px] text-text-secondary bg-surface rounded-xl p-3 overflow-x-auto whitespace-pre-wrap border border-border/50 leading-relaxed max-h-[250px] overflow-y-auto mt-1">
                          {cmd.result_stdout}
                        </pre>
                      )}

                      {/* ---- STDERR ---- */}
                      {cmd.result_stderr && (
                        <pre className="font-mono text-[11px] text-red/80 bg-red-glow rounded-xl p-3 overflow-x-auto whitespace-pre-wrap border border-red/15 leading-relaxed max-h-[150px] overflow-y-auto mt-2">
                          {cmd.result_stderr}
                        </pre>
                      )}

                      {/* ---- SCREENSHOT ---- */}
                      {cmd.result_screenshot && (
                        <div className="mt-2 rounded-xl overflow-hidden border border-border">
                          <img src={`data:image/png;base64,${cmd.result_screenshot}`} alt="Screenshot" className="w-full" />
                        </div>
                      )}

                      {/* ---- CONFIRM BUTTONS ---- */}
                      {cmd.requires_confirmation && cmd.status === 'awaiting_confirmation' && (
                        <div className="flex gap-2 mt-3">
                          <button onClick={() => confirmCommand(cmd.id, false)}
                            className="px-4 py-2 bg-surface-2 hover:bg-surface-3 text-text-muted rounded-xl text-xs font-medium transition-colors cursor-pointer">
                            Cancel
                          </button>
                          <button onClick={() => confirmCommand(cmd.id, true)}
                            className="px-4 py-2 bg-red-glow border border-red/20 hover:bg-red/15 text-red rounded-xl text-xs font-medium transition-colors cursor-pointer">
                            ⚠ Execute Anyway
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          <div ref={chatEndRef} />
        </div>
      </main>

      {/* ---- INPUT BAR ---- */}
      <div className="px-3 pb-3 pt-1 shrink-0 safe-bottom">
        <div className="max-w-[680px] mx-auto">
          {/* Input container */}
          <div className="bg-surface border border-border rounded-2xl focus-within:border-blue/30 transition-colors">
            {/* Textarea */}
            <div className="px-4 pt-3">
              <textarea ref={inputRef} rows={1} placeholder="Ask RemoteForge anything..."
                className="w-full bg-transparent text-sm text-text outline-none placeholder:text-text-dim resize-none leading-relaxed min-w-0"
                style={{ maxHeight: '120px' }}
                value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown}
                disabled={!selectedDevice} />
            </div>

            {/* Bottom toolbar */}
            <div className="flex items-center justify-between px-3 pb-2 pt-1">
              {/* Left: Mode toggle */}
              <div className="flex items-center gap-1 bg-surface-2 rounded-full p-0.5">
                <button onClick={() => setMode('execute')}
                  className={`px-3 py-1 rounded-full text-[11px] font-semibold transition-all cursor-pointer ${mode === 'execute' ? 'bg-blue text-bg-deep' : 'text-text-muted hover:text-text'}`}>
                  ⚡ Execute
                </button>
                <button onClick={() => setMode('plan')}
                  className={`px-3 py-1 rounded-full text-[11px] font-semibold transition-all cursor-pointer ${mode === 'plan' ? 'bg-purple text-bg-deep' : 'text-text-muted hover:text-text'}`}>
                  📋 Plan
                </button>
              </div>

              {/* Right: Send */}
              <button type="button" onClick={() => sendCommand()} disabled={!input.trim() || !selectedDevice}
                className="bg-surface-2 text-text-secondary p-2 rounded-full disabled:opacity-20 hover:bg-surface-3 active:scale-90 transition-all cursor-pointer">
                <SendIcon />
              </button>
            </div>
          </div>

          <p className="text-center text-[10px] text-text-dim mt-2">
            RemoteForge AI can make mistakes. Review actions before confirming.
          </p>
        </div>
      </div>

      {/* Model menu backdrop */}
      {showModelMenu && <div className="fixed inset-0 z-40" onClick={() => setShowModelMenu(false)} />}
    </div>
  );
}
