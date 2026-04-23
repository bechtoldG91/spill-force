import { NavLink } from 'react-router-dom';
import { Icon } from './Icons';
import { APP_USER, NAV_ITEMS } from '../lib/constants';
import { cn } from '../lib/utils';

export function AppShell({ children }) {
  return (
    <div className="field-grid min-h-screen bg-tactical-bone text-tactical-ink">
      <header className="sticky top-0 z-30 border-b border-tactical-ink/10 bg-tactical-bone/95 backdrop-blur">
        <div className="relative mx-auto flex max-w-[1500px] flex-col gap-4 px-4 py-3 lg:flex-row lg:items-center lg:justify-between lg:px-6">
          <NavLink to="/" className="min-w-0 text-2xl font-black uppercase italic leading-none tracking-tight">
            <span className="text-tactical-ink">Spill</span>
            <span className="text-tactical-pitch">&amp;Force</span>
          </NavLink>

          <nav
            aria-label="Principal"
            className="flex flex-wrap items-center gap-2 lg:absolute lg:left-1/2 lg:top-1/2 lg:-translate-x-1/2 lg:-translate-y-1/2"
          >
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    'inline-flex min-h-11 items-center gap-2 rounded-xl border px-4 text-sm font-black uppercase tracking-[0.18em] transition',
                    isActive
                      ? 'border-tactical-pitch bg-tactical-pitch text-white shadow-glow'
                      : 'border-tactical-ink/10 bg-white text-tactical-ink hover:border-tactical-pitch/35 hover:bg-tactical-pitch/10'
                  )
                }
              >
                <Icon name={item.icon} className="h-4 w-4" />
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center justify-between gap-3 lg:justify-end">
            <div className="flex min-w-0 items-center gap-3">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-tactical-pitch font-black text-white shadow-glow">
                {APP_USER.initials}
              </div>
              <div className="min-w-0">
                <strong className="block truncate text-sm font-black uppercase tracking-[0.16em] text-tactical-ink">
                  {APP_USER.name}
                </strong>
                <span className="block truncate text-xs font-semibold uppercase tracking-[0.18em] text-tactical-ash">
                  {APP_USER.team} - {APP_USER.role}
                </span>
              </div>
            </div>

            <button type="button" className="tactical-button-secondary px-4">
              Login
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1500px] px-4 py-5 lg:px-6 lg:py-6">{children}</main>
    </div>
  );
}
