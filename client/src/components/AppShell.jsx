import { NavLink, useLocation } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icons';
import { UserAvatar } from './UserAvatar';
import { ThemeToggle } from './ThemeToggle';
import { APP_USER, NAV_ITEMS } from '../lib/constants';
import { cn, hasAnyTeamRole } from '../lib/utils';

export function AppShell({ children, authUser, onLogout, clubNotificationsCount = 0, theme, onToggleTheme }) {
  const currentUser = authUser || APP_USER;
  const location = useLocation();
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [openNavMenu, setOpenNavMenu] = useState('');
  const accountMenuRef = useRef(null);
  const hasClubNotifications = clubNotificationsCount > 0;

  useEffect(() => {
    setAccountMenuOpen(false);
    setOpenNavMenu('');
  }, [location.pathname]);

  useEffect(() => {
    if (!mobileMenuOpen) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileMenuOpen]);

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
    const pathname = String(to || '').split('?')[0] || '/';
    if (pathname === '/') {
      return location.pathname === '/';
    }

    return location.pathname === pathname || location.pathname.startsWith(`${pathname}/`);
  }

  function isGroupActive(item) {
    return Array.isArray(item.items) && item.items.some((child) => isRouteActive(child.to));
  }

  function hasClub() {
    return Boolean(currentUser.globalAdmin || (currentUser.teamMemberships || []).length);
  }

  function hasAnyRole(roles = []) {
    if (!roles.length || currentUser.globalAdmin) {
      return true;
    }

    return hasAnyTeamRole(currentUser, roles);
  }

  function visibleChildren(item) {
    return (item.items || []).filter((child) => {
      if (child.requiresTeam && !hasClub()) {
        return false;
      }

      if (child.roles && !hasAnyRole(child.roles)) {
        return false;
      }

      return true;
    });
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

  function NotificationDot() {
    return <span className="h-2.5 w-2.5 rounded-full bg-red-500 shadow-[0_0_0_3px_rgba(239,68,68,0.18)]" aria-hidden="true" />;
  }

  return (
    <div className="min-h-screen bg-tactical-bone text-tactical-ink">
      <header className="sticky top-0 z-30 border-b border-tactical-ink/10 bg-white/95 lg:backdrop-blur">
        <button
          type="button"
          aria-label="Fechar menu"
          aria-hidden={!mobileMenuOpen}
          tabIndex={mobileMenuOpen ? 0 : -1}
          className={cn(
            'fixed inset-0 z-40 bg-black/58 transition-opacity lg:hidden',
            mobileMenuOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
          )}
          onClick={() => setMobileMenuOpen(false)}
        />

        <div className="mx-auto flex min-h-[68px] w-full max-w-[1180px] items-center gap-2 px-4 py-3 lg:grid lg:min-h-[72px] lg:grid-cols-[320px_minmax(0,1fr)_320px] lg:gap-6 lg:px-0">
          <button
            type="button"
            className="tactical-button-secondary w-11 shrink-0 px-0 lg:hidden"
            aria-label="Abrir menu"
            aria-controls="mobile-navigation"
            aria-expanded={mobileMenuOpen}
            onClick={() => {
              setAccountMenuOpen(false);
              setMobileMenuOpen(true);
            }}
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>

          <NavLink
            to="/"
            className="flex min-w-0 shrink-0 items-center justify-self-start text-xl font-black uppercase italic leading-none tracking-tight"
          >
            <span className="text-tactical-ink">Spill</span>
            <span className="text-tactical-pitch">&amp;Force</span>
          </NavLink>

          <nav
            id="mobile-navigation"
            aria-label="Principal"
            className={cn(
              'fixed inset-y-0 left-0 z-50 flex w-[min(84vw,320px)] flex-col gap-2 overflow-y-auto border-r border-tactical-ink/10 bg-white p-4 shadow-2xl transition duration-200 lg:static lg:z-auto lg:flex lg:w-auto lg:max-w-full lg:translate-x-0 lg:flex-row lg:flex-wrap lg:items-center lg:gap-1.5 lg:overflow-visible lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none lg:justify-self-center',
              mobileMenuOpen ? 'visible translate-x-0' : 'invisible -translate-x-full lg:visible'
            )}
          >
            <div className="mb-2 flex min-h-11 items-center justify-between border-b border-tactical-ink/10 pb-3 lg:hidden">
              <strong className="text-sm font-black uppercase tracking-[0.16em] text-tactical-ink">Menu</strong>
              <button
                type="button"
                aria-label="Fechar menu lateral"
                className="grid h-10 w-10 place-items-center rounded-md border border-tactical-ink/10 text-tactical-ink"
                onClick={() => setMobileMenuOpen(false)}
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="m6 6 12 12M18 6 6 18" />
                </svg>
              </button>
            </div>

            {NAV_ITEMS.map((item) => {
              const children = item.items ? visibleChildren(item) : [];

              if (item.items && !children.length) {
                return null;
              }

              return item.items ? (
                <div
                  key={item.label}
                  className="relative w-full lg:w-auto lg:shrink-0"
                >
                  <button
                    type="button"
                    aria-expanded={openNavMenu === item.label}
                    aria-haspopup="menu"
                    className={cn(
                      'inline-flex min-h-12 w-full items-center justify-start gap-3 rounded-md border px-4 text-sm font-bold transition lg:min-h-10 lg:w-auto lg:justify-center lg:gap-2 lg:px-3',
                      isGroupActive({ ...item, items: children })
                        ? 'border-tactical-pitch bg-tactical-pitch text-white shadow-glow'
                        : 'border-tactical-ink/10 bg-white text-tactical-ink hover:border-tactical-pitch/35 hover:bg-tactical-pitch/10'
                    )}
                    onClick={() => setOpenNavMenu((current) => (current === item.label ? '' : item.label))}
                  >
                    {renderNavIcon(item.icon)}
                    {item.label}
                    {item.label === 'Clube' && hasClubNotifications ? <NotificationDot /> : null}
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
                      'relative z-50 w-full pt-1 transition duration-150 lg:absolute lg:left-0 lg:top-full lg:min-w-56 lg:pt-2',
                      openNavMenu === item.label
                        ? 'block pointer-events-auto opacity-100'
                        : 'hidden pointer-events-none opacity-0 lg:block'
                    )}
                  >
                    <div
                      className={cn(
                      'overflow-hidden rounded-lg border border-tactical-ink/10 bg-white p-1.5 text-tactical-ink shadow-panel transition duration-150',
                        openNavMenu === item.label ? 'translate-y-0' : 'translate-y-1'
                      )}
                    >
                      {children.map((child) => (
                        <NavLink
                          key={child.to}
                          to={child.to}
                          onClick={() => {
                            setOpenNavMenu('');
                            setMobileMenuOpen(false);
                          }}
                          className={({ isActive }) =>
                            cn(
                              'flex min-h-10 items-center gap-3 rounded-md px-3 text-sm font-semibold transition',
                              isActive ? 'bg-tactical-pitch text-white' : 'text-tactical-ink hover:bg-tactical-pitch/10 hover:text-tactical-pitch'
                            )
                          }
                        >
                          {renderNavIcon(child.icon)}
                          {child.label}
                          {child.to === '/club-manage' && hasClubNotifications ? <NotificationDot /> : null}
                        </NavLink>
                      ))}
                    </div>
                  </div>
                </div>
              ) : !item.requiresTeam || hasClub() ? (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    cn(
                      'inline-flex min-h-12 w-full items-center justify-start gap-3 rounded-md border px-4 text-sm font-bold transition lg:min-h-10 lg:w-auto lg:shrink-0 lg:justify-center lg:gap-2 lg:px-3',
                      isActive
                        ? 'border-tactical-pitch bg-tactical-pitch text-white shadow-glow'
                        : 'border-tactical-ink/10 bg-white text-tactical-ink hover:border-tactical-pitch/35 hover:bg-tactical-pitch/10'
                    )
                  }
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {renderNavIcon(item.icon)}
                  {item.label}
                  {item.to === '/time' && hasClubNotifications ? <NotificationDot /> : null}
                </NavLink>
              ) : null
            })}
          </nav>

          <div className="ml-auto flex items-center gap-2 justify-self-end lg:ml-0 lg:w-[320px] lg:gap-3">
            <ThemeToggle theme={theme} onToggle={onToggleTheme} />
            <div
              ref={accountMenuRef}
              className="relative shrink-0 lg:w-full"
              onMouseEnter={() => setAccountMenuOpen(true)}
              onMouseLeave={() => setAccountMenuOpen(false)}
              onFocusCapture={() => setAccountMenuOpen(true)}
            >
              <button
                type="button"
                aria-expanded={accountMenuOpen}
                aria-haspopup="menu"
                className="inline-flex min-h-11 w-11 items-center justify-center gap-3 rounded-lg border border-tactical-ink/10 bg-white px-0 py-1 text-left transition hover:border-tactical-pitch/35 focus:outline-none focus:ring-2 focus:ring-tactical-pitch/15 lg:w-full lg:justify-start lg:px-3 lg:py-2"
                onClick={() => setAccountMenuOpen(true)}
              >
                <UserAvatar user={currentUser} className="h-9 w-9 lg:h-11 lg:w-11" />
                <div className="hidden min-w-0 lg:block">
                  <strong className="block truncate text-sm font-black text-tactical-ink">{currentUser.name}</strong>
                  <span className="block truncate text-xs font-semibold text-tactical-ash">{currentUser.email}</span>
                </div>
                <Icon
                  name="chevron-down"
                  className={cn(
                    'hidden h-4 w-4 shrink-0 text-tactical-ash transition duration-150 lg:block',
                    accountMenuOpen ? 'rotate-180' : ''
                  )}
                />
              </button>

              <div
                className={cn(
                  'absolute right-0 top-full z-40 w-64 pt-1 transition duration-150 lg:w-full',
                  accountMenuOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
                )}
              >
                <div
                  className={cn(
                    'overflow-hidden rounded-lg border border-tactical-ink/10 bg-white text-tactical-ink shadow-panel transition duration-150',
                    accountMenuOpen ? 'translate-y-0' : 'translate-y-1'
                  )}
                >
                  <div className="space-y-1 px-3 py-3">
                    <NavLink
                      to="/configuracoes-da-conta"
                      onClick={() => setAccountMenuOpen(false)}
                      className={({ isActive }) =>
                        cn(
                          'flex w-full items-center gap-3 rounded-md px-3 py-3 text-left text-sm font-semibold transition',
                          isActive ? 'bg-tactical-pitch text-white' : 'text-tactical-ink hover:bg-tactical-pitch/10 hover:text-tactical-pitch'
                        )
                      }
                    >
                      <Icon name="settings" className="h-4 w-4" />
                      Configuracoes da conta
                    </NavLink>
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 rounded-md px-3 py-3 text-left text-sm font-semibold text-tactical-ink transition hover:bg-tactical-pitch/10 hover:text-tactical-pitch"
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

      <main className="mx-auto w-full max-w-[1320px] px-4 pb-6 pt-4 lg:px-6 lg:py-6">{children}</main>
    </div>
  );
}
