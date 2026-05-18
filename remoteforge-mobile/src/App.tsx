import { useEffect, useState, useRef } from 'react';
import { supabase } from './lib/supabase';

type Device = { id: string; device_name: string; is_online: boolean };
type Command = {
  id: string; raw_input: string; command_type: string; status: string;
  result_stdout?: string; result_stderr?: string; result_screenshot?: string;
  requires_confirmation?: boolean; parsed_command?: string; created_at: string;
};

function detectCommandType(input: string): { type: string; parsed: string } {
  const l = input.toLowerCase().trim();
  if (l.includes('screenshot') || l === 'ss') return { type: 'screenshot', parsed: 'screenshot' };
  if (l.includes('sysinfo') || l.includes('system info') || l.includes('system status')) return { type: 'system', parsed: 'sysinfo' };
  if (/^(open|launch|start)\s+/i.test(l)) return { type: 'app', parsed: input.replace(/^(open|launch|start)\s+/i, '').trim() };
  return { type: 'shell', parsed: input };
}

// ---- Status Pill ----
function StatusPill({ status }: { status: string }) {
  const map: Record<string, { icon: string; label: string; cls: string }> = {
    pending:    { icon: '◌', label: 'Sending',   cls: 'text-yellow bg-yellow/10 border-yellow/20' },
    processing: { icon: '⟳', label: 'Thinking',  cls: 'text-cyan bg-cyan-glow border-cyan/20' },
    executing:  { icon: '⚡', label: 'Running',   cls: 'text-cyan bg-cyan-glow border-cyan/20' },
    completed:  { icon: '✓', label: 'Done',      cls: 'text-green bg-green-glow border-green/20' },
    failed:     { icon: '✗', label: 'Failed',    cls: 'text-red bg-red-glow border-red/20' },
    cancelled:  { icon: '—', label: 'Cancelled', cls: 'text-text-muted bg-surface-2 border-border' },
    awaiting_confirmation: { icon: '⚠', label: 'Approve?', cls: 'text-orange bg-orange/10 border-orange/20' },
  };
  const s = map[status] || map.pending;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold tracking-widest uppercase border ${s.cls}`}>
      <span className="text-xs">{s.icon}</span>{s.label}
    </span>
  );
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
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
    const { type, parsed } = detectCommandType(input.trim());
    await supabase.from('commands').insert({ user_id: session.user.id, pc_device_id: selectedDevice, raw_input: input.trim(), command_type: type, parsed_command: parsed, status: 'pending' });
    setInput(''); inputRef.current?.focus();
  }

  async function confirmCommand(id: string, yes: boolean) {
    if (yes) await supabase.from('commands').update({ status: 'pending', requires_confirmation: false, confirmed_at: new Date().toISOString() }).eq('id', id);
    else await supabase.from('commands').update({ status: 'cancelled' }).eq('id', id);
  }

  // ========== LOGIN ==========
  if (!session) {
    return (
      <div className="flex items-center justify-center h-full bg-bg px-6">
        <div className="w-full max-w-[340px]">
          {/* Logo */}
          <div className="flex flex-col items-center mb-10">
            <div className="relative mb-5">
              <div className="absolute inset-0 bg-cyan/20 rounded-2xl blur-xl" style={{ animation: 'pulse-ring 3s ease-in-out infinite' }} />
              <div className="relative w-16 h-16 bg-surface-2 border border-border rounded-2xl flex items-center justify-center">
                <span className="text-2xl">⚡</span>
              </div>
            </div>
            <h1 className="text-2xl font-extrabold tracking-tight text-text">RemoteForge</h1>
            <p className="text-text-muted text-sm mt-1">Control your PC from anywhere</p>
          </div>

          {/* Form */}
          <form onSubmit={handleAuth} className="space-y-4">
            <div>
              <label className="block text-[11px] text-text-secondary mb-1.5 font-semibold tracking-wider uppercase">Email</label>
              <input type="email" placeholder="you@example.com" autoComplete="email"
                className="w-full bg-surface-2 border border-border rounded-xl px-4 py-3 text-sm text-text focus:border-cyan transition-colors placeholder:text-text-muted/60"
                value={email} onChange={e => setEmail(e.target.value)} />
            </div>
            <div>
              <label className="block text-[11px] text-text-secondary mb-1.5 font-semibold tracking-wider uppercase">Password</label>
              <input type="password" placeholder="••••••••" autoComplete="current-password"
                className="w-full bg-surface-2 border border-border rounded-xl px-4 py-3 text-sm text-text focus:border-cyan transition-colors placeholder:text-text-muted/60"
                value={password} onChange={e => setPassword(e.target.value)} />
            </div>

            {authError && <div className="bg-red-glow border border-red/20 rounded-xl px-4 py-2.5 text-red text-xs">{authError}</div>}

            <button disabled={authLoading}
              className="w-full bg-cyan text-bg font-bold rounded-xl py-3.5 text-sm hover:brightness-110 active:scale-[0.97] transition-all disabled:opacity-50 cursor-pointer">
              {authLoading ? 'Signing in...' : 'Login'}
            </button>
          </form>

          <p className="text-center text-text-muted text-xs mt-8">Secured by Supabase &amp; Gemini AI</p>
        </div>
      </div>
    );
  }

  // ========== MAIN APP ==========
  const dev = devices.find(d => d.id === selectedDevice);

  return (
    <div className="flex flex-col h-full bg-bg safe-top safe-bottom">
      {/* ---- HEADER ---- */}
      <header className="flex items-center justify-between px-4 py-3 bg-surface/90 backdrop-blur-xl border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-base">⚡</span>
          <span className="text-sm font-bold tracking-tight">RemoteForge</span>
        </div>
        {devices.length > 0 ? (
          <div className="flex items-center gap-1.5 bg-surface-2 border border-border rounded-lg px-2.5 py-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${dev?.is_online ? 'bg-green' : 'bg-red'}`} />
            <select className="bg-transparent text-text text-xs font-medium outline-none cursor-pointer max-w-[120px]"
              value={selectedDevice || ''} onChange={e => setSelectedDevice(e.target.value)}>
              {devices.map(d => <option key={d.id} value={d.id} style={{ background: '#111' }}>{d.device_name}</option>)}
            </select>
          </div>
        ) : (
          <span className="text-[10px] text-red font-medium">No PCs connected</span>
        )}
      </header>

      {/* ---- CHAT ---- */}
      <main className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* Empty state */}
        {commands.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-text-muted gap-4">
            <div className="w-16 h-16 rounded-2xl bg-surface-2 border border-border flex items-center justify-center text-2xl">🖥️</div>
            <div className="text-center">
              <p className="font-semibold text-sm text-text-secondary">Ready for commands</p>
              <p className="text-xs mt-1">Type anything to control your PC</p>
            </div>
            <div className="flex flex-wrap gap-2 justify-center mt-1 max-w-[280px]">
              {['open chrome', 'screenshot', 'sysinfo', 'list files on desktop'].map(cmd => (
                <button key={cmd} onClick={() => setInput(cmd)}
                  className="px-3 py-1.5 bg-surface-2 border border-border rounded-full text-[11px] text-text-muted hover:text-cyan hover:border-cyan-dim transition-colors cursor-pointer">
                  {cmd}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Messages */}
        {commands.map(cmd => (
          <div key={cmd.id} className="space-y-2 animate-fade-up">
            {/* User bubble */}
            <div className="flex justify-end">
              <div className="bg-cyan/10 border border-cyan/15 px-3.5 py-2 rounded-2xl rounded-br-md max-w-[80%]">
                <p className="font-mono text-[13px] text-cyan leading-snug">{cmd.raw_input}</p>
              </div>
            </div>

            {/* Agent response */}
            {cmd.status !== 'pending' && (
              <div className="flex justify-start">
                <div className="bg-surface border border-border rounded-2xl rounded-bl-md max-w-[88%] overflow-hidden">
                  {/* Status + AI summary */}
                  <div className="flex items-center gap-2 px-3.5 pt-2.5 pb-1.5 flex-wrap">
                    <StatusPill status={cmd.status} />
                    {cmd.parsed_command && <span className="text-[11px] text-text-secondary truncate">{cmd.parsed_command}</span>}
                  </div>

                  {/* Processing animation */}
                  {(cmd.status === 'processing' || cmd.status === 'executing') && (
                    <div className="px-3.5 pb-3 thinking-dots">
                      <span /><span /><span />
                    </div>
                  )}

                  {/* stdout */}
                  {cmd.result_stdout && (
                    <div className="px-3.5 pb-3">
                      <pre className="font-mono text-[11px] text-text-secondary bg-bg rounded-lg p-2.5 overflow-x-auto whitespace-pre-wrap border border-border/50 leading-relaxed max-h-[200px] overflow-y-auto">
                        {cmd.result_stdout}
                      </pre>
                    </div>
                  )}

                  {/* stderr */}
                  {cmd.result_stderr && (
                    <div className="px-3.5 pb-3">
                      <pre className="font-mono text-[11px] text-red/80 bg-red-glow rounded-lg p-2.5 overflow-x-auto whitespace-pre-wrap border border-red/15 leading-relaxed max-h-[150px] overflow-y-auto">
                        {cmd.result_stderr}
                      </pre>
                    </div>
                  )}

                  {/* Screenshot */}
                  {cmd.result_screenshot && (
                    <div className="px-3.5 pb-3">
                      <img src={`data:image/png;base64,${cmd.result_screenshot}`} alt="Screenshot" className="w-full rounded-lg border border-border" />
                    </div>
                  )}

                  {/* Confirm buttons */}
                  {cmd.requires_confirmation && cmd.status === 'awaiting_confirmation' && (
                    <div className="px-3.5 pb-3 flex gap-2">
                      <button onClick={() => confirmCommand(cmd.id, false)}
                        className="flex-1 bg-surface-2 hover:bg-surface-3 text-text-muted py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer">
                        Cancel
                      </button>
                      <button onClick={() => confirmCommand(cmd.id, true)}
                        className="flex-1 bg-red-glow hover:bg-red/20 text-red border border-red/25 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer">
                        ⚠ Execute
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
        <div ref={chatEndRef} />
      </main>

      {/* ---- INPUT BAR ---- */}
      <div className="px-3 py-2.5 bg-surface/90 backdrop-blur-xl border-t border-border shrink-0 safe-bottom">
        <form onSubmit={sendCommand} className="flex items-center gap-2 bg-surface-2 border border-border rounded-2xl px-1 py-1 focus-within:border-cyan/30 transition-colors">
          <input ref={inputRef} type="text" placeholder="Type a command..."
            className="flex-1 bg-transparent px-3 py-2.5 text-sm text-text outline-none placeholder:text-text-muted/50 font-mono min-w-0"
            value={input} onChange={e => setInput(e.target.value)} disabled={!selectedDevice} />
          <button type="submit" disabled={!input.trim() || !selectedDevice}
            className="bg-cyan text-bg p-2.5 rounded-xl disabled:opacity-20 hover:brightness-110 active:scale-90 transition-all cursor-pointer shrink-0">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </form>
      </div>
    </div>
  );
}
