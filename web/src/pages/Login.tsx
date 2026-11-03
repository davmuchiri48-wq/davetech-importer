import { useState } from 'react';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth';
import { auth, firebaseConfigured } from '../lib/firebase';
import { Button, ErrorBox, Field, Notice } from '../components/ui';
import { useSession } from '../lib/session';

const friendly = (code: string) => ({
  'auth/invalid-credential': 'Wrong email or password.',
  'auth/user-not-found': 'No account with that email.',
  'auth/email-already-in-use': 'That email already has an account — sign in instead.',
  'auth/weak-password': 'Use at least 6 characters for the password.',
  'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
} as Record<string, string>)[code] || code;

export default function Login() {
  const { error: sessionError, fbUser, logout } = useSession();
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  if (!firebaseConfigured) {
    return (
      <div className="mx-auto mt-20 max-w-lg p-4">
        <Notice tone="warning">Firebase is not configured. Set <code>VITE_FIREBASE_API_KEY</code>, <code>VITE_FIREBASE_AUTH_DOMAIN</code>, <code>VITE_FIREBASE_PROJECT_ID</code> and <code>VITE_FIREBASE_APP_ID</code>, then rebuild. See README → Setup.</Notice>
      </div>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      if (mode === 'in') await signInWithEmailAndPassword(auth!, email, password);
      else await createUserWithEmailAndPassword(auth!, email, password);
    } catch (e: any) { setErr(friendly(e.code || e.message)); } finally { setBusy(false); }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="card w-full max-w-sm p-6">
        <div className="mb-6 flex items-center gap-3">
          <img src="/favicon.svg" className="h-10 w-10" alt="" />
          <div><h1 className="font-semibold">Davetech Importer</h1><p className="text-xs text-slate-500">Import Products. Automate Selling. Grow Your Business.</p></div>
        </div>
        {fbUser && sessionError && (
          <div className="mb-4 space-y-2"><ErrorBox error={sessionError} /><Button variant="secondary" className="w-full" onClick={logout}>Use another account</Button></div>
        )}
        <form onSubmit={submit} className="space-y-3">
          <Field label="Email"><input className="input" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Password"><input className="input" type="password" required minLength={6} autoComplete={mode === 'in' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          {err && <ErrorBox error={err} />}
          {info && <Notice>{info}</Notice>}
          <Button className="w-full" loading={busy}>{mode === 'in' ? 'Sign in' : 'Create account'}</Button>
        </form>
        <div className="mt-4 flex justify-between text-xs">
          <button className="text-brand-600" onClick={() => setMode(mode === 'in' ? 'up' : 'in')}>{mode === 'in' ? 'First time? Create account' : 'Have an account? Sign in'}</button>
          {mode === 'in' && <button className="text-slate-500" onClick={async () => {
            if (!email) return setErr('Type your email first');
            try { await sendPasswordResetEmail(auth!, email); setInfo('Password reset email sent.'); } catch (e: any) { setErr(friendly(e.code)); }
          }}>Forgot password?</button>}
        </div>
        {mode === 'up' && <p className="mt-3 text-xs text-slate-500">Only emails listed by the owner (ADMIN_EMAILS) or invited from Settings → Team can get in.</p>}
      </div>
    </div>
  );
}
