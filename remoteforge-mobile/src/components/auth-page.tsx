import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type AuthMode = 'signin' | 'signup'

export default function AuthPage() {
  const [mode, setMode] = useState<AuthMode>('signup')
  const [firstname, setFirstname] = useState('')
  const [lastname, setLastname] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  /* ---- Email/Password Auth ---- */
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

      if (signUpError) {
        setError(signUpError.message)
      } else if (data.user && !data.session) {
        // Email confirmation required
        setSuccessMsg('Check your email for a confirmation link!')
      }
      // If session exists, onAuthStateChange in App.tsx will handle it
    } else {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      })
      if (signInError) setError(signInError.message)
    }

    setLoading(false)
  }

  /* ---- OAuth (Google / Microsoft) ---- */
  async function handleOAuth(provider: 'google' | 'azure') {
    setError('')
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: window.location.origin,
      },
    })
    if (oauthError) setError(oauthError.message)
  }

  return (
    <section className="flex min-h-screen bg-[#131314] px-4 py-16 md:py-32">
      <form
        onSubmit={handleSubmit}
        className="m-auto h-fit w-full max-w-sm rounded-2xl border border-[#303134] bg-[#1e1f20] p-0.5 shadow-2xl"
      >
        <div className="p-8 pb-6">
          {/* Header */}
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-8 h-8 rounded-lg bg-[#8ab4f8] flex items-center justify-center">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#131314" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2L2 7l10 5 10-5-10-5z" />
                  <path d="M2 17l10 5 10-5" />
                  <path d="M2 12l10 5 10-5" />
                </svg>
              </div>
            </div>
            <h1 className="mb-1 mt-4 text-xl font-semibold text-[#e3e3e3]">
              {mode === 'signup' ? 'Create a RemoteForge Account' : 'Welcome Back'}
            </h1>
            <p className="text-sm text-[#8e918f]">
              {mode === 'signup'
                ? 'Sign up to control your PC remotely'
                : 'Sign in to your account'}
            </p>
          </div>

          {/* OAuth buttons */}
          <div className="mt-6 grid grid-cols-2 gap-3">
            <Button
              type="button"
              variant="outline"
              className="flex items-center justify-center gap-2 border-[#303134] bg-[#1e1f20] text-[#c4c7c5] hover:bg-[#282a2c] hover:text-[#e3e3e3] cursor-pointer"
              onClick={() => handleOAuth('google')}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="0.98em" height="1em" viewBox="0 0 256 262">
                <path fill="#4285f4" d="M255.878 133.451c0-10.734-.871-18.567-2.756-26.69H130.55v48.448h71.947c-1.45 12.04-9.283 30.172-26.69 42.356l-.244 1.622l38.755 30.023l2.685.268c24.659-22.774 38.875-56.282 38.875-96.027" />
                <path fill="#34a853" d="M130.55 261.1c35.248 0 64.839-11.605 86.453-31.622l-41.196-31.913c-11.024 7.688-25.82 13.055-45.257 13.055c-34.523 0-63.824-22.773-74.269-54.25l-1.531.13l-40.298 31.187l-.527 1.465C35.393 231.798 79.49 261.1 130.55 261.1" />
                <path fill="#fbbc05" d="M56.281 156.37c-2.756-8.123-4.351-16.827-4.351-25.82c0-8.994 1.595-17.697 4.206-25.82l-.073-1.73L15.26 71.312l-1.335.635C5.077 89.644 0 109.517 0 130.55s5.077 40.905 13.925 58.602z" />
                <path fill="#eb4335" d="M130.55 50.479c24.514 0 41.05 10.589 50.479 19.438l36.844-35.974C195.245 12.91 165.798 0 130.55 0C79.49 0 35.393 29.301 13.925 71.947l42.211 32.783c10.59-31.477 39.891-54.251 74.414-54.251" />
              </svg>
              <span>Google</span>
            </Button>

            <Button
              type="button"
              variant="outline"
              className="flex items-center justify-center gap-2 border-[#303134] bg-[#1e1f20] text-[#c4c7c5] hover:bg-[#282a2c] hover:text-[#e3e3e3] cursor-pointer"
              onClick={() => handleOAuth('azure')}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 256 256">
                <path fill="#f1511b" d="M121.666 121.666H0V0h121.666z" />
                <path fill="#80cc28" d="M256 121.666H134.335V0H256z" />
                <path fill="#00adef" d="M121.663 256.002H0V134.336h121.663z" />
                <path fill="#fbbc09" d="M256 256.002H134.335V134.336H256z" />
              </svg>
              <span>Microsoft</span>
            </Button>
          </div>

          {/* Divider */}
          <div className="relative my-6">
            <hr className="border-[#303134]" />
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-[#1e1f20] px-3 text-xs text-[#5f6368]">
              or continue with email
            </span>
          </div>

          {/* Form fields */}
          <div className="space-y-4">
            {mode === 'signup' && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="firstname" className="block text-sm text-[#c4c7c5]">
                    First name
                  </Label>
                  <Input
                    type="text"
                    required
                    name="firstname"
                    id="firstname"
                    value={firstname}
                    onChange={(e) => setFirstname(e.target.value)}
                    className="border-[#303134] bg-[#282a2c] text-[#e3e3e3] placeholder:text-[#5f6368] focus-visible:ring-[#8ab4f8]"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastname" className="block text-sm text-[#c4c7c5]">
                    Last name
                  </Label>
                  <Input
                    type="text"
                    required
                    name="lastname"
                    id="lastname"
                    value={lastname}
                    onChange={(e) => setLastname(e.target.value)}
                    className="border-[#303134] bg-[#282a2c] text-[#e3e3e3] placeholder:text-[#5f6368] focus-visible:ring-[#8ab4f8]"
                  />
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="email" className="block text-sm text-[#c4c7c5]">
                Email
              </Label>
              <Input
                type="email"
                required
                name="email"
                id="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="border-[#303134] bg-[#282a2c] text-[#e3e3e3] placeholder:text-[#5f6368] focus-visible:ring-[#8ab4f8]"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="pwd" className="text-sm text-[#c4c7c5]">
                Password
              </Label>
              <Input
                type="password"
                required
                name="pwd"
                id="pwd"
                placeholder="••••••••"
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="border-[#303134] bg-[#282a2c] text-[#e3e3e3] placeholder:text-[#5f6368] focus-visible:ring-[#8ab4f8]"
              />
            </div>

            {/* Error / Success */}
            {error && (
              <p className="text-[13px] text-[#f28b82] bg-[#f28b82]/10 rounded-lg px-3 py-2">
                {error}
              </p>
            )}
            {successMsg && (
              <p className="text-[13px] text-[#81c995] bg-[#81c995]/10 rounded-lg px-3 py-2">
                {successMsg}
              </p>
            )}

            <Button
              disabled={loading}
              className="w-full bg-[#8ab4f8] text-[#131314] font-medium hover:bg-[#aecbfa] cursor-pointer disabled:opacity-50"
            >
              {loading
                ? mode === 'signup' ? 'Creating account...' : 'Signing in...'
                : mode === 'signup' ? 'Create Account' : 'Sign In'}
            </Button>
          </div>
        </div>

        {/* Footer toggle */}
        <div className="rounded-b-2xl border-t border-[#303134] bg-[#282a2c] p-3">
          <p className="text-center text-sm text-[#8e918f]">
            {mode === 'signup' ? 'Already have an account?' : "Don't have an account?"}
            <button
              type="button"
              onClick={() => { setMode(mode === 'signup' ? 'signin' : 'signup'); setError(''); setSuccessMsg(''); }}
              className="ml-1 text-[#8ab4f8] font-medium hover:underline cursor-pointer"
            >
              {mode === 'signup' ? 'Sign In' : 'Sign Up'}
            </button>
          </p>
        </div>
      </form>
    </section>
  )
}
