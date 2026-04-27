import { NavLink } from 'react-router-dom';
import { Icon } from './Icons';
import { APP_USER, NAV_ITEMS } from '../lib/constants';
import { cn } from '../lib/utils';

export function AppShell({ children }) {
  const accountItems = ['Abrir perfil', 'Account settings', 'Log out'];

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
            <div className="group relative">
              <button
                type="button"
                className="inline-flex min-h-12 items-center gap-3 rounded-2xl border border-tactical-ink/10 bg-white px-3 py-2 text-left transition hover:border-tactical-pitch/35 hover:bg-white/95 focus:outline-none"
              >
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-tactical-pitch font-black text-white shadow-glow">
                  {APP_USER.initials}
                </div>
                <div className="min-w-0">
                  <strong className="block truncate text-sm font-black text-tactical-ink">{APP_USER.name}</strong>
                  <span className="block truncate text-xs font-semibold text-tactical-ash">{APP_USER.email}</span>
                </div>
                <Icon
                  name="chevron-down"
                  className="h-4 w-4 shrink-0 text-tactical-ash transition duration-150 group-hover:rotate-180 group-focus-within:rotate-180"
                />
              </button>

              <div className="pointer-events-none absolute right-0 top-full z-40 w-[280px] pt-2 opacity-0 transition duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
                <div className="translate-y-2 overflow-hidden rounded-[1.4rem] border border-tactical-pitch/20 bg-tactical-ink text-white shadow-2xl transition duration-150 group-hover:translate-y-0 group-focus-within:translate-y-0">
                  <div className="border-b border-white/10 px-4 py-4">
                    <div className="flex items-center gap-3">
                      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-tactical-pitch font-black text-white shadow-glow">
                        {APP_USER.initials}
                      </div>
                      <div className="min-w-0">
                        <strong className="block truncate text-sm font-black text-white">{APP_USER.name}</strong>
                        <span className="block truncate text-xs font-medium text-white/65">{APP_USER.email}</span>
                      </div>
                    </div>
                  </div>

                  <div className="px-3 py-3">
                    {accountItems.map((item, index) => (
                      <button
                        key={item}
                        type="button"
                        className={cn(
                          'flex w-full items-center rounded-xl px-3 py-3 text-left text-sm font-semibold text-white/88 transition hover:bg-white/10 hover:text-white',
                          index === accountItems.length - 1 ? 'text-white/92' : ''
                        )}
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1500px] px-4 py-5 lg:px-6 lg:py-6">{children}</main>
    </div>
  );
}
