import { useEffect } from 'react';

export function useWindowShortcuts({ onKeyDown, onKeyUp, onBlur, dependencies = [] }) {
  useEffect(() => {
    window.addEventListener('keydown', onKeyDown, { capture: true });
    if (onKeyUp) {
      window.addEventListener('keyup', onKeyUp, { capture: true });
    }
    if (onBlur) {
      window.addEventListener('blur', onBlur);
    }

    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true });
      if (onKeyUp) {
        window.removeEventListener('keyup', onKeyUp, { capture: true });
      }
      if (onBlur) {
        window.removeEventListener('blur', onBlur);
      }
    };
  }, dependencies);
}
