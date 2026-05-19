import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import './auth-page.css'

type AuthMode = 'signin' | 'signup'

export default function AuthPage() {
  const [mode, setMode] = useState<AuthMode>('signup')
  const [firstname, setFirstname] = useState('')
  const [lastname, setLastname] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [oauthLoading, setOauthLoading] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    setSuccessMsg('')

    if (mode === 'signup') {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            first_name: firstname,
            last_name: lastname,
            full_name: `${firstname} ${lastname}`.trim(),
          },
        },
      })
      if (signUpError) setError(signUpError.message)
      else if (data.user && !data.session) setSuccessMsg('Check your email for a confirmation link!')
    } else {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
      if (signInError) setError(signInError.message)
    }
    setLoading(false)
  }

  async function handleOAuth(provider: 'google' | 'azure') {
    setError('')
    setOauthLoading(provider)
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin },
    })
    if (oauthError) {
      setError(oauthError.message)
      setOauthLoading(null)
    }
  }

  return (
    <div className="auth-page">
      {/* Animated background orbs */}
      <div className="auth-bg">
        <div className="orb orb-1" />
        <div className="orb orb-2" />
        <div className="orb orb-3" />
      </div>

      <div className="auth-container">
        {/* Logo */}
        <div className="auth-logo">
          <div className="logo-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>
        </div>

        {/* Card */}
        <div className="auth-card">
          <div className="auth-card-inner">
            {/* Header */}
            <div className="auth-header">
              <h1>{mode === 'signup' ? 'Create your account' : 'Welcome back'}</h1>
              <p>{mode === 'signup' ? 'Start controlling your PC remotely' : 'Sign in to continue'}</p>
            </div>

            {/* OAuth Buttons */}
            <div className="oauth-grid">
              <button
                type="button"
                className="oauth-btn"
                onClick={() => handleOAuth('google')}
                disabled={oauthLoading !== null}
              >
                {oauthLoading === 'google' ? (
                  <div className="spinner" />
                ) : (
                  <svg width="18" height="18" viewBox="0 0 256 262">
                    <path fill="#4285f4" d="M255.878 133.451c0-10.734-.871-18.567-2.756-26.69H130.55v48.448h71.947c-1.45 12.04-9.283 30.172-26.69 42.356l-.244 1.622l38.755 30.023l2.685.268c24.659-22.774 38.875-56.282 38.875-96.027" />
                    <path fill="#34a853" d="M130.55 261.1c35.248 0 64.839-11.605 86.453-31.622l-41.196-31.913c-11.024 7.688-25.82 13.055-45.257 13.055c-34.523 0-63.824-22.773-74.269-54.25l-1.531.13l-40.298 31.187l-.527 1.465C35.393 231.798 79.49 261.1 130.55 261.1" />
                    <path fill="#fbbc05" d="M56.281 156.37c-2.756-8.123-4.351-16.827-4.351-25.82c0-8.994 1.595-17.697 4.206-25.82l-.073-1.73L15.26 71.312l-1.335.635C5.077 89.644 0 109.517 0 130.55s5.077 40.905 13.925 58.602z" />
                    <path fill="#eb4335" d="M130.55 50.479c24.514 0 41.05 10.589 50.479 19.438l36.844-35.974C195.245 12.91 165.798 0 130.55 0C79.49 0 35.393 29.301 13.925 71.947l42.211 32.783c10.59-31.477 39.891-54.251 74.414-54.251" />
                  </svg>
                )}
                <span>Google</span>
              </button>

              <button
                type="button"
                className="oauth-btn"
                onClick={() => handleOAuth('azure')}
                disabled={oauthLoading !== null}
              >
                {oauthLoading === 'azure' ? (
                  <div className="spinner" />
                ) : (
                  <svg width="18" height="18" viewBox="0 0 256 256">
                    <path fill="#f1511b" d="M121.666 121.666H0V0h121.666z" />
                    <path fill="#80cc28" d="M256 121.666H134.335V0H256z" />
                    <path fill="#00adef" d="M121.663 256.002H0V134.336h121.663z" />
                    <path fill="#fbbc09" d="M256 256.002H134.335V134.336H256z" />
                  </svg>
                )}
                <span>Microsoft</span>
              </button>
            </div>

            {/* Divider */}
            <div className="auth-divider">
              <div className="divider-line" />
              <span>or</span>
              <div className="divider-line" />
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="auth-form">
              {mode === 'signup' && (
                <div className="name-grid">
                  <div className="field">
                    <label htmlFor="firstname">First name</label>
                    <input id="firstname" type="text" required placeholder="John" value={firstname} onChange={e => setFirstname(e.target.value)} />
                  </div>
                  <div className="field">
                    <label htmlFor="lastname">Last name</label>
                    <input id="lastname" type="text" required placeholder="Doe" value={lastname} onChange={e => setLastname(e.target.value)} />
                  </div>
                </div>
              )}

              <div className="field">
                <label htmlFor="email">Email</label>
                <input id="email" type="email" required placeholder="you@example.com" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} />
              </div>

              <div className="field">
                <label htmlFor="password">Password</label>
                <input id="password" type="password" required placeholder="••••••••" minLength={6} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} />
              </div>

              {error && <div className="auth-error">{error}</div>}
              {successMsg && <div className="auth-success">{successMsg}</div>}

              <button type="submit" className="submit-btn" disabled={loading}>
                {loading ? (
                  <div className="spinner light" />
                ) : (
                  mode === 'signup' ? 'Create Account' : 'Sign In'
                )}
              </button>
            </form>
          </div>

          {/* Footer */}
          <div className="auth-footer">
            <span>{mode === 'signup' ? 'Already have an account?' : "Don't have an account?"}</span>
            <button type="button" onClick={() => { setMode(mode === 'signup' ? 'signin' : 'signup'); setError(''); setSuccessMsg(''); }}>
              {mode === 'signup' ? 'Sign In' : 'Sign Up'}
            </button>
          </div>
        </div>

        {/* Bottom tagline */}
        <p className="auth-tagline">Control your PC from anywhere</p>
      </div>
    </div>
  )
}
