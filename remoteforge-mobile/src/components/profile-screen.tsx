import type { UserProfile, Device } from '../App';

interface Props {
  user: UserProfile;
  device: Device;
  onSignOut: () => void;
}

export default function ProfileScreen({ user, device, onSignOut }: Props) {
  const initials = user.name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="screen-container profile-screen">
      <div className="screen-header">
        <h1>Profile</h1>
      </div>

      {/* User Card */}
      <div className="profile-card">
        <div className="profile-avatar-section">
          {user.avatar_url ? (
            <img className="profile-avatar" src={user.avatar_url} alt={user.name} referrerPolicy="no-referrer" />
          ) : (
            <div className="profile-avatar-initials">{initials}</div>
          )}
          <div className="profile-info">
            <h2>{user.name}</h2>
            <p>{user.email}</p>
          </div>
        </div>
      </div>

      {/* Connected Device */}
      <div className="settings-section">
        <h3 className="section-label">Connected Device</h3>
        <div className="settings-card">
          <div className="settings-item">
            <div className="settings-item-left">
              <div className="settings-icon device-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="3" width="20" height="14" rx="2" /><line x1="2" y1="20" x2="22" y2="20" />
                </svg>
              </div>
              <div>
                <p className="settings-title">{device.device_name}</p>
                <p className="settings-sub">{device.is_online ? 'Online' : 'Offline'}</p>
              </div>
            </div>
            <span className={`status-badge ${device.is_online ? 'online' : 'offline'}`}>
              {device.is_online ? 'Connected' : 'Disconnected'}
            </span>
          </div>
        </div>
      </div>

      {/* App Info */}
      <div className="settings-section">
        <h3 className="section-label">About</h3>
        <div className="settings-card">
          <div className="settings-item">
            <div className="settings-item-left">
              <div className="settings-icon brand-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
                </svg>
              </div>
              <div>
                <p className="settings-title">RemoteForge</p>
                <p className="settings-sub">v3.0.0</p>
              </div>
            </div>
          </div>
          <div className="settings-divider" />
          <div className="settings-item">
            <div className="settings-item-left">
              <div className="settings-icon brain-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2" />
                  <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2" />
                </svg>
              </div>
              <div>
                <p className="settings-title">AI Brain</p>
                <p className="settings-sub">NVIDIA Nemotron 120B</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Sign Out */}
      <div className="settings-section">
        <button className="signout-btn" onClick={onSignOut}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          Sign Out
        </button>
      </div>
    </div>
  );
}
