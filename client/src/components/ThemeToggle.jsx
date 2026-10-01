export function ThemeToggle({ theme, onToggle, showLabel = false, className = '' }) {
  const isDark = theme === 'dark';
  const nextThemeLabel = isDark ? 'Ativar modo claro' : 'Ativar modo noturno';

  return (
    <button
      type="button"
      className={`tactical-button-secondary shrink-0 ${showLabel ? 'px-3' : 'w-11 px-0'} ${className}`}
      aria-label={nextThemeLabel}
      aria-pressed={isDark}
      title={nextThemeLabel}
      onClick={onToggle}
    >
      {isDark ? (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M21 15.2A9 9 0 0 1 8.8 3a7 7 0 1 0 12.2 12.2Z" />
        </svg>
      )}
      {showLabel ? <span>{isDark ? 'Modo claro' : 'Modo noturno'}</span> : null}
    </button>
  );
}
