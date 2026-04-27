export function Icon({ name, className = '' }) {
  switch (name) {
    case 'home':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 11.5 12 4l9 7.5" />
          <path d="M5 10.5V20h5v-5h4v5h5v-9.5" />
        </svg>
      );
    case 'upload':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 16V4" />
          <path d="m7 9 5-5 5 5" />
          <path d="M5 20h14" />
        </svg>
      );
    case 'library':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="4" y="4" width="6" height="6" />
          <rect x="14" y="4" width="6" height="6" />
          <rect x="4" y="14" width="6" height="6" />
          <rect x="14" y="14" width="6" height="6" />
        </svg>
      );
    case 'search':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="6" />
          <path d="m20 20-4.2-4.2" />
        </svg>
      );
    case 'play':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="currentColor">
          <path d="m8 5 11 7-11 7V5Z" />
        </svg>
      );
    case 'pause':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="currentColor">
          <path d="M7 5h4v14H7zM13 5h4v14h-4z" />
        </svg>
      );
    case 'film':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="4" y="5" width="16" height="14" rx="2" />
          <path d="M8 5v14M16 5v14M4 9h4M4 15h4M16 9h4M16 15h4" />
        </svg>
      );
    case 'folder-plus':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-9Z" />
          <path d="M12 10v6M9 13h6" />
        </svg>
      );
    case 'pen':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
          <path d="m4 20 4.2-.9L19 8.3 15.7 5 4.9 15.8 4 20Z" />
          <path d="m14.5 6.2 3.3 3.3" />
        </svg>
      );
    case 'circle':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="7" />
        </svg>
      );
    case 'arrow-up-right':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M7 17 17 7" />
          <path d="M9 7h8v8" />
        </svg>
      );
    case 'maximize':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M8 4H4v4" />
          <path d="M4 4l6 6" />
          <path d="M16 4h4v4" />
          <path d="m20 4-6 6" />
          <path d="M8 20H4v-4" />
          <path d="m4 20 6-6" />
          <path d="M16 20h4v-4" />
          <path d="m20 20-6-6" />
        </svg>
      );
    case 'settings':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M14.1 2.5h-4.2l-.7 2.4a8.4 8.4 0 0 0-1.7 1L5.1 5.3 3 8.9l1.8 1.8a8.4 8.4 0 0 0 0 2L3 14.5l2.1 3.6 2.4-.6a8.4 8.4 0 0 0 1.7 1l.7 2.4h4.2l.7-2.4a8.4 8.4 0 0 0 1.7-1l2.4.6 2.1-3.6-1.8-1.8a8.4 8.4 0 0 0 0-2L21 8.9l-2.1-3.6-2.4.6a8.4 8.4 0 0 0-1.7-1l-.7-2.4ZM12 16.3a4.3 4.3 0 1 0 0-8.6 4.3 4.3 0 0 0 0 8.6Z"
          />
        </svg>
      );
    case 'text':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 6h16M12 6v12M8 18h8" />
        </svg>
      );
    case 'undo':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M9 7V3L3 9l6 6v-4h5a5 5 0 1 1 0 10" />
        </svg>
      );
    case 'trash':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 7h16" />
          <path d="M10 11v6M14 11v6" />
          <path d="M6 7l1 12h10l1-12" />
          <path d="M9 4h6l1 3H8l1-3Z" />
        </svg>
      );
    case 'save':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M5 4h11l3 3v13H5V4Z" />
          <path d="M8 4v6h8V4" />
          <path d="M8 20v-6h8v6" />
        </svg>
      );
    case 'clock':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="8" />
          <path d="M12 8v4l3 2" />
        </svg>
      );
    case 'back':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
          <path d="m11 7-5 5 5 5" />
          <path d="M18 7v10" />
        </svg>
      );
    case 'forward':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
          <path d="m13 7 5 5-5 5" />
          <path d="M6 7v10" />
        </svg>
      );
    case 'spark':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 3v5M12 16v5M3 12h5M16 12h5M5.6 5.6l3.5 3.5M14.9 14.9l3.5 3.5M18.4 5.6l-3.5 3.5M9.1 14.9l-3.5 3.5" />
        </svg>
      );
    case 'chevron-down':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
          <path d="m6 9 6 6 6-6" />
        </svg>
      );
    default:
      return null;
  }
}
