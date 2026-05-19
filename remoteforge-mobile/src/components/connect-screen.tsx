import { useState } from 'react';
import type { UserProfile } from '../App';

interface Props {
  user: UserProfile;
  onRefresh: () => void;
  onSignOut: () => void;
}

export default function ConnectScreen({ user, onRefresh, onSignOut }: Props) {
  const [refreshing, setRefreshing] = useState(false);

  async function handleRefresh() {
    setRefreshing(true);
    await onRefresh();
    setTimeout(() => setRefreshing(false), 1500);
  }

  return (
    <div className="connect-screen">
      {/* Background decoration */}
      <div className="connect-bg">
        <div className="connect-orb connect-orb-1" />
        <div className="connect-orb connect-orb-2" />
      </div>

      <div className="connect-content">
        {/* User greeting */}
        <div className="connect-greeting">
          <p>Hey, {user.name.split(' ')[0]} 👋</p>
        </div>

        {/* Main illustration */}
        <div className="connect-illustration">
          <div className="laptop-icon">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#8ab4f8" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
              <line x1="2" y1="20" x2="22" y2="20" />
            </svg>
            <div className="pulse-ring" />
            <div className="pulse-ring delay" />
          </div>
        </div>

        <h1 className="connect-title">Connect your PC</h1>
        <p className="connect-subtitle">
          Set up the RemoteForge agent on your computer to start controlling it remotely
        </p>

        {/* Steps */}
        <div className="connect-steps">
          <div className="step">
            <div className="step-num">1</div>
            <div className="step-text">
              <strong>Download the agent</strong>
              <span>Install RemoteForge Agent on your PC</span>
            </div>
          </div>
          <div className="step">
            <div className="step-num">2</div>
            <div className="step-text">
              <strong>Run the setup</strong>
              <span>Sign in with the same account</span>
            </div>
          </div>
          <div className="step">
            <div className="step-num">3</div>
            <div className="step-text">
              <strong>Start controlling</strong>
              <span>Your PC will appear here automatically</span>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="connect-actions">
          <button className="btn-primary" onClick={handleRefresh} disabled={refreshing}>
            {refreshing ? (
              <>
                <div className="spinner-sm" />
                Searching for devices...
              </>
            ) : (
              <>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                </svg>
                Check for devices
              </>
            )}
          </button>
          <button className="btn-ghost" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
