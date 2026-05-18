import { useEffect, useState, useRef } from 'react';
import { supabase } from './lib/supabase';

// ============================================
// Types
// ============================================
type Device = {
  id: string;
  device_name: string;
  is_online: boolean;
};

type Command = {
  id: string;
  raw_input: string;
  command_type: string;
  status: string;
  result_stdout?: string;
  result_stderr?: string;
  result_screenshot?: string;
  requires_confirmation?: boolean;
  created_at: string;
};

// ============================================
// Smart command type detection
// ============================================
function detectCommandType(input: string): { type: string; parsed: string } {
  const lower = input.toLowerCase().trim();

  // Screenshot detection
  if (lower.includes('screenshot') || lower.includes('screen capture') || lower.includes('take a screenshot') || lower === 'ss') {
    return { type: 'screenshot', parsed: 'screenshot' };
  }

  // System info detection
  if (lower.includes('sysinfo') || lower.includes('system info') || lower.includes('system status') || lower.includes('cpu usage') || lower.includes('ram usage') || lower.includes('battery')) {
    return { type: 'system', parsed: 'sysinfo' };
  }

  // App open detection
  if (lower.startsWith('open ') || lower.startsWith('launch ') || lower.startsWith('start ')) {
    const appName = input.replace(/^(open|launch|start)\s+/i, '').trim();
    return { type: 'app', parsed: appName };
  }

  // Everything else is a shell command
  return { type: 'shell', parsed: input };
}

// ============================================
// Status badge component
// ============================================
function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; color: string; bg: string; icon: string }> = {
    pending: { label: 'Sending', color: 'text-yellow', bg: 'bg-yellow/10', icon: '◌' },
    processing: { label: 'Processing', color: 'text-yellow', bg: 'bg-yellow/10', icon: '⟳' },
    executing: { label: 'Executing', color: 'text-cyan', bg: 'bg-cyan/10', icon: '⚡' },
    completed: { label: 'Success', color: 'text-green', bg: 'bg-green/10', icon: '✓' },
    failed: { label: 'Failed', color: 'text-red', bg: 'bg-red/10', icon: '✗' },
    cancelled: { label: 'Cancelled', color: 'text-text-muted', bg: 'bg-surface-2', icon: '—' },
    awaiting_confirmation: { label: 'Awaiting Approval', color: 'text-orange', bg: 'bg-orange/10', icon: '⚠' },
  };

  const c = config[status] || config.pending;

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold tracking-wide uppercase ${c.color} ${c.bg}`}>
      <span>{c.icon}</span>
      {c.label}
    </span>
  );
}

// ============================================
// Main App
// ============================================
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

  // ---- Auth ----
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => setSession(session));
    return () => subscription.unsubscribe();
  }, []);

  // ---- Load devices ----
  useEffect(() => {
    if (session) loadDevices();
  }, [session]);

  // ---- Subscribe to commands ----
  useEffect(() => {
    if (!selectedDevice) return;
    loadCommands();

    const channel = supabase
      .channel(`cmds-${selectedDevice}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'commands',
        filter: `pc_device_id=eq.${selectedDevice}`,
      }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setCommands((prev) => [...prev, payload.new as Command]);
        } else if (payload.eventType === 'UPDATE') {
          setCommands((prev) => prev.map((c) => (c.id === payload.new.id ? (payload.new as Command) : c)));
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [selectedDevice]);

  // ---- Auto scroll ----
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [commands]);

  async function loadDevices() {
    const { data } = await supabase
      .from('devices')
      .select('id, device_name, is_online')
      .eq('device_type', 'pc')
      .order('is_online', { ascending: false });
    if (data) {
      setDevices(data);
      if (data.length > 0 && !selectedDevice) setSelectedDevice(data[0].id);
    }
  }

  async function loadCommands() {
    const { data } = await supabase
      .from('commands')
      .select('*')
      .eq('pc_device_id', selectedDevice)
      .order('created_at', { ascending: true })
      .limit(50);
    if (data) setCommands(data);
  }

  async function handleAuth(e: React.FormEvent) {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setAuthError(error.message);
    setAuthLoading(false);
  }

  async function sendCommand(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!input.trim() || !selectedDevice) return;

    const { type, parsed } = detectCommandType(input.trim());

    await supabase.from('commands').insert({
      user_id: session.user.id,
      pc_device_id: selectedDevice,
      raw_input: input.trim(),
      command_type: type,
      parsed_command: parsed,
      status: 'pending',
    });

    setInput('');
    inputRef.current?.focus();
  }

  async function confirmCommand(id: string, confirm: boolean) {
    if (confirm) {
      await supabase.from('commands').update({
        status: 'pending',
        requires_confirmation: false,
        confirmed_at: new Date().toISOString(),
      }).eq('id', id);
    } else {
      await supabase.from('commands').update({ status: 'cancelled' }).eq('id', id);
    }
  }

  // ============================================
  // LOGIN SCREEN
  // ============================================
  if (!session) {
    return (
      <div className="flex items-center justify-center h-full bg-bg p-6">
        <div className="w-full max-w-sm">
          {/* Logo */}
          <div className="text-center mb-10">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-cyan/10 mb-5 animate-pulse-glow">
              <span className="text-3xl">⚡</span>
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-text">RemoteForge</h1>
            <p className="text-text-muted mt-2 text-sm">Control your PC from anywhere</p>
          </div>

          {/* Form */}
          <form onSubmit={handleAuth} className="space-y-4">
            <div>
              <label className="block text-xs text-text-muted mb-1.5 uppercase tracking-wider font-medium">Email</label>
              <input
                type="email"
                placeholder="you@example.com"
                className="w-full bg-surface border border-border rounded-xl px-4 py-3 text-sm text-text outline-none focus:border-cyan transition-colors placeholder:text-text-muted/50"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1.5 uppercase tracking-wider font-medium">Password</label>
              <input
                type="password"
                placeholder="••••••••"
                className="w-full bg-surface border border-border rounded-xl px-4 py-3 text-sm text-text outline-none focus:border-cyan transition-colors placeholder:text-text-muted/50"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            {authError && (
              <div className="bg-red/10 border border-red/30 rounded-lg px-4 py-2.5 text-red text-sm">{authError}</div>
            )}

            <button
              disabled={authLoading}
              className="w-full bg-cyan text-bg font-bold rounded-xl px-4 py-3.5 text-sm hover:brightness-110 active:scale-[0.98] transition-all disabled:opacity-50"
            >
              {authLoading ? 'Authenticating...' : 'Login'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ============================================
  // MAIN CHAT SCREEN
  // ============================================
  const selectedDeviceData = devices.find((d) => d.id === selectedDevice);

  return (
    <div className="flex flex-col h-full bg-bg">
      {/* ---- Header ---- */}
      <header className="flex items-center justify-between px-5 py-3.5 bg-surface/80 backdrop-blur-md border-b border-border shrink-0">
        <div className="flex items-center gap-2.5">
          <span className="text-lg">⚡</span>
          <span className="text-base font-bold tracking-tight">RemoteForge</span>
        </div>

        {devices.length > 0 ? (
          <div className="flex items-center gap-2 bg-surface-2 border border-border rounded-lg px-3 py-1.5 text-sm">
            <span className={`w-2 h-2 rounded-full ${selectedDeviceData?.is_online ? 'bg-green' : 'bg-red'}`} />
            <select
              className="bg-transparent text-text text-sm outline-none cursor-pointer"
              value={selectedDevice || ''}
              onChange={(e) => setSelectedDevice(e.target.value)}
            >
              {devices.map((d) => (
                <option key={d.id} value={d.id} style={{ background: '#111' }}>
                  {d.device_name}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <span className="text-xs text-red flex items-center gap-1.5">⊘ No PCs</span>
        )}
      </header>

      {/* ---- Chat Messages ---- */}
      <main className="flex-1 overflow-y-auto px-4 py-5 space-y-5">
        {commands.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-text-muted gap-3">
            <div className="w-20 h-20 rounded-full bg-surface-2 border border-border flex items-center justify-center text-3xl opacity-60">
              ⌨
            </div>
            <p className="font-medium">Ready for commands</p>
            <div className="flex flex-wrap gap-2 justify-center mt-2">
              {['open notepad', 'screenshot', 'sysinfo', 'dir'].map((cmd) => (
                <button
                  key={cmd}
                  onClick={() => { setInput(cmd); }}
                  className="px-3 py-1.5 bg-surface-2 border border-border rounded-full text-xs text-text-muted hover:text-cyan hover:border-cyan-dim transition-colors cursor-pointer"
                >
                  {cmd}
                </button>
              ))}
            </div>
          </div>
        )}

        {commands.map((cmd) => (
          <div key={cmd.id} className="space-y-2.5 animate-fade-up">
            {/* User message (right) */}
            <div className="flex justify-end">
              <div className="bg-cyan/10 border border-cyan/20 px-4 py-2.5 rounded-2xl rounded-tr-none max-w-[75%]">
                <p className="font-mono text-sm text-cyan">{cmd.raw_input}</p>
              </div>
            </div>

            {/* Agent response (left) */}
            {cmd.status !== 'pending' && (
              <div className="flex justify-start">
                <div className="bg-surface border border-border rounded-2xl rounded-tl-none max-w-[85%] overflow-hidden">
                  {/* Status header */}
                  <div className="px-4 pt-3 pb-2">
                    <StatusBadge status={cmd.status} />
                  </div>

                  {/* stdout */}
                  {cmd.result_stdout && (
                    <div className="px-4 pb-3">
                      <pre className="font-mono text-xs text-text/80 bg-bg rounded-lg p-3 overflow-x-auto whitespace-pre-wrap border border-border/50 leading-relaxed">
                        {cmd.result_stdout}
                      </pre>
                    </div>
                  )}

                  {/* stderr */}
                  {cmd.result_stderr && (
                    <div className="px-4 pb-3">
                      <pre className="font-mono text-xs text-red/80 bg-red/5 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap border border-red/20 leading-relaxed">
                        {cmd.result_stderr}
                      </pre>
                    </div>
                  )}

                  {/* Screenshot */}
                  {cmd.result_screenshot && (
                    <div className="px-4 pb-3">
                      <div className="rounded-lg overflow-hidden border border-border">
                        <img src={`data:image/png;base64,${cmd.result_screenshot}`} alt="Screenshot" className="w-full" />
                      </div>
                    </div>
                  )}

                  {/* Confirmation buttons */}
                  {cmd.requires_confirmation && cmd.status === 'awaiting_confirmation' && (
                    <div className="px-4 pb-3 flex gap-2">
                      <button
                        onClick={() => confirmCommand(cmd.id, false)}
                        className="flex-1 bg-surface-2 hover:bg-border text-text-muted py-2.5 rounded-lg text-sm font-medium transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => confirmCommand(cmd.id, true)}
                        className="flex-1 bg-red/15 hover:bg-red/25 text-red border border-red/30 py-2.5 rounded-lg text-sm font-medium transition-colors"
                      >
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

      {/* ---- Input Bar ---- */}
      <div className="p-3 bg-surface/80 backdrop-blur-md border-t border-border shrink-0">
        <form onSubmit={sendCommand} className="flex items-center gap-2 bg-surface-2 border border-border rounded-2xl px-1.5 py-1.5 focus-within:border-cyan/40 transition-colors">
          <input
            ref={inputRef}
            type="text"
            placeholder="Type a command..."
            className="flex-1 bg-transparent px-3.5 py-2.5 text-sm text-text outline-none placeholder:text-text-muted/40 font-mono"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={!selectedDevice}
          />
          <button
            type="submit"
            disabled={!input.trim() || !selectedDevice}
            className="bg-cyan text-bg p-2.5 rounded-xl disabled:opacity-30 hover:brightness-110 active:scale-95 transition-all cursor-pointer disabled:cursor-not-allowed"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </form>
      </div>
    </div>
  );
}
