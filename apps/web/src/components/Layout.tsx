import { LogOut, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { NavLink } from 'react-router';
import { useAuth } from '../auth';

export type NavItem = { to: string; label: string; icon: ReactNode; end?: boolean };

export function Layout({
  title,
  nav,
  motif = 1,
  children,
}: {
  title: string;
  nav?: NavItem[];
  /** Motif de fond discret (public/motifs) : 1 pour le responsable et le parent, 3 pour l'agent. */
  motif?: 1 | 3;
  children: ReactNode;
}) {
  const { user, logout } = useAuth();
  return (
    <div className="mx-auto flex min-h-dvh max-w-5xl flex-col">
      <div className={`motif-layer motif-${motif}`} aria-hidden />
      <header className="sticky top-0 z-10 border-b border-white/60 bg-white/75 shadow-sm backdrop-blur-md">
        <div className="brand-stripe" />
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-brand-600 to-brand-800 text-white shadow-sm">
              <ShieldCheck className="size-5" aria-hidden />
            </span>
            <div>
              <p className="text-sm font-semibold leading-tight tracking-tight">Passage</p>
              <p className="text-xs text-slate-500">{title}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden text-sm text-slate-600 sm:inline">{user?.name}</span>
            <button
              onClick={() => void logout()}
              className="inline-flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-sm text-slate-600 transition-colors hover:bg-brand-50 hover:text-brand-800"
            >
              <LogOut className="size-4" aria-hidden />
              Déconnexion
            </button>
          </div>
        </div>
        {nav && (
          <nav className="flex gap-1 overflow-x-auto px-2 pb-2" aria-label="Navigation">
            {nav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm transition-colors ${isActive ? 'bg-brand-700 font-medium text-white shadow-sm' : 'text-slate-600 hover:bg-brand-50 hover:text-brand-800'}`
                }
              >
                {item.icon}
                {item.label}
              </NavLink>
            ))}
          </nav>
        )}
      </header>
      <main className="flex-1 space-y-4 p-4">{children}</main>
    </div>
  );
}
