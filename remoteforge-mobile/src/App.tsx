import { useEffect, useState, useRef, useCallback } from 'react';
import { supabase } from './lib/supabase';
import AuthPage from './components/auth-page';
import PairingScreen from './components/pairing-screen';
import ChatScreen from './components/chat-screen';
import ProfileScreen from './components/profile-screen';
import './App.css';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
export type Device = {
  id: string;
  device_name: string;
  is_online: boolean;
  last_seen_at?: string;
};
export type Command = {
  id: string; raw_input: string; command_type: string; status: string;
  result_stdout?: string; result_stderr?: string; result_screenshot?: string;
  requires_confirmation?: boolean; parsed_command?: string; created_at: string;
};
export type UserProfile = {
  id: string;
  email: string;
  name: string;
  avatar_url?: string;
};

export type ConnectionStatus = 'connected' | 'checking' | 'offline';

export function computeConnectionStatus(device: Device): ConnectionStatus {
  if (!device.last_seen_at) return 'offline';
  const diff = Date.now() - new Date(device.last_seen_at).getTime();
  if (diff < 15000) return 'connected';
  if (diff < 30000) return 'checking';
  return 'offline';
}

type Screen = 'chat' | 'history' | 'profile';

/* ------------------------------------------------------------------ */
/*  Bottom Nav Icons                                                    */
/* ------------------------------------------------------------------ */
const ChatIcon = ({ active }: { active: boolean }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? '#8ab4f8' : '#6a6a75'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);
const HistoryIcon = ({ active }: { active: boolean }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? '#8ab4f8' : '#6a6a75'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
  </svg>
);
const ProfileIcon = ({ active }: { active: boolean }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? '#8ab4f8' : '#6a6a75'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
  </svg>
);

/* ------------------------------------------------------------------ */
/*  Main App                                                           */
/* ------------------------------------------------------------------ */
export default function App() {
  const [session, setSession] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
  const [commands, setCommands] = useState<Command[]>([]);
  const [screen, setScreen] = useState<Screen>('chat');
  const [streamedIds, setStreamedIds] = useState<Set<string>>(new Set());
  const [isPaired, setIsPaired] = useState(false);

  const chatEnd = useRef<HTMLDivElement>(null);

  /* ---- Auth ---- */
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      setAuthLoading(false);
    });
    return () => subscription.unsubscribe();
  }, []);

  /* ---- User profile ---- */
  const userProfile: UserProfile | null = session ? {
    id: session.user.id,
    email: session.user.email || '',
    name: session.user.user_metadata?.full_name || session.user.user_metadata?.name || session.user.email?.split('@')[0] || 'User',
    avatar_url: session.user.user_metadata?.avatar_url || session.user.user_metadata?.picture,
  } : null;

  /* ---- Devices ---- */
  useEffect(() => {
    if (!session) return;
    loadDevices();

    // Subscribe to device status changes in real-time
    const deviceCh = supabase
      .channel('device-status')
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'devices',
      }, (p) => {
        setDevices(prev => prev.map(d => d.id === p.new.id
          ? { ...d, is_online: p.new.is_online, last_seen_at: p.new.last_seen_at } as Device
          : d
        ));
      }).subscribe();

    // Poll device status every 10s for accurate last_seen_at
    const devicePoll = setInterval(loadDevices, 10000);

    return () => {
      supabase.removeChannel(deviceCh);
      clearInterval(devicePoll);
    };
  }, [session]);

  async function loadDevices() {
    const { data } = await supabase
      .from('devices')
      .select('id, device_name, is_online, last_seen_at')
      .eq('device_type', 'pc')
      .order('is_online', { ascending: false });
    if (data) {
      // Compute true online status from heartbeat freshness (< 30s = online)
      const enriched = data.map(d => ({
        ...d,
        is_online: d.last_seen_at
          ? (Date.now() - new Date(d.last_seen_at).getTime()) < 30000
          : false,
      }));
      setDevices(enriched);
      if (enriched.length > 0 && !selectedDevice) {
        setSelectedDevice(enriched[0].id);
        setIsPaired(true);
      }
      if (enriched.length > 0) setIsPaired(true);
    }
  }

  /* ---- Handle Pairing ---- */
  function handlePaired(deviceId: string, _deviceName: string) {
    setSelectedDevice(deviceId);
    setIsPaired(true);
    loadDevices();
  }

  /* ---- Commands ---- */
  useEffect(() => {
    if (!selectedDevice) return;
    loadCommands();

    // Realtime subscription for instant updates
    const ch = supabase
      .channel(`cmds-${selectedDevice}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'commands',
        filter: `pc_device_id=eq.${selectedDevice}`
      }, (p) => {
        if (p.eventType === 'INSERT') setCommands(prev => [...prev, p.new as Command]);
        else if (p.eventType === 'UPDATE') setCommands(prev => prev.map(c => c.id === p.new.id ? p.new as Command : c));
      }).subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn('Realtime channel issue, falling back to polling');
        }
      });

    // Polling fallback every 5s
    const pollTimer = setInterval(async () => {
      const { data } = await supabase
        .from('commands')
        .select('*')
        .eq('pc_device_id', selectedDevice)
        .order('created_at', { ascending: true })
        .limit(50);
      if (data) {
        setCommands(prev => {
          const map = new Map(prev.map(c => [c.id, c]));
          let changed = false;
          for (const cmd of data) {
            const existing = map.get(cmd.id);
            if (!existing || existing.status !== cmd.status || existing.result_stdout !== cmd.result_stdout) {
              map.set(cmd.id, cmd);
              changed = true;
            }
          }
          return changed ? Array.from(map.values()).sort((a, b) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          ) : prev;
        });
      }
    }, 5000);

    return () => {
      supabase.removeChannel(ch);
      clearInterval(pollTimer);
    };
  }, [selectedDevice]);

  async function loadCommands() {
    const { data } = await supabase
      .from('commands')
      .select('*')
      .eq('pc_device_id', selectedDevice)
      .order('created_at', { ascending: true })
      .limit(50);
    if (data) {
      setCommands(data);
      setStreamedIds(new Set(data.filter(c => c.status === 'completed' || c.status === 'failed').map(c => c.id)));
    }
  }

  /* ---- Scroll ---- */
  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: 'smooth' }); }, [commands]);

  const markStreamed = useCallback((id: string) => {
    setStreamedIds(prev => new Set(prev).add(id));
  }, []);

  /* ---- Send ---- */
  async function send(input: string, mode: 'execute' | 'plan') {
    if (!input.trim() || !selectedDevice || !session) return;
    await supabase.from('commands').insert({
      user_id: session.user.id,
      pc_device_id: selectedDevice,
      raw_input: input.trim(),
      command_type: mode === 'plan' ? 'plan' : 'execute',
      parsed_command: null,
      status: 'pending',
    });
  }

  /* ---- Retry a timed-out command ---- */
  async function retryCommand(cmd: Command) {
    // Create a new command with the same input
    if (!selectedDevice || !session) return;
    await supabase.from('commands').insert({
      user_id: session.user.id,
      pc_device_id: selectedDevice,
      raw_input: cmd.raw_input,
      command_type: cmd.command_type,
      parsed_command: null,
      status: 'pending',
    });
  }

  /* ---- Cancel a pending command ---- */
  async function cancelCommand(id: string) {
    await supabase.from('commands').update({ status: 'cancelled', result_stdout: 'Cancelled by user' }).eq('id', id);
  }

  async function confirmCommand(id: string, yes: boolean) {
    if (yes) await supabase.from('commands').update({ status: 'pending', requires_confirmation: false, confirmed_at: new Date().toISOString() }).eq('id', id);
    else await supabase.from('commands').update({ status: 'cancelled' }).eq('id', id);
  }

  async function signOut() {
    await supabase.auth.signOut();
    setSession(null);
    setDevices([]);
    setSelectedDevice(null);
    setCommands([]);
    setIsPaired(false);
  }

  /* ================================================================ */
  /*  RENDER                                                           */
  /* ================================================================ */

  // Loading
  if (authLoading) {
    return (
      <div className="app-loading">
        <div className="loading-pulse" />
      </div>
    );
  }

  // Not logged in
  if (!session) return <AuthPage />;

  // No device paired — show pairing screen
  if (!isPaired || devices.length === 0) {
    return <PairingScreen user={userProfile!} onPaired={handlePaired} onSignOut={signOut} />;
  }

  // Main app
  const connectedDevice = devices.find(d => d.id === selectedDevice) || devices[0];
  const connectionStatus = computeConnectionStatus(connectedDevice);

  return (
    <div className="app-shell">
      {/* Screen Content */}
      <div className="app-content">
        {screen === 'chat' && (
          <ChatScreen
            device={connectedDevice}
            devices={devices}
            commands={commands}
            streamedIds={streamedIds}
            chatEnd={chatEnd}
            connectionStatus={connectionStatus}
            onSend={send}
            onConfirm={confirmCommand}
            onMarkStreamed={markStreamed}
            onSelectDevice={setSelectedDevice}
            onRetry={retryCommand}
            onCancel={cancelCommand}
          />
        )}
        {screen === 'history' && (
          <div className="screen-container">
            <div className="screen-header">
              <h1>History</h1>
              <p>Recent commands & sessions</p>
            </div>
            <div className="history-list">
              {commands.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">
                    <HistoryIcon active={false} />
                  </div>
                  <p>No commands yet</p>
                  <span>Your command history will appear here</span>
                </div>
              ) : (
                [...commands].reverse().map(cmd => (
                  <div key={cmd.id} className="history-item">
                    <div className="history-item-header">
                      <span className={`status-dot ${cmd.status === 'completed' ? 'success' : cmd.status === 'failed' ? 'error' : 'pending'}`} />
                      <span className="history-time">
                        {new Date(cmd.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p className="history-command">{cmd.raw_input}</p>
                    {cmd.result_stdout && (
                      <p className="history-result">{cmd.result_stdout.slice(0, 120)}{cmd.result_stdout.length > 120 ? '...' : ''}</p>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
        {screen === 'profile' && (
          <ProfileScreen user={userProfile!} device={connectedDevice} onSignOut={signOut} />
        )}
      </div>

      {/* Bottom Navigation */}
      <nav className="bottom-nav">
        <button className={`nav-item ${screen === 'chat' ? 'active' : ''}`} onClick={() => setScreen('chat')}>
          <ChatIcon active={screen === 'chat'} />
          <span>Chat</span>
        </button>
        <button className={`nav-item ${screen === 'history' ? 'active' : ''}`} onClick={() => setScreen('history')}>
          <HistoryIcon active={screen === 'history'} />
          <span>History</span>
        </button>
        <button className={`nav-item ${screen === 'profile' ? 'active' : ''}`} onClick={() => setScreen('profile')}>
          <ProfileIcon active={screen === 'profile'} />
          <span>Profile</span>
        </button>
      </nav>
    </div>
  );
}
