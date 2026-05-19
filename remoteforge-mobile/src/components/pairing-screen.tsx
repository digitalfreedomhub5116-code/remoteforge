import { useState, useRef, useEffect } from 'react';
import type { UserProfile } from '../App';
import { supabase } from '../lib/supabase';

interface Props {
  user: UserProfile;
  onPaired: (deviceId: string, deviceName: string) => void;
  onSignOut: () => void;
}

export default function PairingScreen({ user, onPaired, onSignOut }: Props) {
  const [code, setCode] = useState(['', '', '', '', '', '']);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, []);

  function handleInput(index: number, value: string) {
    const char = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!char) return;

    const newCode = [...code];
    newCode[index] = char[0];
    setCode(newCode);
    setError('');

    // Auto-advance to next input
    if (index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    // Auto-submit when all 6 filled
    const fullCode = newCode.join('');
    if (fullCode.length === 6 && newCode.every(c => c !== '')) {
      submitCode(fullCode);
    }
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent) {
    if (e.key === 'Backspace') {
      e.preventDefault();
      const newCode = [...code];
      if (code[index]) {
        newCode[index] = '';
        setCode(newCode);
      } else if (index > 0) {
        newCode[index - 1] = '';
        setCode(newCode);
        inputRefs.current[index - 1]?.focus();
      }
    }
  }

  function handlePaste(e: React.ClipboardEvent) {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    if (pasted.length === 6) {
      setCode(pasted.split(''));
      inputRefs.current[5]?.focus();
      submitCode(pasted);
    }
  }

  async function submitCode(fullCode: string) {
    setLoading(true);
    setError('');

    try {
      const { data, error: rpcError } = await supabase.rpc('validate_pairing_code', {
        p_code: fullCode,
        p_user_id: user.id,
      });

      if (rpcError) {
        setError(rpcError.message || 'Something went wrong');
        setLoading(false);
        return;
      }

      const result = typeof data === 'string' ? JSON.parse(data) : data;

      if (result.success) {
        setSuccess(true);
        setTimeout(() => {
          onPaired(result.device_id, result.device_name);
        }, 1200);
      } else {
        setError(result.error || 'Invalid code');
        setCode(['', '', '', '', '', '']);
        inputRefs.current[0]?.focus();
      }
    } catch (err: any) {
      setError(err.message || 'Network error');
    }
    setLoading(false);
  }

  return (
    <div className="pairing-screen">
      <div className="pairing-bg">
        <div className="pairing-orb pairing-orb-1" />
        <div className="pairing-orb pairing-orb-2" />
      </div>

      <div className="pairing-content">
        {/* Greeting */}
        <div className="pairing-greeting">
          <p>Hey, {user.name.split(' ')[0]} 👋</p>
        </div>

        {/* Icon */}
        <div className="pairing-illustration">
          <div className="pairing-icon-wrap">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#8ab4f8" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
              <line x1="2" y1="20" x2="22" y2="20" />
            </svg>
            {!success && (
              <>
                <div className="pairing-pulse-ring" />
                <div className="pairing-pulse-ring delay" />
              </>
            )}
            {success && (
              <div className="pairing-check">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
            )}
          </div>
        </div>

        {success ? (
          <div className="pairing-success-msg">
            <h1>Connected! 🎉</h1>
            <p>Your PC is now linked. Redirecting...</p>
          </div>
        ) : (
          <>
            <h1 className="pairing-title">Enter Pairing Code</h1>
            <p className="pairing-subtitle">
              Enter the 6-digit code shown on your PC's RemoteForge window
            </p>

            {/* Code Input */}
            <div className="pairing-inputs" onPaste={handlePaste}>
              {code.map((char, i) => (
                <input
                  key={i}
                  ref={el => { inputRefs.current[i] = el; }}
                  type="text"
                  maxLength={1}
                  value={char}
                  className={`pairing-input ${char ? 'filled' : ''} ${error ? 'error' : ''}`}
                  onChange={e => handleInput(i, e.target.value)}
                  onKeyDown={e => handleKeyDown(i, e)}
                  disabled={loading || success}
                  autoCapitalize="characters"
                  inputMode="text"
                />
              ))}
            </div>

            {/* Error */}
            {error && (
              <div className="pairing-error">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
                </svg>
                {error}
              </div>
            )}

            {/* Loading */}
            {loading && (
              <div className="pairing-loading">
                <div className="pairing-spinner" />
                Verifying code...
              </div>
            )}

            {/* Help text */}
            <div className="pairing-help">
              <p>Don't see a code? Make sure:</p>
              <ul>
                <li>RemoteForge is running on your PC</li>
                <li>You're signed in with the same account</li>
                <li>The agent is started (green status)</li>
              </ul>
            </div>
          </>
        )}

        {/* Sign out */}
        {!success && (
          <button className="pairing-signout" onClick={onSignOut}>
            Sign out
          </button>
        )}
      </div>
    </div>
  );
}
