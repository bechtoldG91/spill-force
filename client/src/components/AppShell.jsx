import { NavLink, useLocation } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icons';
import { UserAvatar } from './UserAvatar';
import { APP_USER, NAV_ITEMS } from '../lib/constants';
import { cn } from '../lib/utils';

export function AppShell({ children, authUser, onLogout }) {
  const currentUser = authUser || APP_USER;
  const location = useLocation();
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [openNavMenu, setOpenNavMenu] = useState('');
  const accountMenuRef = useRef(null);

  useEffect(() => {
    setAccountMenuOpen(false);
    setOpenNavMenu('');
  }, [location.pathname]);

  useEffect(() => {
    function handleDocumentPointerDown(event) {
      if (!accountMenuRef.current?.contains(event.target)) {
        setAccountMenuOpen(false);
      }
    }

    document.addEventListener('pointerdown', handleDocumentPointerDown);
    return () => document.removeEventListener('pointerdown', handleDocumentPointerDown);
  }, []);

  function isRouteActive(to) {
    if (to === '/') {
      return location.pathname === '/';
    }

    return location.pathname === to || location.pathname.startsWith(`${to}/`);
  }

  function isGroupActive(item) {
    return Array.isArray(item.items) && item.items.some((child) => isRouteActive(child.to));
  }

  function canManageClub() {
    return Boolean(
      currentUser.globalAdmin ||
        (currentUser.teamMemberships || []).some((membership) => ['admin', 'treinador'].includes(membership.role))
    );
  }

  function visibleChildren(item) {
    return (item.items || []).filter((child) => !child.manageClubOnly || canManageClub());
  }

  function renderNavIcon(icon, className = 'h-4 w-4') {
    if (icon === 'upload') {
      return <span className="material-symbols-outlined text-[1.15rem] leading-none">upload_file</span>;
    }

    if (icon === 'library') {
      return <span className="material-symbols-outlined text-[1.15rem] leading-none">video_library</span>;
    }

    return <Icon name={icon} className={className} />;
  }

  return (
    <div className="field-grid min-h-screen bg-tactical-bone text-tactical-ink">
      <header className="sticky top-0 z-30 border-b border-tactical-ink/10 bg-tactical-bone/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] flex-col gap-3 px-4 py-3 xl:grid xl:min-h-[86px] xl:grid-cols-[minmax(220px,1fr)_auto_minmax(250px,1fr)] xl:items-center xl:gap-4 xl:px-6">
          <NavLink
            to="/"
            className="flex min-w-0 items-center self-start text-2xl font-black uppercase italic leading-none tracking-tight xl:h-full xl:justify-self-center"
          >
            <span className="text-tactical-ink">Spill</span>
            <span className="text-tactical-pitch">&amp;Force</span>
          </NavLink>

          <nav
            aria-label="Principal"
            className="order-3 flex w-full max-w-full flex-wrap items-center gap-2 pb-1 xl:order-none xl:w-auto xl:justify-self-center xl:pb-0"
          >
            {NAV_ITEMS.map((item) => {
              const children = item.items ? visibleChildren(item) : [];

              if (item.items && !children.length) {
                return null;
              }

              return item.items ? (
                <div
                  key={item.label}
                  className="relative shrink-0"
                  onMouseEnter={() => setOpenNavMenu(item.label)}
                  onMouseLeave={() => setOpenNavMenu((current) => (current === item.label ? '' : current))}
                  onFocusCapture={() => setOpenNavMenu(item.label)}
                >
                  <button
                    type="button"
                    aria-expanded={openNavMenu === item.label}
                    aria-haspopup="menu"
                    className={cn(
                      'inline-flex min-h-11 items-center gap-2 rounded-xl border px-3 text-xs font-black uppercase tracking-[0.14em] transition sm:px-4 sm:text-sm sm:tracking-[0.18em]',
                      isGroupActive({ ...item, items: children })
                        ? 'border-tactical-pitch bg-tactical-pitch text-white shadow-glow'
                        : 'border-tactical-ink/10 bg-white text-tactical-ink hover:border-tactical-pitch/35 hover:bg-tactical-pitch/10'
                    )}
                    onClick={() => setOpenNavMenu(item.label)}
                  >
                    {renderNavIcon(item.icon)}
                    {item.label}
                    <Icon
                      name="chevron-down"
                      className={cn(
                        'h-3.5 w-3.5 transition duration-150',
                        openNavMenu === item.label ? 'rotate-180' : ''
                      )}
                    />
                  </button>

                  <div
                    className={cn(
                      'absolute left-0 top-full z-50 min-w-56 pt-2 transition duration-150',
                      openNavMenu === item.label ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
                    )}
                  >
                    <div
                      className={cn(
                        'overflow-hidden rounded-2xl border border-tactical-ink/10 bg-white p-1.5 text-tactical-ink shadow-2xl transition duration-150',
                        openNavMenu === item.label ? 'translate-y-0' : 'translate-y-1'
                      )}
                    >
                      {children.map((child) => (
                        <NavLink
                          key={child.to}
                          to={child.to}
                          onClick={() => setOpenNavMenu('')}
                          className={({ isActive }) =>
                            cn(
                              'flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-black uppercase tracking-[0.12em] transition',
                              isActive ? 'bg-tactical-pitch text-white' : 'text-tactical-ink hover:bg-tactical-pitch/10 hover:text-tactical-pitch'
                            )
                          }
                        >
                          {renderNavIcon(child.icon)}
                          {child.label}
                        </NavLink>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    cn(
                      'inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl border px-3 text-xs font-black uppercase tracking-[0.14em] transition sm:px-4 sm:text-sm sm:tracking-[0.18em]',
                      isActive
                        ? 'border-tactical-pitch bg-tactical-pitch text-white shadow-glow'
                        : 'border-tactical-ink/10 bg-white text-tactical-ink hover:border-tactical-pitch/35 hover:bg-tactical-pitch/10'
                    )
                  }
                >
                  {renderNavIcon(item.icon)}
                  {item.label}
                </NavLink>
              )
            })}
          </nav>

          <div className="order-2 flex w-full items-center justify-between gap-3 sm:w-[280px] xl:order-none xl:justify-self-end">
            <div
              ref={accountMenuRef}
              className="relative w-full"
              onMouseEnter={() => setAccountMenuOpen(true)}
              onMouseLeave={() => setAccountMenuOpen(false)}
              onFocusCapture={() => setAccountMenuOpen(true)}
            >
              <button
                type="button"
                aria-expanded={accountMenuOpen}
                aria-haspopup="menu"
                className="inline-flex min-h-12 w-full items-center gap-3 rounded-2xl border border-tactical-ink/10 bg-white px-3 py-2 text-left transition hover:border-tactical-pitch/35 hover:bg-white/95 focus:outline-none"
                onClick={() => setAccountMenuOpen(true)}
              >
                <UserAvatar user={currentUser} className="h-11 w-11" />
                <div className="min-w-0">
                  <strong className="block truncate text-sm font-black text-tactical-ink">{currentUser.name}</strong>
                  <span className="block truncate text-xs font-semibold text-tactical-ash">{currentUser.email}</span>
                </div>
                <Icon
                  name="chevron-down"
                  className={cn(
                    'h-4 w-4 shrink-0 text-tactical-ash transition duration-150',
                    accountMenuOpen ? 'rotate-180' : ''
                  )}
                />
              </button>

              <div
                className={cn(
                  'absolute right-0 top-full z-40 w-full pt-1 transition duration-150',
                  accountMenuOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
                )}
              >
                <div
                  className={cn(
                    'overflow-hidden rounded-2xl border border-tactical-ink/10 bg-white text-tactical-ink shadow-2xl transition duration-150',
                    accountMenuOpen ? 'translate-y-0' : 'translate-y-1'
                  )}
                >
                  <div className="space-y-1 px-3 py-3">
                    <NavLink
                      to="/perfil"
                      onClick={() => setAccountMenuOpen(false)}
                      className={({ isActive }) =>
                        cn(
                          'flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold transition',
                          isActive ? 'bg-tactical-pitch text-white' : 'text-tactical-ink hover:bg-tactical-pitch/10 hover:text-tactical-pitch'
                        )
                      }
                    >
                      <Icon name="profile" className="h-4 w-4" />
                      Perfil
                    </NavLink>
                    <NavLink
                      to="/configuracoes-da-conta"
                      onClick={() => setAccountMenuOpen(false)}
                      className={({ isActive }) =>
                        cn(
                          'flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold transition',
                          isActive ? 'bg-tactical-pitch text-white' : 'text-tactical-ink hover:bg-tactical-pitch/10 hover:text-tactical-pitch'
                        )
                      }
                    >
                      <Icon name="settings" className="h-4 w-4" />
                      Configuracoes da conta
                    </NavLink>
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold text-tactical-ink transition hover:bg-tactical-pitch/10 hover:text-tactical-pitch"
                      onClick={() => {
                        setAccountMenuOpen(false);
                        onLogout();
                      }}
                    >
                      <Icon name="logout" className="h-4 w-4" />
                      Log out
                    </button>
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
