import { ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../auth';
import { Button, ErrorBox, inputClass } from '../components/ui';

export function LoginPage() {
  const { login } = useAuth();
  const [loginValue, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  return (
    // Fond aubergine et motif coloré (styles.css, .login-backdrop) : première impression.
    <div className="login-backdrop flex min-h-dvh items-center justify-center p-4">
      <form
        className="w-full max-w-sm space-y-5 rounded-3xl border border-white/20 bg-white/95 p-7 shadow-2xl shadow-black/40 backdrop-blur"
        onSubmit={async (e) => {
          e.preventDefault();
          setLoading(true);
          setError(null);
          try {
            await login(loginValue, password);
          } catch (err) {
            setError(err);
          } finally {
            setLoading(false);
          }
        }}
      >
        <div className="flex items-center gap-3">
          <span className="grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-800 text-white shadow-md">
            <ShieldCheck className="size-6" aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Passage</h1>
            <p className="text-sm text-slate-500">Suivi des passages des élèves</p>
          </div>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="login">
            Identifiant
          </label>
          <input
            id="login"
            className={inputClass}
            autoComplete="username"
            value={loginValue}
            onChange={(e) => setLogin(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="password">
            Mot de passe
          </label>
          <input
            id="password"
            type="password"
            className={inputClass}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <ErrorBox error={error} />
        <Button type="submit" className="w-full" loading={loading}>
          Se connecter
        </Button>
      </form>
    </div>
  );
}
