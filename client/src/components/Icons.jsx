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
    case 'team':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="9" cy="8" r="3" />
          <circle cx="17" cy="10" r="2.4" />
          <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
          <path d="M14.5 16.5a4.5 4.5 0 0 1 6 2.5" />
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
    case 'analysis':
      return (
        <svg viewBox="0 -960 960 960" className={className} fill="currentColor" aria-hidden="true">
          <path d="M280-280h80v-280h-80v280Zm160 0h80v-400h-80v400Zm160 0h80v-160h-80v160ZM200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm0-80h560v-560H200v560Zm0-560v560-560Z" />
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
    case 'logout':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M10 5H5v14h5" />
          <path d="M14 8l4 4-4 4" />
          <path d="M8 12h10" />
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
    case 'add-note':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M5 4h12v8" />
          <path d="M5 4v16h8" />
          <path d="M8 8h6" />
          <path d="M8 12h5" />
          <circle cx="17" cy="17" r="4" />
          <path d="M17 15v4" />
          <path d="M15 17h4" />
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
    case 'chevron-down':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
          <path d="m6 9 6 6 6-6" />
        </svg>
      );
    case 'eye':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
    case 'eye-off':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 3l18 18" />
          <path d="M10.6 10.6A2 2 0 0 0 12 14a2 2 0 0 0 1.4-.6" />
          <path d="M9.9 5.2A10.8 10.8 0 0 1 12 5c6 0 9.5 7 9.5 7a16.5 16.5 0 0 1-2.3 3.1" />
          <path d="M6.6 6.6C3.9 8.4 2.5 12 2.5 12s3.5 7 9.5 7a10 10 0 0 0 4.1-.9" />
        </svg>
      );
    default:
      return null;
  }
}
