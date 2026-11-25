import { LogOut, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { NavLink } from 'react-router';
import { useAuth } from '../auth';

export type NavItem = { to: string; label: string; icon: ReactNode; end?: boolean };

export function Layout({ title, nav, children }: { title: string; nav?: NavItem[]; children: ReactNode }) {
  const { user, logout } = useAuth();
  return (
    <div className="mx-auto flex min-h-dvh max-w-5xl flex-col">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-6 text-teal-700" aria-hidden />
            <div>
              <p className="text-sm font-semibold leading-tight">Passage</p>
              <p className="text-xs text-slate-500">{title}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden text-sm text-slate-600 sm:inline">{user?.name}</span>
            <button
              onClick={() => void logout()}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
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
                  `inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm ${isActive ? 'bg-teal-50 font-medium text-teal-800' : 'text-slate-600 hover:bg-slate-100'}`
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
